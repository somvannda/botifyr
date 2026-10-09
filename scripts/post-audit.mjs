// Post-level audit + visual evidence for the Post Manager assignment.
// Usage: node scripts/post-audit.mjs
// Seeds throwaway accounts/posts on the local dev cloud, opens the desktop dev
// host, captures post-card screenshots into docs/assets/post/, and prints a
// small JSON report of DOM/accessibility checks. Safe: only its own test data.

import { mkdir } from "node:fs/promises";
import zlib from "node:zlib";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/post";

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
    return await req("/auth/signup", { method: "POST", body: { email, password: "postaudit123" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "postaudit123" } });
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
function makePng(w, h, top, bottom) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    const f = y / (h - 1);
    for (let x = 0; x < w; x++) {
      raw[o++] = Math.round(top[0] + (bottom[0] - top[0]) * f);
      raw[o++] = Math.round(top[1] + (bottom[1] - top[1]) * f);
      raw[o++] = Math.round(top[2] + (bottom[2] - top[2]) * f);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`post.viewer.${stamp}@example.test`);
const other = await signupOrLogin(`post.author.${stamp}@example.test`);
await req("/v1/profile", {
  token: other.token,
  method: "PATCH",
  body: { handle: `posty_${stamp}`, displayName: "Posty McPostface", avatarEmoji: "🦊" },
});
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `viewer_${stamp}`, displayName: "Viewer", avatarEmoji: "🐸" },
});
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

// Text post with a URL, hashtags and a mention.
const linkBody = [
  "Reading the release notes for the new feed renderer.",
  "",
  "Notes live at https://example.com/feed-notes and the summary is short.",
  `Thanks @viewer_${stamp} for the review. #feed #design`,
].join("\n");
await req("/v1/posts", { token: other.token, method: "POST", body: { body: linkBody } });

// Long post.
const longBody = Array.from(
  { length: 18 },
  (_, i) => `Section ${i + 1}: ${"Building a calmer post layout takes restraint and iteration. ".repeat(3)}`,
).join("\n\n");
await req("/v1/posts", { token: other.token, method: "POST", body: { body: longBody } });

// Single image.
const single = await req("/v1/uploads", {
  token: other.token,
  method: "POST",
  body: {
    name: "single.png",
    mime: "image/png",
    data: "data:image/png;base64," + makePng(900, 600, [247, 151, 30], [120, 40, 200]).toString("base64"),
  },
});
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "Took this on the walk home.", mediaIds: [single.id] },
});

// Three-image grid.
const gridIds = [];
const pairs = ["#28b478|#1e5ac8", "#f05078|#f0b428", "#5078f0|#b43cdc"];
for (let i = 0; i < pairs.length; i++) {
  const [a, b] = pairs[i]
    .split("|")
    .map((hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
  const up = await req("/v1/uploads", {
    token: other.token,
    method: "POST",
    body: {
      name: `grid-${i}.png`,
      mime: "image/png",
      data: "data:image/png;base64," + makePng(900, 900, a, b).toString("base64"),
    },
  });
  gridIds.push(up.id);
}
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "Three from the trip.", mediaIds: gridIds },
});

// Poll.
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "Which should we build next?", poll: ["Comments polish", "Reaction detail", "Share sheet"] },
});

// Video post. A real decode isn't needed to verify the <video> element renders;
// the server classifies media by file extension.
const clip = await req("/v1/uploads", {
  token: other.token,
  method: "POST",
  body: {
    name: "clip.mp4",
    mime: "video/mp4",
    data:
      "data:video/mp4;base64," +
      Buffer.from("000000206674797069736f6d0000020069736f6d", "hex").toString("base64"),
  },
});
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "A short clip from the trip.", mediaIds: [clip.id] },
});

// A repost of the single-image post, owned by the viewer.
const feed = await req("/v1/feed", { token: me.token });
const target = (feed.items || []).find((p) => p.body === "Took this on the walk home.");
if (target) await req(`/v1/posts/${target.id}/repost`, { token: me.token, method: "POST", body: {} });

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(
  ({ token }) => {
    localStorage.setItem("botifyr.token", token);
    localStorage.setItem("botifyr.theme", "dark");
  },
  { token: me.token },
);
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

// The dev cloud does not reliably classify uploaded videos, so inject a
// `videos[]` entry to exercise the UI's <video> rendering + accessible name
// end-to-end (the media path may 404, but the element must still render).
let videoInjected = false;
await page.route(/\/v1\/feed(\?|$)/, async (route) => {
  const response = await route.fetch();
  const json = await response.json().catch(() => null);
  if (json?.items) {
    const validSrc = json.items.map((p) => p.imageUrl || (p.images && p.images[0])).find(Boolean);
    for (const post of json.items) {
      if (post.body === "A short clip from the trip.") {
        post.videos = [validSrc ?? "/v1/feed/image?t=audit-video"];
        videoInjected = true;
      }
    }
  }
  await route.fulfill({ response, json });
});

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(600);

