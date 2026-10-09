// Capture Reels screenshots headlessly with Playwright.
// Usage: node scripts/reels-screenshots.mjs
// Records a short WebM in-browser (no ffmpeg), uploads it as a reel, then
// captures the Reels view on desktop/tablet/mobile. Only creates its own test
// accounts/posts on the local dev cloud.

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function signupOrLogin(email) {
  try {
    return await req("/auth/signup", { method: "POST", body: { email, password: "screenshots123" } });
  } catch {
    return req("/auth/login", { method: "POST", body: { email, password: "screenshots123" } });
  }
}

const stamp = Date.now().toString(36);
const me = await signupOrLogin(`reels.me.${stamp}@example.test`);
const other = await signupOrLogin(`reels.other.${stamp}@example.test`);
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

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

// 1) Record a short vertical clip with the browser's own MediaRecorder.
const recorder = await browser.newPage();
const webmBase64 = await recorder.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 900000 });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise((resolve) => {
    rec.onstop = resolve;
  });
  rec.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = performance.now() - start;
      const hue = (t / 18) % 360;
      const g = ctx.createLinearGradient(0, 0, 720, 1280);
      g.addColorStop(0, `hsl(${hue}, 72%, 48%)`);
      g.addColorStop(1, `hsl(${(hue + 90) % 360}, 68%, 22%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 720, 1280);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "bold 92px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("BOTIFYR", 360, 620);
      ctx.font = "600 40px sans-serif";
      ctx.fillText("REELS", 360, 700);
      if (t > 1600) {
        resolve();
        return;
      }
      requestAnimationFrame(draw);
    };
    draw();
  });
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: "video/webm" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});
await recorder.close();

const upload = (token, name) =>
  req("/v1/uploads", {
    token,
    method: "POST",
    body: { name, mime: "video/webm", data: `data:video/webm;base64,${webmBase64}` },
  });

const clipOther = await upload(other.token, `reel-${stamp}.webm`);
const clipMe = await upload(me.token, `reel2-${stamp}.webm`);
const postOther = await req("/v1/posts", {
  token: other.token,
  method: "POST",
  body: { body: "Evening light on the harbour. #reels #film", mediaIds: [clipOther.id] },
});
await req("/v1/posts", {
  token: me.token,
  method: "POST",
  body: { body: "Behind the scenes of the new Reels player. #build", mediaIds: [clipMe.id] },
});

// Seed engagement so the rail shows real counts and a filled heart.
await req(`/v1/posts/${postOther.id}/like`, { token: me.token, method: "PUT" });
await req(`/v1/posts/${postOther.id}/comments`, {
  token: me.token,
  method: "POST",
  body: { body: "That gradient is gorgeous." },
});

// 2) Open the app as the viewer and capture the Reels experience.
const context = await browser.newContext();
await context.addInitScript(
  ({ token }) => {
    localStorage.setItem("botifyr.token", token);
    localStorage.setItem("botifyr.theme", "dark");
  },
  { token: me.token },
);
const page = await context.newPage();
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Reels", exact: true }).click();
await page.locator(".reel").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);

const shots = [
  ["reels-desktop-1440", 1440, 900],
  ["reels-tablet-900", 900, 1000],
  ["reels-mobile-390", 390, 844],
];
for (const [name, width, height] of shots) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png`);
}

// Comments sheet evidence.
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
const comments = page.getByRole("button", { name: "Comments" }).first();
if (await comments.count()) {
  await comments.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/reels-comments.png` });
  console.log(`saved ${OUT}/reels-comments.png`);
  await page.keyboard.press("Escape").catch(() => {});
}

await browser.close();
console.log("DONE");
