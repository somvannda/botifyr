// Feed & Discovery — large-feed scale evidence (decides FEED-D9 virtualization).
// Usage: node scripts/feed-discovery-scale.mjs
// Seeds a throwaway account with many posts, scrolls the whole timeline, and
// measures rendered node count, pagination calls, wall time, and long tasks.

import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/feed";
const COUNT = Number(process.env.SCALE_POSTS || 120);

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
    return await req("/auth/signup", { method: "POST", body: { email, password: "scale12345" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "scale12345" } });
  }
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`scale.me.${stamp}@example.test`);
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `scale_${stamp}`, displayName: "Scale Probe", avatarEmoji: "📈" },
});

const seedStart = Date.now();
for (let i = 0; i < COUNT; i++) {
  await req("/v1/posts", {
    token: me.token,
    method: "POST",
    body: { body: `Scale probe ${String(i).padStart(4, "0")} ${stamp}` },
  });
  // Distinct timestamps so pagination is not confounded by equal createdAt.
  await new Promise((resolve) => setTimeout(resolve, 10));
}
const seedMs = Date.now() - seedStart;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(
  ({ token }) => {
    localStorage.setItem("botifyr.token", token);
    localStorage.setItem("botifyr.theme", "dark");
    localStorage.setItem("botifyr.feedTab", "all");
    localStorage.setItem("botifyr.feedSort", "recent");
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // longtask unsupported; leave empty
    }
  },
  { token: me.token },
);
const page = await context.newPage();
let feedCalls = 0;
page.on("request", (request) => {
  if (new URL(request.url()).pathname === "/v1/feed") feedCalls += 1;
});

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 25000 });

const scrollStart = Date.now();
let sawEnd = false;
for (let attempt = 0; attempt < 120 && !sawEnd; attempt++) {
  await page.locator(".feed-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(180);
  sawEnd = (await page.locator(".feed-end").count()) > 0;
}
const scrollMs = Date.now() - scrollStart;

const stats = await page.evaluate(() => {
  const longTasks = window.__longTasks ?? [];
  return {
    posts: document.querySelectorAll(".feed-post").length,
    nodes: document.querySelectorAll(".feed-scroll *").length,
    longTasks: longTasks.length,
    worstLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
    totalLongTaskMs: longTasks.reduce((a, b) => a + b, 0),
  };
});

await page.screenshot({ path: `${OUT}/discovery-scale.png` });
await browser.close();

console.log(`seeded posts: ${COUNT} in ${seedMs}ms`);
console.log(`rendered .feed-post nodes: ${stats.posts}`);
console.log(`DOM nodes under .feed-scroll: ${stats.nodes}`);
console.log(`/v1/feed requests: ${feedCalls}`);
console.log(`scroll-to-end wall time: ${scrollMs}ms`);
console.log(
  `long tasks (>50ms): ${stats.longTasks}, worst ${stats.worstLongTaskMs}ms, total ${stats.totalLongTaskMs}ms`,
);
console.log(`end-of-feed reached: ${sawEnd}`);
console.log("DONE");
