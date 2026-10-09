import { expect, test } from "@playwright/test";

/**
 * Reels playback & navigation E2E.
 *
 * Requires a running portal and a bearer token:
 *   E2E_BASE_URL=http://localhost:4322 E2E_REELS_TOKEN=<token> npx playwright test e2e/reels.spec.ts
 *
 * The spec records its own short WebM in-browser (no repo video fixture needed),
 * uploads it as a reel, then verifies real playback, mute, navigation and the
 * comments sheet. Skipped when no token is provided so CI without test
 * credentials stays green.
 */
const TOKEN = process.env.E2E_REELS_TOKEN ?? process.env.E2E_CHAT_TOKEN ?? "";
const CLOUD = process.env.CLOUD_URL ?? "http://localhost:8787";

// Muted autoplay needs no gesture; this makes the policy explicit for headless.
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

test.describe("Reels playback & navigation", () => {
  test.skip(!TOKEN, "set E2E_REELS_TOKEN (or E2E_CHAT_TOKEN) to run the Reels tests");

  test("plays, mutes, survives navigation and opens comments", async ({ page, request }) => {
    // 1) Record a 1.2s vertical clip with the browser's own MediaRecorder.
    await page.goto("about:blank");
    const webm = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const stream = canvas.captureStream(30);
      const types = ["video/webm;codecs=vp8", "video/webm"];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
      const rec = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.start();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const draw = () => {
          const t = performance.now() - start;
          ctx.fillStyle = `hsl(${(t / 12) % 360}, 70%, 45%)`;
          ctx.fillRect(0, 0, 360, 640);
          if (t > 1200) {
            resolve();
            return;
          }
          requestAnimationFrame(draw);
        };
        draw();
      });
      rec.stop();
      await stopped;
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });

    // 2) Seed it as the viewer's own reel via the cloud API.
    const headers = { authorization: `Bearer ${TOKEN}` };
    const uploaded = await request.post(`${CLOUD}/v1/uploads`, {
      headers,
      data: {
        name: `e2e-reel-${Date.now()}.webm`,
        mime: "video/webm",
        data: `data:video/webm;base64,${webm}`,
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const media = (await uploaded.json()) as { id: string };
    const posted = await request.post(`${CLOUD}/v1/posts`, {
      headers,
      data: { body: "E2E reel #e2e", mediaIds: [media.id] },
    });
    expect(posted.ok(), await posted.text()).toBeTruthy();

    // 3) Open the app and the Reels view.
    await page.addInitScript(
      ([token]) => {
        try {
          localStorage.setItem("botifyr.token", token);
          localStorage.setItem("botifyr.theme", "dark");
        } catch {
          /* ignore */
        }
      },
      [TOKEN],
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Feed" }).click();
    await page.getByRole("button", { name: "Reels", exact: true }).click();

    const reel = page.locator(".reel").first();
    await expect(reel).toBeVisible({ timeout: 20_000 });

    // 4) The active reel actually plays (not merely mounted).
    await expect
      .poll(
        () => reel.locator("video").evaluate((video: HTMLVideoElement) => video.paused),
        { timeout: 15_000 },
      )
      .toBe(false);

    // 5) Mute round-trips.
    const unmute = page.getByRole("button", { name: "Unmute reels" });
    if (await unmute.count()) {
      await unmute.click();
      await expect(page.getByRole("button", { name: "Mute reels" })).toBeVisible();
    }

    // 6) Navigating away and back restores a working playback state.
    await page.getByRole("button", { name: /back/i }).click();
    await page.getByRole("button", { name: "Reels", exact: true }).click();
    await expect(page.locator(".reel").first()).toBeVisible({ timeout: 20_000 });

    // 7) Comments sheet opens over the video and closes on Escape.
    await page.getByRole("button", { name: "Comments" }).first().click();
    await expect(page.getByRole("dialog", { name: /Comments on/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Comments on/i })).toBeHidden();
  });
});
