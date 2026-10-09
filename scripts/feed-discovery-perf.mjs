// Feed & Discovery — performance/reliability + responsive verification.
// Usage: node scripts/feed-discovery-perf.mjs
// Seeds its own throwaway account with 60 posts, then verifies that infinite
// scrolling issues exactly the expected number of /v1/feed requests (no
// duplicates), never loops after the end, and lays out cleanly at tablet/wide
// widths. Safe: only creates its own test data.

import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/feed";
const PAGE_SIZE = 20;
const COUNT = 60;

async function req(path, { token, method = "GET", body } = {}) {
  const res = await fetch(CLOUD + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function signupOrLogin(email) {
  try {
    return await req("/auth/signup", { method: "POST", body: { email, password: "perf12345" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "perf12345" } });
  }
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`perf.me.${stamp}@example.test`);
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `perf_${stamp}`, displayName: "Perf Probe", avatarEmoji: "🧪" },
});

for (let i = 0; i < COUNT; i++) {
  await req("/v1/posts", {
    token: me.token,
    method: "POST",
    body: { body: `Perf probe ${String(i).padStart(3, "0")} ${stamp}` },
  });
  await new Promise((resolve) => setTimeout(resolve, 12)); // distinct createdAt
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(
  ({ token }) => {
    localStorage.setItem("botifyr.token", token);
    localStorage.setItem("botifyr.theme", "dark");
    localStorage.setItem("botifyr.feedTab", "all");
    localStorage.setItem("botifyr.feedSort", "recent");
  },
  { token: me.token },
);
const page = await context.newPage();

const feedCalls = [];
const consoleErrors = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname === "/v1/feed") feedCalls.push(url.searchParams.get("cursor") ?? "<reset>");
});
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 20000 });

async function scrollToBottom() {
  await page.locator(".feed-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(350);
}

const results = [];
const startedAt = Date.now();
let sawEnd = false;
for (let attempt = 0; attempt < 40 && !sawEnd; attempt++) {
  await scrollToBottom();
  sawEnd = (await page.locator(".feed-end").count()) > 0;
}
const elapsedMs = Date.now() - startedAt;

const rendered = await page.locator(".feed-post").count();
const bodies = await page.$$eval(".feed-body", (els) =>
  els.map((el) => el.textContent || "").filter((t) => t.includes("Perf probe")),
);
const uniqueBodies = new Set(bodies).size;
const expectedPages = Math.ceil(COUNT / PAGE_SIZE);

results.push(`rendered posts: ${rendered} (expect ${COUNT})`);
results.push(`unique probe bodies: ${uniqueBodies} (expect ${COUNT})`);
results.push(
  `/v1/feed requests: ${feedCalls.length} (expect ${expectedPages}: 1 reset + ${expectedPages - 1} cursor pages)`,
);
results.push(`distinct cursors: ${new Set(feedCalls).size} (expect ${feedCalls.length})`);
results.push(`request sequence: [${feedCalls.join(", ")}]`);
results.push(`end-of-feed reached: ${sawEnd}`);
results.push(`scroll-to-end wall time: ${elapsedMs}ms for ${expectedPages} pages`);

// After the end, further scrolling must NOT trigger more requests (no loop).
const callsAtEnd = feedCalls.length;
for (let i = 0; i < 5; i++) await scrollToBottom();
results.push(
  `extra /v1/feed requests after end: ${feedCalls.length - callsAtEnd} (expect 0 — no infinite-scroll loop)`,
);

// Responsive: tablet and wide.
for (const [name, width, height] of [
  ["discovery-tablet", 900, 1000],
  ["discovery-wide", 1680, 1000],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  results.push(
    `${name} @${width}: scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth} (no overflow if <=)`,
  );
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

results.push(
  `console errors: ${consoleErrors.length}${consoleErrors.length ? " :: " + consoleErrors[0] : ""}`,
);
await browser.close();
console.log(results.join("\n"));
console.log("DONE");
