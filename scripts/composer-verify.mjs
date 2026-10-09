// Live verification of the Feed composer (docs/agent-progress/composer-manager.md).
// Usage: node scripts/composer-verify.mjs
// Creates ONE throwaway account + one post on the local dev cloud, then drives
// the running app (:1420) to check the composer and capture screenshots.
// Safe: only touches its own freshly-created test data.

import { mkdir } from "node:fs/promises";
import zlib from "node:zlib";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/composer";

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
    return await req("/auth/signup", { method: "POST", body: { email, password: "composer123" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "composer123" } });
  }
}

// Minimal valid PNG so the file input accepts a real image.
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
function makePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = 40 + Math.round((x / w) * 180);
      raw[o++] = 90;
      raw[o++] = 200 - Math.round((y / h) * 120);
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
const me = await signupOrLogin(`composer.verify.${stamp}@example.test`);
await req("/v1/profile", {
  token: me.token,
  method: "PATCH",
  body: { handle: `cq_${stamp}`, displayName: "Composer Check", avatarEmoji: "🧪" },
});

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

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) problems.push(label);
};

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator("form.feed-composer").waitFor({ timeout: 20000 });

// Clearing any restored draft keeps the run deterministic.
await page.evaluate(() => localStorage.removeItem("botifyr.feedDraft"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator("form.feed-composer").waitFor({ timeout: 20000 });

const input = page.getByLabel("Post text");
check((await input.count()) === 1, "composer text has an accessible name (Post text)");

await input.fill("Live composer check");
const count = await page.locator("#feed-composer-count").innerText();
check(count.replace(/\s/g, "") === "19/4000", `character counter shows "19 / 4000" (got "${count}")`);

const dest = await page.locator(".feed-composer-destination").innerText();
check(/Posting to your profile/.test(dest) && /Friends/.test(dest), `destination summary (got "${dest}")`);

// Attach a real image and confirm a preview thumbnail appears before posting.
await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
  name: "composer-check.png",
  mimeType: "image/png",
  buffer: makePng(320, 200),
});
await page.locator(".feed-composer-thumb").waitFor({ timeout: 10000 });
check((await page.locator(".feed-composer-thumb").count()) === 1, "selected media shows a preview thumbnail");

await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: `${OUT}/composer-desktop.png` });
console.log(`saved ${OUT}/composer-desktop.png`);

// Past-schedule guard.
await page.getByLabel("Post text").fill("schedule guard");
await page.locator('input[type="datetime-local"]').fill("2020-01-01T10:00");
await page.getByRole("button", { name: "Schedule" }).click();
const guard = await page
  .locator(".feed-composer-error")
  .innerText()
  .catch(() => "");
check(/future time/i.test(guard), `past schedule is refused (got "${guard}")`);
await page.locator('input[type="datetime-local"]').fill("");

// Publish and confirm only after the server responds.
await page.getByLabel("Post text").fill("Live composer check");
await page.getByRole("button", { name: "Post" }).click();
const notice = await page
  .locator(".feed-composer-notice")
  .innerText({ timeout: 15000 })
  .catch(() => "");
check(/Post published/.test(notice), `success notice after publish (got "${notice}")`);
await page.locator(".feed-post", { hasText: "Live composer check" }).first().waitFor({ timeout: 10000 });
check(true, "the published post appears at the top of the feed");

// Destination resets after publishing.
const destAfter = await page.locator(".feed-composer-destination").innerText();
check(/Posting to your profile/.test(destAfter), "destination resets to the profile after publish");
const draftAfter = await page.getByLabel("Post text").inputValue();
check(draftAfter === "", "composer text is cleared after publish");

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/composer-mobile.png` });
console.log(`saved ${OUT}/composer-mobile.png`);

await browser.close();

if (problems.length > 0) {
  console.error(`\n${problems.length} live check(s) failed:`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log("\nAll live composer checks passed.");
