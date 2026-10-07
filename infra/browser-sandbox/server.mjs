import http from "node:http";
import { chromium } from "playwright";

/**
 * Browser sandbox service.
 *
 * Runs inside the per-task container. Exposes a minimal HTTP API so the agent
 * (running in the cloud process) can drive a browser that is isolated from it.
 *
 *   GET  /health          -> "ok"
 *   POST /action          -> { ok, output, screenshot? }
 *        body: { action: "goto" | "extract" | "type" | "click" | "screenshot" | "sniff", args }
 */

let browser = null;
let page = null;
// Media responses seen since the last main navigation — lets the agent discover
// the real stream URL (m3u8/mp4) on sites yt-dlp doesn't support.
let mediaUrls = [];
const MEDIA_RE = /\.(m3u8|mp4|ts|m4s|mpd)(\?|#|$)/i;

async function ensurePage() {
  if (!browser) {
    // --no-sandbox is required when running Chromium as root in a container.
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  }
  if (!page) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.on("response", (response) => {
      const url = response.url();
      if (MEDIA_RE.test(url) && !mediaUrls.includes(url)) mediaUrls.push(url);
    });
  }
  return page;
}

async function snap(active) {
  return (await active.screenshot({ type: "png" })).toString("base64");
}

const actions = {
  async goto({ url }) {
    const active = await ensurePage();
    mediaUrls = [];
    await active.goto(String(url), { waitUntil: "domcontentloaded", timeout: 20000 });
    const title = await active.title();
    return { ok: true, output: `Opened ${active.url()} — title: "${title}"`, screenshot: await snap(active) };
  },

  async extract({ selector }) {
    const active = await ensurePage();
    const element = await active.$(String(selector));
    if (!element) return { ok: false, output: `No element matched "${selector}".` };
    const text = ((await element.textContent()) ?? "").trim();
    return { ok: true, output: `Text of "${selector}": ${text || "(empty)"}` };
  },

  async type({ selector, text }) {
    const active = await ensurePage();
    await active.fill(String(selector), String(text));
    return { ok: true, output: `Typed into "${selector}".`, screenshot: await snap(active) };
  },

  async click({ selector }) {
    const active = await ensurePage();
    await active.click(String(selector));
    await active.waitForTimeout(250);
    return { ok: true, output: `Clicked "${selector}".`, screenshot: await snap(active) };
  },

  async screenshot() {
    const active = await ensurePage();
    return { ok: true, output: "Captured a screenshot of the current page.", screenshot: await snap(active) };
  },

  async sniff({ waitMs }) {
    const active = await ensurePage();
    const wait = Math.min(15000, Math.max(0, Number(waitMs) || 0));
    if (wait > 0) await active.waitForTimeout(wait);
    if (mediaUrls.length === 0) {
      return {
        ok: false,
        output: "No media URLs captured yet. Navigate to the video page and press play, then sniff again.",
      };
    }
    const list = mediaUrls.map((url, index) => `${index + 1}. ${url}`).join("\n");
    return { ok: true, output: `Captured ${mediaUrls.length} media URL(s):\n${list}` };
  },
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function sendJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const port = Number(process.env.PORT ?? 8788);

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.method === "POST" && request.url === "/action") {
    try {
      const body = JSON.parse((await readBody(request)) || "{}");
      const handler = actions[body.action];
      if (!handler) {
        sendJson(response, { ok: false, output: `Unknown action "${body.action}".` });
        return;
      }
      sendJson(response, await handler(body.args ?? {}));
    } catch (error) {
      sendJson(response, { ok: false, output: `Error: ${error?.message ?? error}` });
    }
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`botifyr browser sandbox listening on ${port}`);
});
