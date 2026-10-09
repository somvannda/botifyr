/**
 * Chat visual audit: logs in with a bearer token, then captures screenshots and
 * layout metrics for the Chat section across viewports.
 *
 * Usage:
 *   node scripts/chat-audit.mjs            # label = "before"
 *   CHAT_AUDIT_LABEL=after node scripts/chat-audit.mjs
 *
 * Env:
 *   CHAT_AUDIT_URL      default http://localhost:1421/
 *   CHAT_AUDIT_TOKEN    default = local test account token
 *   CHAT_AUDIT_REFRESH  default = local test account refresh token
 *   CHAT_AUDIT_OUT      default test-results/chat-audit
 *   CHAT_AUDIT_LABEL    default before
 *
 * Screenshots land in CHAT_AUDIT_OUT as <label>-<viewport>-<scene>.png.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.CHAT_AUDIT_URL ?? "http://localhost:1421/";
const TOKEN =
  process.env.CHAT_AUDIT_TOKEN ??
  "f4a942f0f228d9b5b0ee8b13b954025a719a7097341cefbabaf32ad292e868da";
const REFRESH =
  process.env.CHAT_AUDIT_REFRESH ??
  "d060d6782f032e0eae6e012412e00dc67052e6cf39fa5c1cb03a03b8ce4581d5";
const OUT = process.env.CHAT_AUDIT_OUT ?? "test-results/chat-audit";
const LABEL = process.env.CHAT_AUDIT_LABEL ?? "before";

mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

const MEASURE = () => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  };
  const overflow = [...document.querySelectorAll("body *")]
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
    .slice(0, 8)
    .map((el) => `${el.className || el.tagName}:${el.scrollWidth}>${el.clientWidth}`);
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    convRows: document.querySelectorAll(".conv-item").length,
    unreadBadges: document.querySelectorAll(".unread-badge").length,
    msgUser: document.querySelectorAll(".msg-user").length,
    msgAssistant: document.querySelectorAll(".msg-assistant").length,
    dateSeps: document.querySelectorAll(".date-sep, .day-sep, .thread-date").length,
    msgTimestamps: document.querySelectorAll(".msg-time, .msg-meta, time").length,
    sidebar: box(".sidebar"),
    main: box(".main"),
    content: box(".content"),
    thread: box(".thread"),
    composerBar: box(".composer-bar"),
    contactPanel: box(".contact-panel"),
    msgFont: cs(".msg-body", "fontSize"),
    convPreviewFont: cs(".conv-preview", "fontSize"),
    overflow,
  };
};

const browser = await chromium.launch();
const report = [];

async function open(viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(
    ([t, r]) => {
      try {
        localStorage.setItem("botifyr.token", t);
        localStorage.setItem("botifyr.refreshToken", r);
        localStorage.setItem("botifyr.density", "cozy");
      } catch {
        /* ignore */
      }
    },
    [TOKEN, REFRESH],
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

for (const vp of VIEWPORTS) {
  const { ctx, page, errors } = await open(vp);
  await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}-list.png` });
  const metrics = await page.evaluate(MEASURE);
  const scenes = {};

  // Narrow screens: the conversation list is a drawer behind a menu button.
  if (vp.name !== "desktop") {
    const navBtn = page.locator(".mobile-nav-btn").first();
    if (await navBtn.count()) {
      await navBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}-nav.png` });
      scenes.nav = await page.evaluate(MEASURE);
    }
  }

  // Click a conversation row by its visible name, resilient to re-renders.
  const openConv = async (name) => {
    const row = page
      .locator(".conv-item")
      .filter({ has: page.locator(".conv-name", { hasText: name }) })
      .first();
    if (!(await row.count())) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await row.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await row.click({ force: true, timeout: 4000 });
        await page.waitForTimeout(600);
        return true;
      } catch {
        await page.waitForTimeout(300);
      }
    }
    return false;
  };

  // Open the DM conversation ("Sam").
  if (await openConv(/^Sam$/)) {
    await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}-dm.png` });
    scenes.dm = await page.evaluate(MEASURE);
    // Toggle the contact panel (desktop only — it overlays on narrow widths).
    if (vp.name === "desktop") {
      const panelBtn = page.locator('button[title="Show bot panel"], button[title="Hide bot panel"]').first();
      if (await panelBtn.count()) {
        await panelBtn.click().catch(() => {});
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}-dm-panel.png` });
        scenes.dmPanel = await page.evaluate(MEASURE);
      }
    }
  }

  // Open the group conversation.
  if (await openConv(/Launch Squad/)) {
    await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}-group.png` });
    scenes.group = await page.evaluate(MEASURE);
  }

  report.push({ viewport: vp.name, metrics, scenes, consoleErrors: errors.slice(0, 8) });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify({ label: LABEL, out: OUT, report }, null, 2));
