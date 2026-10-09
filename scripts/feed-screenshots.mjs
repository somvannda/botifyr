// Capture Feed screenshots headlessly with Playwright.
// Usage: node scripts/feed-screenshots.mjs
// Creates throwaway accounts/posts on the local dev cloud, then writes PNGs to
// docs/assets/feed/. Safe: only creates its own test data.

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import zlib from "node:zlib";
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
    const out = await req("/auth/signup", { method: "POST", body: { email, password: "screenshots123" } });
    return out;
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "screenshots123" } });
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
    const r = Math.round(top[0] + (bottom[0] - top[0]) * f);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * f);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * f);
    for (let x = 0; x < w; x++) {
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
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
const me = await signupOrLogin(`shot.me.${stamp}@example.test`);
const other = await signupOrLogin(`shot.other.${stamp}@example.test`);
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `dev_${stamp}`, displayName: "Dev Reviewer", avatarEmoji: "🦊" },
});
await req("/v1/profile", {
  token: other.token,
  method: "PATCH",
  body: { handle: `cara_${stamp}`, displayName: "Cara", avatarEmoji: "🐸" },
});
await req("/v1/friend-requests", { token: me.token, method: "POST", body: { userId: other.user.id } });
const incoming = await req("/v1/friend-requests", { token: other.token });
const pending = (incoming || []).find((r) => r.direction === "incoming" && r.person?.id === me.user.id);
if (pending)
  await req(`/v1/friend-requests/${pending.id}`, {
    token: other.token,
    method: "POST",
    body: { action: "accept" },
  });

const longBody = [
  "Rebuilt the Feed card today and wrote down the rules we settled on.",
  "",
  "Hierarchy first: author → content → media → social proof → actions. When everything shares one weight, nothing reads.",
  "Scannability second: bold names, quiet metadata, generous line-height.",
  "Restraint third: four primary actions, everything else behind one menu.",
  `Curious what you think @cara_${stamp}. #design #feed #ux`,
].join("\n");
await req("/v1/posts", { token: me.token, method: "POST", body: { body: longBody } });

const png = makePng(900, 600, [247, 151, 30], [120, 40, 200]);
const media = await req("/v1/uploads", {
  token: other.token,
  method: "POST",
  body: { name: "sunset.png", mime: "image/png", data: "data:image/png;base64," + png.toString("base64") },
});
await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "Took this on the walk home.", mediaIds: [media.id] },
});
const g = ["#28b478|#1e5ac8", "#f05078|#f0b428", "#5078f0|#b43cdc"].map((pair, i) => {
  const [a, b] = pair
    .split("|")
    .map((hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
  return makePng(900, 900, a, b).toString("base64");
});
const gridIds = [];
for (let i = 0; i < g.length; i++) {
  const up = await req("/v1/uploads", {
    token: me.token,
    method: "POST",
    body: { name: `grid-${i}.png`, mime: "image/png", data: "data:image/png;base64," + g[i] },
  });
  gridIds.push(up.id);
}
await req("/v1/posts", {
  token: me.token,
  method: "POST",
  body: { body: "Three from the trip.", mediaIds: gridIds },
});
await req("/v1/posts", { token: other.token, method: "POST", body: { body: "Short one." } });

const storyPng = makePng(720, 1280, [80, 40, 200], [240, 120, 40]);
const storyMedia = await req("/v1/uploads", {
  token: me.token,
  method: "POST",
  body: {
    name: "story.png",
    mime: "image/png",
    data: "data:image/png;base64," + storyPng.toString("base64"),
  },
});
await req("/v1/stories", { token: me.token, method: "POST", body: { mediaId: storyMedia.id } });

/* A Page destination (docs/pages-implementation-plan.md): identity, a
   Page-authored post, an About section, and a URL call-to-action. */
const studioPage = await req("/v1/pages", {
  token: me.token,
  method: "POST",
  body: {
    name: `Northwind Studio ${stamp}`,
    category: "Design studio",
    about: "We design calm interfaces and write about the process behind them.",
    cta: "Visit shop",
    ctaUrl: "https://example.com/work",
  },
});
await req("/v1/posts", {
  token: me.token,
  method: "POST",
  body: { body: "Kicking off the studio Page with a look at our process. #design", pageId: studioPage.id },
});

await mkdir(dirname(`${OUT}/desktop.png`), { recursive: true });

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

async function openFeed() {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Feed" }).click();
  await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
}

async function shot(name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png`);
}

await openFeed();
await shot("desktop-1440", 1440, 900);
await shot("tablet-900", 900, 1000);
await shot("mobile-390", 390, 844);

await page.locator(".mobile-nav-btn").first().click();
await page.waitForTimeout(450);
await page.screenshot({ path: `${OUT}/mobile-nav.png` });
console.log(`saved ${OUT}/mobile-nav.png`);
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await page.locator(".feed-action-more").first().click();
await page.waitForTimeout(200);
await page.screenshot({
  path: `${OUT}/menu-open.png`,
  clip: await page.locator(".feed-post").first().boundingBox(),
});
console.log(`saved ${OUT}/menu-open.png`);

const toggle = page.getByRole("button", { name: "See more" }).first();
if (await toggle.count()) {
  await toggle.click();
  await page.waitForTimeout(200);
}
await page
  .locator(".feed-post")
  .filter({ hasText: "Rebuilt the Feed card" })
  .screenshot({ path: `${OUT}/long-post.png` });
console.log(`saved ${OUT}/long-post.png`);

const storyTile = page.locator(".story-tile").nth(1);
if (await storyTile.count()) {
  await storyTile.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/story-viewer.png` });
  console.log(`saved ${OUT}/story-viewer.png`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);

/* Page destination screenshots (Posts, About, mobile). */
const yourPages = page.locator(".feed-rail-section").filter({ hasText: "Your Pages" });
if (await yourPages.count()) {
  await yourPages.getByRole("button", { name: "View" }).first().click();
  await page.locator(".page-head").waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/page-desktop.png` });
  console.log(`saved ${OUT}/page-desktop.png`);

  await page.getByRole("tab", { name: "About" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/page-about.png` });
  console.log(`saved ${OUT}/page-about.png`);
  await page.getByRole("tab", { name: "Posts" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/page-mobile.png` });
  console.log(`saved ${OUT}/page-mobile.png`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.locator(".feed-topbar button", { hasText: "Back" }).click();
  await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
}

const gridImg = page.locator(".feed-image-grid .feed-image-img").first();
if (await gridImg.count()) {
  await gridImg.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/lightbox.png` });
  console.log(`saved ${OUT}/lightbox.png`);
}

await browser.close();
console.log("DONE");
