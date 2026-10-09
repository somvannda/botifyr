// Verify the Feed & Discovery timeline mechanics headlessly.
// Usage: node scripts/feed-discovery-verify.mjs
// Creates its own throwaway account + posts on the local dev cloud. Safe.
//
// Checks: initial page size, infinite-scroll auto-load, de-duplication,
// end-of-feed state, manual refresh, and scroll restoration after Reels.

import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/feed";

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
    return await req("/auth/signup", { method: "POST", body: { email, password: "discovery123" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "discovery123" } });
  }
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`disc.me.${stamp}@example.test`);
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `disc_${stamp}`, displayName: "Discovery Probe", avatarEmoji: "🛰️" },
});

const COUNT = 25; // > page size (20) so a second page is required.
for (let i = 0; i < COUNT; i++) {
  await req("/v1/posts", {
    token: me.token,
    method: "POST",
    body: { body: `Pagination probe ${String(i).padStart(3, "0")} ${stamp}` },
  });
  await new Promise((resolve) => setTimeout(resolve, 15)); // distinct createdAt per post
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
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
await page.screenshot({ path: `${OUT}/discovery-feed-order.png` });

async function probeBodies() {
  return page.$$eval(".feed-body", (els) =>
    els.map((el) => el.textContent || "").filter((text) => text.includes("Pagination probe")),
  );
}

const results = [];
const initial = await probeBodies();
results.push(`initial probe posts: ${initial.length} (expect 20)`);

// Scroll the timeline to the bottom; infinite scroll should fetch page 2.
let sawEnd = false;
for (let attempt = 0; attempt < 12; attempt++) {
  await page.locator(".feed-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(600);
  if ((await page.locator(".feed-end").count()) > 0) {
    sawEnd = true;
    break;
  }
}

const after = await probeBodies();
const unique = new Set(after).size;
results.push(`after auto-load probe posts: ${after.length} (expect 25)`);
results.push(`unique probe posts: ${unique} (expect 25 — no duplicates)`);
const liveText =
  (await page
    .locator('.visually-hidden[aria-live="polite"]')
    .first()
    .textContent()
    .catch(() => "")) || "";
results.push(`pagination live-region: "${liveText.trim()}"`);
results.push(`end-of-feed state shown: ${sawEnd}`);
results.push(
  `end-of-feed text: "${
    (await page
      .locator(".feed-end")
      .first()
      .textContent()
      .catch(() => "")) || ""
  }"`,
);
results.push(
  `end-of-feed role: ${await page
    .locator(".feed-end")
    .first()
    .getAttribute("role")
    .catch(() => null)}`,
);
await page
  .locator(".feed-end")
  .scrollIntoViewIfNeeded()
  .catch(() => {});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/discovery-end-of-feed.png` });

// Manual refresh from the topbar.
const before = await page.locator(".feed-post").count();
await page.getByRole("button", { name: "Refresh feed" }).click();
await page.waitForTimeout(900);
const refreshed = await page.locator(".feed-post").count();
results.push(`manual refresh: posts before=${before}, after=${refreshed}`);

// Scroll restoration: leave for Reels and return to the same offset.
await page.locator(".feed-scroll").evaluate((el) => {
  el.scrollTop = 700;
});
await page.waitForTimeout(250);
const scrollBefore = await page.locator(".feed-scroll").evaluate((el) => el.scrollTop);
await page.getByRole("button", { name: "Reels" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Back/ }).first().click();
await page.waitForTimeout(600);
const scrollAfter = await page.locator(".feed-scroll").evaluate((el) => el.scrollTop);
results.push(`scroll restoration: before=${scrollBefore}, after=${scrollAfter}`);
await page.screenshot({ path: `${OUT}/discovery-restored.png` });

// Timeline order: composer → Stories → posts (Agent 3 Phase 2).
const order = await page.evaluate(() => {
  const composer = document.querySelector(".feed-composer");
  const stories = document.querySelector(".stories-strip");
  const post = document.querySelector(".feed-post");
  const following = (a, b) => !!a && !!b && (a.compareDocumentPosition(b) & 4) !== 0;
  return `composer<stories=${following(composer, stories)}, stories<post=${following(stories, post)}`;
});
results.push(`timeline order: ${order}`);

// Accessibility: the new controls must be reachable and named.
const refreshLabel = await page
  .getByRole("button", { name: "Refresh feed" })
  .getAttribute("aria-label")
  .catch(() => null);
results.push(`a11y: Refresh control aria-label="${refreshLabel}"`);
const sortVisible = await page
  .getByRole("combobox", { name: "Sort feed" })
  .isVisible()
  .catch(() => false);
results.push(`a11y: labelled Sort control visible=${sortVisible}`);

// Responsive: a narrow viewport must not overflow horizontally.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const layout = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
results.push(
  `mobile 390: scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth} (no overflow if scrollWidth <= innerWidth)`,
);
const mobileRefreshVisible = await page.getByRole("button", { name: "Refresh feed" }).isVisible();
results.push(`mobile 390: Refresh control visible=${mobileRefreshVisible}`);
await page.screenshot({ path: `${OUT}/discovery-mobile.png` });
await page.setViewportSize({ width: 1440, height: 900 });

// Freshness fallback: publish a new post, then wake the app (visibility) and
// expect the "New activity" banner to appear without disturbing the list.
await req("/v1/posts", {
  token: me.token,
  method: "POST",
  body: { body: `Fresh post ${stamp}` },
});
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const wokeBanner = await page
  .locator(".feed-new-banner")
  .first()
  .waitFor({ timeout: 6000 })
  .then(() => true)
  .catch(() => false);
results.push(`fresh-content banner on wake: ${wokeBanner}`);
if (wokeBanner) {
  await page.screenshot({ path: `${OUT}/discovery-new-activity.png` });
  await page.locator(".feed-new-banner").first().click();
  await page.waitForTimeout(500);
  results.push(`banner cleared after tap: ${(await page.locator(".feed-new-banner").count()) === 0}`);
}

// Note: the live *realtime* banner path still cannot be triggered because the
// cloud's websocket filter (canReceive) drops `feed.*` events (DB-1); the
// focus/visibility fallback above covers the same UX without it.
results.push(
  `console errors: ${consoleErrors.length}${consoleErrors.length ? " :: " + consoleErrors[0] : ""}`,
);

await browser.close();
console.log(results.join("\n"));
console.log("DONE");
