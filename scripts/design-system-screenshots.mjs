// Capture design-system evidence (Feed, both themes, responsive widths).
// Usage: node scripts/design-system-screenshots.mjs
//   DSM_TOKEN=<token> reuses an existing session (fresh contexts may not
//   authenticate, as the app can require device keys).
// Otherwise creates its own throwaway account/post on the local dev cloud. Safe.

import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const CLOUD = process.env.CLOUD_URL || "http://localhost:8787";
const APP = process.env.APP_URL || "http://localhost:1420";
const OUT = "docs/assets/design-system";

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

const stamp = Date.now().toString(36);
let me;
if (process.env.DSM_TOKEN) {
  me = { token: process.env.DSM_TOKEN };
} else {
  me = await req("/auth/signup", {
    method: "POST",
    body: { email: `dsm.shot.${stamp}@example.test`, password: "designsystem123" },
  });
  await req("/v1/profile", {
    token: me.token,
    method: "PATCH",
    body: { handle: `dsm_${stamp}`, displayName: "Design Reviewer", avatarEmoji: "🎨" },
  });
  await req("/v1/posts", {
    token: me.token,
    method: "POST",
    body: {
      body: [
        "Design-system pass: the Feed now runs on semantic tokens, and the light theme meets WCAG AA.",
        "",
        "Author → content → media → actions; one red role; one shape scale.",
        "#design #tokens #a11y",
      ].join("\n"),
    },
  });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(({ token }) => localStorage.setItem("botifyr.token", token), { token: me.token });
const page = await context.newPage();

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("tab", { name: "Feed" }).click();
await page.locator(".feed-post").first().waitFor({ timeout: 20000 });

async function shot(name, width, height, theme) {
  await page.setViewportSize({ width, height });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png`);
}

await shot("feed-desktop-dark", 1440, 900, "dark");
await shot("feed-mobile-dark", 390, 844, "dark");
await shot("feed-desktop-light", 1440, 900, "light");
await shot("feed-mobile-light", 390, 844, "light");

await browser.close();
console.log("DONE");