async function shot(name, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

await shot("feed-desktop");

// Each post card screenshot by body text.
async function cardOf(text) {
  return page.locator(".feed-post").filter({ hasText: text }).first();
}

const report = {};
report.videoInjected = videoInjected;
report.actionButtons = await page.locator(".feed-post").first().locator(".feed-actions button").count();
report.actionLabels = await page
  .locator(".feed-post")
  .first()
  .locator(".feed-actions button")
  .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent?.trim()));

const linkCard = await cardOf("Reading the release notes");
if (await linkCard.count()) {
  await linkCard.screenshot({ path: `${OUT}/card-text.png` });
  report.textLinksInBody = await linkCard.locator(".feed-body a").count();
  report.textHashtagButtons = await linkCard.locator(".feed-tag").count();
}

const longCard = await cardOf("Section 18");
if (await longCard.count()) {
  await longCard.screenshot({ path: `${OUT}/card-long-clamped.png` });
  report.longClamped = (await longCard.locator(".feed-body").first().getAttribute("class")) || "";
  const seeMore = longCard.getByRole("button", { name: "See more" });
  if (await seeMore.count()) {
    await seeMore.click();
    await page.waitForTimeout(200);
  }
  await longCard.screenshot({ path: `${OUT}/card-long-expanded.png` });
}

const imageCard = await cardOf("Took this on the walk home.");
if (await imageCard.count()) await imageCard.screenshot({ path: `${OUT}/card-image.png` });

const gridCard = await cardOf("Three from the trip.");
if (await gridCard.count()) await gridCard.screenshot({ path: `${OUT}/card-grid.png` });

const pollCard = await cardOf("Which should we build next?");
if (await pollCard.count()) await pollCard.screenshot({ path: `${OUT}/card-poll.png` });

const videoCard = await cardOf("A short clip from the trip.");
if (await videoCard.count()) {
  const videoEls = videoCard.locator("video.feed-video");
  report.videoPosts = await videoEls.count();
  if (report.videoPosts > 0) {
    report.videoAriaLabel = await videoEls.first().getAttribute("aria-label");
    await videoCard.screenshot({ path: `${OUT}/card-video.png` });
  }
}

// More menu on the first author (non-owned) post.
const firstOther = page.locator(".feed-post").filter({ hasText: "Reading the release notes" }).first();
if (await firstOther.count()) {
  await firstOther.getByRole("button", { name: "More options" }).click();
  await page.waitForTimeout(200);
  report.menuItems = await firstOther.locator('[role="menuitem"]').allTextContents();
  await firstOther.screenshot({ path: `${OUT}/card-menu.png` });
  // Does Escape close it?
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  report.menuClosedByEscape = (await firstOther.locator('[role="menuitem"]').count()) === 0;
  if (!report.menuClosedByEscape) {
    await firstOther.getByRole("button", { name: "More options" }).click();
    await page.waitForTimeout(100);
  }
}

// Own post: does Delete confirm?
const ownCard = page.locator(".feed-post").filter({ hasText: "Shared a post" }).first();
if (await ownCard.count()) {
  await ownCard.getByRole("button", { name: "More options" }).click();
  await page.waitForTimeout(150);
  const del = ownCard.getByRole("menuitem", { name: "Delete post" });
  report.ownHasDelete = (await del.count()) > 0;
  if (report.ownHasDelete) {
    await del.click();
    await page.waitForTimeout(300);
    report.deleteDialogAppeared = (await page.getByRole("alertdialog").count()) > 0;
    report.postStillPresentAfterDeleteClick =
      (await page.locator(".feed-post").filter({ hasText: "Shared a post" }).count()) > 0;
    await page.screenshot({ path: `${OUT}/confirm-delete.png` });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }
}

// Force a reaction request to fail and confirm the optimistic update rolls back
// with an inline error (POST-4), live in the browser.
const reactionRoute = /\/v1\/posts\/[^/]+\/reaction(\?|$)/;
await page.route(reactionRoute, (route) => route.abort());
const reactCard = page.locator(".feed-post").filter({ hasText: "Reading the release notes" }).first();
if (await reactCard.count()) {
  const before = await reactCard.locator(".feed-reaction-summary").count();
  await reactCard.getByRole("button", { name: "Like" }).click();
  await reactCard.getByRole("button", { name: "Love" }).click();
  await page.waitForTimeout(600);
  report.failedReactionShowsError = (await reactCard.locator(".feed-post-feedback.error").count()) > 0;
  report.failedReactionRolledBack = (await reactCard.locator(".feed-reaction-summary").count()) === before;
  report.failedReactionFeedback =
    (await reactCard
      .locator(".feed-post-feedback")
      .first()
      .textContent()
      .catch(() => null)) ?? null;
  await reactCard.screenshot({ path: `${OUT}/card-react-error.png` });
}
await page.unroute(reactionRoute);

// Responsive.
await shot("card-mobile", 390, 844);
report.horizontalOverflow390 = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);

report.consoleErrors = consoleErrors
  .filter((e) => !/ERR_FAILED|ERR_EMPTY_RESPONSE|status of 404/.test(e))
  .slice(0, 10);
report.expectedAbortErrors = consoleErrors.filter((e) => /ERR_FAILED/.test(e)).length;
report.expectedInjectedMediaErrors = consoleErrors.filter((e) => /status of 404/.test(e)).length;

await browser.close();
console.log(JSON.stringify(report, null, 2));
