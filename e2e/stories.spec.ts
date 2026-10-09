import { expect, test } from "@playwright/test";

/**
 * Stories end-to-end: seed a friend's story through the cloud API, inject the
 * viewer's token, then drive the real app at both desktop and mobile widths.
 * Requires the cloud (`:8787`) and the app (`:1420` by default); skips otherwise.
 *
 * Run: `npx playwright test e2e/stories.spec.ts`
 */

const CLOUD = process.env.E2E_CLOUD_URL ?? "http://localhost:8787";
const APP = process.env.E2E_APP_URL ?? "http://localhost:1420";
/** A 1x1 transparent PNG (valid for the upload guard). */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800, file: "docs/assets/feed/story-viewer.png" },
  { name: "mobile", width: 390, height: 844, file: "docs/assets/feed/story-viewer-mobile.png" },
];

async function api(
  path: string,
  { token, method = "GET", body }: { token?: string; method?: string; body?: unknown } = {},
): Promise<any> {
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

/** Create two friends and a story authored by the friend. */
async function seedStory(): Promise<{ token: string }> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = await api("/auth/signup", {
    method: "POST",
    body: { email: `e2e.story.${stamp}@example.test`, password: "qa12345678" },
  });
  const other = await api("/auth/signup", {
    method: "POST",
    body: { email: `e2e.story.other.${stamp}@example.test`, password: "qa12345678" },
  });
  await api("/v1/friend-requests", { token: me.token, method: "POST", body: { userId: other.user.id } });
  const incoming = (await api("/v1/friend-requests", { token: other.token })) ?? [];
  const pending = incoming.find(
    (r: { direction: string; person?: { id: string } }) =>
      r.direction === "incoming" && r.person?.id === me.user.id,
  );
  if (pending) {
    await api(`/v1/friend-requests/${pending.id}`, {
      token: other.token,
      method: "POST",
      body: { action: "accept" },
    });
  }
  const media = await api("/v1/uploads", {
    token: other.token,
    method: "POST",
    body: { name: "e2e-story.png", mime: "image/png", data: PNG },
  });
  await api("/v1/stories", { token: other.token, method: "POST", body: { mediaId: media.id } });
  return { token: me.token };
}

for (const vp of VIEWPORTS) {
  test(`a viewer can open, react to, pause, and close a story (${vp.name})`, async ({
    page,
    request,
  }) => {
    const appUp = await request
      .get(APP + "/")
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!appUp, `App not reachable at ${APP}`);
    const cloudUp = await request
      .get(CLOUD + "/v1/stories")
      .then((r) => r.status() < 500)
      .catch(() => false);
    test.skip(!cloudUp, `Cloud not reachable at ${CLOUD}`);

    const { token } = await seedStory();

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript((value: string) => {
      localStorage.setItem("botifyr.token", value);
      localStorage.setItem("botifyr.theme", "dark");
    }, token);
    await page.goto(APP + "/", { waitUntil: "domcontentloaded" });

    // The app lands on Chat. On narrow screens the sidebar is a drawer.
    if (vp.width < 600) {
      await page.getByRole("button", { name: "Show chats" }).click();
    }
    await page.getByRole("tab", { name: "Feed" }).click();

    const tile = page.locator(".story-tile").last();
    await expect(tile).toBeVisible({ timeout: 20_000 });
    await tile.click();

    const dialog = page.locator("[role='dialog']");
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: vp.file });

    // Reactions are available on someone else's story and toggle.
    const love = page.getByRole("button", { name: "React ❤️" });
    await expect(love).toBeVisible();
    await love.click();
    await expect(love).toHaveAttribute("aria-pressed", "true");

    // Space pauses (badge appears) and resumes.
    await page.keyboard.press(" ");
    await expect(page.locator(".story-paused")).toBeVisible();
    await page.keyboard.press(" ");

    // Escape closes the viewer.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}
