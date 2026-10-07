import { chromium, type Browser, type Page } from "playwright";
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
}

export function createLocalBrowserBackend(options: LocalBrowserOptions = {}): BrowserBackend {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let mediaUrls: string[] = [];
  const MEDIA_RE = /\.(m3u8|mp4|ts|m4s|mpd)(\?|#|$)/i;

  async function ensurePage(): Promise<Page> {
    if (!browser) {
      browser = await chromium.launch({ headless: options.headless ?? true });
    }
    if (!page) {
      const context = await browser.newContext({
        viewport: options.viewport ?? { width: 1280, height: 800 },
      });
      page = await context.newPage();
      page.on("response", (response) => {
        const url = response.url();
        if (MEDIA_RE.test(url) && !mediaUrls.includes(url)) mediaUrls.push(url);
      });
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
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
    },
  };
}
