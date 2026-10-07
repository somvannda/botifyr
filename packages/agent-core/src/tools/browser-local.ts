import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ToolResult } from "../types.js";
import type { BrowserBackend } from "./browser.js";

/**
 * In-process Playwright backend. Fast to iterate on, but NOT isolated — the
 * browser runs in the cloud process. Use it for development; use the Docker
 * backend for anything real.
 */

export interface LocalBrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  /**
   * Persist cookies/localStorage in this directory so logins survive across
   * tasks (docs/company-workspace.md Part V §41). Per-employee dir.
   */
  userDataDir?: string;
}

export function createLocalBrowserBackend(options: LocalBrowserOptions = {}): BrowserBackend {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let mediaUrls: string[] = [];
  const MEDIA_RE = /\.(m3u8|mp4|ts|m4s|mpd)(\?|#|$)/i;
  const attached = new WeakSet<Page>();

  function attach(active: Page): void {
    if (attached.has(active)) return;
    attached.add(active);
    active.on("response", (response) => {
      const url = response.url();
      if (MEDIA_RE.test(url) && !mediaUrls.includes(url)) mediaUrls.push(url);
    });
  }

  async function ensurePage(): Promise<Page> {
    // Persistent profile: one context reused across tasks (keeps logins).
    if (options.userDataDir) {
      if (!context) {
        context = await chromium.launchPersistentContext(options.userDataDir, {
          headless: options.headless ?? true,
          viewport: options.viewport ?? { width: 1280, height: 800 },
        });
      }
      if (!page || page.isClosed()) {
        page = context.pages()[0] ?? (await context.newPage());
        attach(page);
      }
      return page;
    }
    if (!browser) {
      browser = await chromium.launch({ headless: options.headless ?? true });
    }
    if (!page) {
      const fresh = await browser.newContext({
        viewport: options.viewport ?? { width: 1280, height: 800 },
      });
      page = await fresh.newPage();
      attach(page);
    }
    return page;
  }

  return {
    async goto(url: string): Promise<ToolResult> {
      const active = await ensurePage();
      mediaUrls = [];
      await active.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const title = await active.title();
      return {
        ok: true,
        output: `Opened ${active.url()} — title: "${title}"`,
        screenshot: await active.screenshot({ type: "png" }),
      };
    },

    async extract(selector: string): Promise<ToolResult> {
      const active = await ensurePage();
      const element = await active.$(selector);
      if (!element) return { ok: false, output: `No element matched "${selector}".` };
      const text = ((await element.textContent()) ?? "").trim();
      return { ok: true, output: `Text of "${selector}": ${text || "(empty)"}` };
    },

    async type(selector: string, text: string): Promise<ToolResult> {
      const active = await ensurePage();
      await active.fill(selector, text);
      return {
        ok: true,
        output: `Typed into "${selector}".`,
        screenshot: await active.screenshot({ type: "png" }),
      };
    },

    async click(selector: string): Promise<ToolResult> {
      const active = await ensurePage();
      await active.click(selector);
      await active.waitForTimeout(250);
      return {
        ok: true,
        output: `Clicked "${selector}".`,
        screenshot: await active.screenshot({ type: "png" }),
      };
    },

    async screenshot(): Promise<ToolResult> {
      const active = await ensurePage();
      return {
        ok: true,
        output: "Captured a screenshot of the current page.",
        screenshot: await active.screenshot({ type: "png" }),
      };
    },

    async sniff(waitMs?: number): Promise<ToolResult> {
      const active = await ensurePage();
      if (waitMs && waitMs > 0) await active.waitForTimeout(Math.min(15_000, waitMs));
      if (mediaUrls.length === 0) {
        return {
          ok: false,
          output: "No media URLs captured yet. Open the video and press play, then sniff again.",
        };
      }
      return {
        ok: true,
        output: `Captured ${mediaUrls.length} media URL(s):\n${mediaUrls
          .map((url, index) => `${index + 1}. ${url}`)
          .join("\n")}`,
      };
    },

    async close(): Promise<void> {
      if (context) {
        await context.close();
        context = null;
        page = null;
      }
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
    },
  };
}
