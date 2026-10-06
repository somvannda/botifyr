import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Botifyr local node.
 *
 * Runs on the user's own machine and connects outbound to the cloud. It exposes
 * the user's browser and shell/files so the agent can operate their machine when
 * asked. Consequential steps are approved in the app, not here.
 *
 * Env: BOTIFYR_CLOUD_URL, BOTIFYR_TOKEN (or BOTIFYR_EMAIL + BOTIFYR_PASSWORD),
 *      BOTIFYR_NODE_NAME, BOTIFYR_NODE_HEADLESS=1, BOTIFYR_NODE_FRESH=1 (skip
 *      the real Chrome profile), BOTIFYR_NODE_CHROME_PROFILE (profile dir).
 */

const CLOUD = (process.env.BOTIFYR_CLOUD_URL ?? "http://localhost:8787").replace(/\/$/, "");
const NAME = process.env.BOTIFYR_NODE_NAME ?? `node-${Math.random().toString(36).slice(2, 7)}`;
const HEADLESS = process.env.BOTIFYR_NODE_HEADLESS === "1";

const execFileAsync = promisify(execFile);

async function resolveToken(): Promise<string> {
  if (process.env.BOTIFYR_TOKEN) return process.env.BOTIFYR_TOKEN;
  const email = process.env.BOTIFYR_EMAIL;
  const password = process.env.BOTIFYR_PASSWORD;
  if (email && password) {
    const response = await fetch(`${CLOUD}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error(`login failed (${response.status})`);
    return ((await response.json()) as { token: string }).token;
  }
  throw new Error("set BOTIFYR_TOKEN, or BOTIFYR_EMAIL + BOTIFYR_PASSWORD");
}

let TOKEN: string;
try {
  TOKEN = await resolveToken();
} catch (error) {
  console.error(`[node] ${(error as Error).message}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ browser */

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let mode: "cdp" | "profile" | "fresh" = "fresh";

function chromeProfileDir(): string {
  return (
    process.env.BOTIFYR_NODE_CHROME_PROFILE ??
    path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Google", "Chrome", "User Data")
  );
}

async function ensurePage(): Promise<Page> {
  if (!context) {
    // 1) Attach to an already-running Chrome with remote debugging (keeps tabs).
    const cdpUrl = process.env.BOTIFYR_NODE_CDP ?? "http://127.0.0.1:9222";
    if (process.env.BOTIFYR_NODE_NO_CDP !== "1") {
      try {
        browser = await chromium.connectOverCDP(cdpUrl, { timeout: 4000 });
        context = browser.contexts()[0] ?? (await browser.newContext());
        mode = "cdp";
        console.log(
          `[node] attached to Chrome over CDP at ${cdpUrl} (${context.pages().length} tab(s) open)`,
        );
      } catch {
        browser = null;
        context = null;
      }
    }

    // 2) Launch the user's real Chrome profile.
    if (!context && process.env.BOTIFYR_NODE_FRESH !== "1") {
      try {
        context = await chromium.launchPersistentContext(chromeProfileDir(), {
          channel: "chrome",
          headless: HEADLESS,
        });
        mode = "profile";
      } catch (error) {
        console.log(
          `[node] Chrome profile unavailable (${(error as Error).message.split("\n")[0]}); using a fresh profile.`,
        );
        context = null;
      }
    }

    // 3) Fresh profile.
    if (!context) {
      browser = await chromium.launch({ channel: "chrome", headless: HEADLESS }).catch(() => null);
      if (!browser) browser = await chromium.launch({ headless: HEADLESS });
      context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      mode = "fresh";
    }
  }
  if (!page || page.isClosed()) {
    // In CDP mode, open our own tab so we don't hijack the user's tabs.
    page = mode === "cdp" ? await context.newPage() : (context.pages()[0] ?? (await context.newPage()));
  }
  return page;
}

async function browserAction(
  action: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string; screenshot?: string }> {
  const active = await ensurePage();
  const snap = async () => (await active.screenshot({ type: "png" })).toString("base64");

  switch (action) {
    case "goto":
      await active.goto(String(args.url), { waitUntil: "domcontentloaded", timeout: 30_000 });
      return {
        ok: true,
        output: `Opened ${active.url()} — title: "${await active.title()}"`,
        screenshot: await snap(),
      };
    case "extract": {
      const element = await active.$(String(args.selector));
      if (!element) return { ok: false, output: `No element matched "${args.selector}".` };
      const text = ((await element.textContent()) ?? "").trim();
      return { ok: true, output: `Text of "${args.selector}": ${text || "(empty)"}` };
    }
    case "type":
      await active.fill(String(args.selector), String(args.text));
      return { ok: true, output: `Typed into "${args.selector}".`, screenshot: await snap() };
    case "click":
      await active.click(String(args.selector));
      await active.waitForTimeout(250);
      return { ok: true, output: `Clicked "${args.selector}".`, screenshot: await snap() };
    case "screenshot":
      return { ok: true, output: "Captured a screenshot.", screenshot: await snap() };
    default:
      return { ok: false, output: `Unknown action "${action}".` };
  }
}

/* ------------------------------------------------------------- shell / files */

async function shellAction(
  action: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  switch (action) {
    case "exec": {
      const command = String(args.command ?? "");
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "sh";
      const flag = isWindows ? "/C" : "-c";
      try {
        const { stdout, stderr } = await execFileAsync(shell, [flag, command], {
          timeout: 60_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        return {
          ok: true,
          output: `$ ${command}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trimEnd(),
        };
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          output: `$ ${command}\n${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.trimEnd(),
        };
      }
    }
    case "read":
      return { ok: true, output: (await readFile(String(args.path), "utf8")).slice(0, 200_000) };
    case "write":
      await writeFile(String(args.path), String(args.content ?? ""), "utf8");
      return { ok: true, output: `Wrote ${args.path}` };
    case "list": {
      const entries = await readdir(String(args.path ?? "."), { withFileTypes: true });
      return {
        ok: true,
        output: entries.map((e) => `${e.isDirectory() ? "dir " : "file"} ${e.name}`).join("\n") || "(empty)",
      };
    }
    case "open": {
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, output: "no application name given" };
      if (process.platform === "win32") {
        await execFileAsync("cmd", ["/C", "start", "", name], { timeout: 15_000 });
      } else {
        await execFileAsync("sh", ["-c", `${name} &`], { timeout: 15_000 });
      }
      return { ok: true, output: `Opened "${name}".` };
    }
    default:
      return { ok: false, output: `Unknown action "${action}".` };
  }
}

/* -------------------------------------------------------------------- socket */

const socket = new WebSocket(`${CLOUD.replace(/^http/, "ws")}/v1/node?token=${encodeURIComponent(TOKEN)}`);

socket.onopen = () => {
  console.log(`[node] connected to ${CLOUD} as "${NAME}" (headless=${HEADLESS})`);
  socket.send(JSON.stringify({ type: "node.hello", name: NAME, platform: process.platform }));
};

socket.onmessage = async (message) => {
  let msg: { type?: string; id?: string; action?: string; args?: Record<string, unknown> };
  try {
    msg = JSON.parse(String(message.data));
  } catch {
    return;
  }
  if (msg.type !== "node.request" || !msg.id) return;

  console.log(`[node] ${msg.action}`);
  try {
    const action = String(msg.action);
    const shellActions = ["exec", "read", "write", "list", "open"];
    const result = shellActions.includes(action)
      ? await shellAction(action, msg.args ?? {})
      : await browserAction(action, msg.args ?? {});
    socket.send(JSON.stringify({ type: "node.result", id: msg.id, ...result }));
  } catch (error) {
    socket.send(
      JSON.stringify({
        type: "node.result",
        id: msg.id,
        ok: false,
        output: `Error: ${(error as Error)?.message ?? error}`,
      }),
    );
  }
};

async function shutdown(): Promise<void> {
  // Never close the user's own Chrome when we attached over CDP.
  if (mode === "cdp") return;
  try {
    await context?.close();
    await browser?.close();
  } catch {
    // ignore
  }
}

socket.onclose = () => {
  console.log("[node] disconnected");
  void shutdown().finally(() => process.exit(0));
};
socket.onerror = () => {};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
