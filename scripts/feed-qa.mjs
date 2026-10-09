// Feed Experience — independent QA harness (headless Playwright).
// Seeds throwaway data, drives the real app, and records pass/fail per journey.
// Usage: node scripts/feed-qa.mjs

import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
/** A 1x1 transparent PNG (valid for the upload guard). */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
}

async function signupOrLogin(email) {
  try {
    return await req("/auth/signup", { method: "POST", body: { email, password: "qa12345678" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "qa12345678" } });
  }
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`qa.${stamp}@example.test`);
const other = await signupOrLogin(`qa.other.${stamp}@example.test`);

await req("/v1/friend-requests", { token: me.token, method: "POST", body: { userId: other.user.id } });
const incoming = await req("/v1/friend-requests", { token: other.token });
const pending = (incoming || []).find((r) => r.direction === "incoming" && r.person?.id === me.user.id);
if (pending) {
  await req(`/v1/friend-requests/${pending.id}`, {
    token: other.token,
    method: "POST",
    body: { action: "accept" },
  });
}

// Seed: a text post, a poll (mine), and an image post + a story (friend's).
await req("/v1/posts", { token: other.token, method: "POST", body: { body: "QA: hello from a friend." } });
await req("/v1/posts", { token: me.token, method: "POST", body: { body: "QA poll", poll: ["Yes", "No"] } });
const media = await req("/v1/uploads", {
  token: other.token,
  method: "POST",
  body: { name: "qa.png", mime: "image/png", data: PNG },
});
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "QA image post", mediaIds: [media.id] },
});
await req("/v1/stories", { token: other.token, method: "POST", body: { mediaId: media.id } });

const results = [];
const record = (name, ok, detail = "") =>
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) });

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript((tk) => {
  localStorage.setItem("botifyr.token", tk);
  localStorage.setItem("botifyr.theme", "dark");
}, me.token);
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(e.message));

try {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Feed" }).click();
  await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
  record("Feed loads posts", (await page.locator(".feed-post").count()) > 0);

  // Action bar
  const actions = page.locator(".feed-post").first().locator(".feed-actions .feed-action");
  const labels = (await actions.allInnerTexts()).join(",");
  record(
    "Action bar = 4 primary + More options",
    (await actions.count()) === 5 &&
      /Like/.test(labels) &&
      /Comment/.test(labels) &&
      /Share/.test(labels) &&
      /Save/.test(labels),
    labels,
  );
  record("More-options control present", (await page.locator(".feed-action-more").count()) > 0);

  // Overflow menu open/close
  await page.locator(".feed-action-more").first().click();
  await page.waitForTimeout(200);
  record("Overflow menu opens", (await page.locator(".feed-menu").count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  record("Overflow menu closes on Escape", (await page.locator(".feed-menu").count()) === 0);

  // Like → picker (opens on hover) → Love
  const likeBtn = page.getByRole("button", { name: "Like" }).first();
  await likeBtn.hover();
  await page.waitForTimeout(300);
  const love = page.locator('.reaction-btn[aria-label="Love"]').first();
  if (await love.count()) {
    await love.click();
    await page.waitForTimeout(500);
    record("Reacting sets Love", (await page.getByRole("button", { name: /Love/ }).count()) > 0);
  } else {
    record("Reacting sets Love", false, "reaction picker not found on hover");
  }

  // Comment submit
  await page.getByRole("button", { name: "Comment" }).first().click();
  await page.waitForTimeout(400);
  const commentInput = page.locator(".feed-comment-input").first();
  if (await commentInput.count()) {
    await commentInput.fill("QA comment");
    await commentInput.press("Enter");
    await page.waitForTimeout(800);
    record("Comment submits", (await page.getByText("QA comment").count()) > 0);
  } else {
    record("Comment submits", false, "comment input not found");
  }

  // Poll vote
  const pollOption = page.locator(".feed-poll-option").first();
  if (await pollOption.count()) {
    await pollOption.click();
    await page.waitForTimeout(500);
    record("Poll vote renders percentages", (await page.locator(".feed-poll-pct").count()) > 0);
  } else {
    record("Poll vote renders percentages", false, "poll not found");
  }

  // Post image → lightbox → Escape
  const image = page.locator(".feed-post img.feed-image-img").first();
  if (await image.count()) {
    await image.click();
    await page.waitForTimeout(400);
    record("Image lightbox opens", (await page.locator(".feed-lightbox, [role='dialog']").count()) > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    record("Lightbox closes on Escape", (await page.locator(".feed-lightbox").count()) === 0);
  } else {
    record("Image lightbox opens", false, "no post image found");
  }

  // Story viewer
  const storyTile = page.locator(".story-tile").last();
  if ((await storyTile.count()) > 0) {
    await storyTile.click();
    await page.waitForTimeout(500);
    record("Story viewer opens", (await page.locator("[role='dialog']").count()) > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } else {
    record("Story viewer opens", false, "no story tile");
  }

  // Reels view + mute
  await page.getByRole("button", { name: "Reels" }).first().click();
  await page.waitForTimeout(600);
  const reelsVisible = (await page.locator(".reels-scroll").count()) > 0;
  record("Reels view opens", reelsVisible);
  if (reelsVisible) {
    record(
      "Reels mute control present",
      (await page.getByRole("button", { name: /mute|sound/i }).count()) > 0,
    );
    await page.getByRole("button", { name: /back/i }).first().click();
    await page.waitForTimeout(300);
  }

  // Mobile drawer + overflow
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const navBtn = page.locator(".mobile-nav-btn").first();
  if (await navBtn.count()) {
    await navBtn.click();
    await page.waitForTimeout(400);
    record("Mobile nav drawer opens", (await page.locator(".app.mobile-nav-open").count()) > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  } else {
    record("Mobile nav drawer opens", false, "no .mobile-nav-btn at 390px");
  }
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  record("No horizontal overflow at 390px", scrollWidth <= 390, `scrollWidth=${scrollWidth}`);

  await page.screenshot({ path: "docs/assets/feed/qa-mobile.png" });
} catch (err) {
  record("Harness completed", false, err instanceof Error ? err.message : String(err));
}

record("No console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ results, failed: failed.length, consoleErrors: consoleErrors.length }, null, 2));
console.log(failed.length === 0 ? "QA_PASS" : `QA_FAIL (${failed.length})`);
