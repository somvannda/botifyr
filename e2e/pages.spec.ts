import { expect, request, test } from "@playwright/test";

/**
 * Pages experience E2E (docs/pages-implementation-plan.md §J).
 *
 * Requires a running cloud + host and a bearer token for an account that can
 * create a Page:
 *   E2E_BASE_URL=http://localhost:1420 \
 *   E2E_CLOUD_URL=http://localhost:8787 \
 *   E2E_PAGES_TOKEN=<token> npx playwright test e2e/pages.spec.ts
 *
 * Skipped when no token is provided so credential-less CI stays green. The
 * spec seeds its own Page (unique name) so it is independent of existing data.
 */
const TOKEN = process.env.E2E_PAGES_TOKEN ?? "";
const CLOUD = process.env.E2E_CLOUD_URL ?? "http://localhost:8787";
// Unique per worker: Playwright runs the four tests in parallel, so a
// millisecond-only stamp can collide and make two workers race for one handle.
const PAGE_NAME = `E2E Studio ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let pageHandle = "";

test.describe("Pages experience", () => {
  test.skip(!TOKEN, "set E2E_PAGES_TOKEN to run the Pages E2E tests");

  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeAll(async () => {
    const api = await request.newContext({
      baseURL: CLOUD,
      extraHTTPHeaders: { authorization: `Bearer ${TOKEN}` },
    });
    const created = await api.post("/v1/pages", {
      data: {
        name: PAGE_NAME,
        category: "Design studio",
        about: "We design calm interfaces — E2E about text.",
        cta: "https://example.com/work",
      },
    });
    expect(created.ok()).toBeTruthy();
    const page = (await created.json()) as { id: string; handle: string };
    pageHandle = page.handle;

    const post = await api.post("/v1/posts", {
      data: { body: "E2E page post body", pageId: page.id },
    });
    expect(post.ok()).toBeTruthy();
    await api.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([token]) => {
        try {
          localStorage.setItem("botifyr.token", token);
        } catch {
          /* ignore */
        }
      },
      [TOKEN],
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Feed" }).click();
  });

  /** Open the seeded Page from the "Your Pages" rail. */
  async function openPage(page: import("@playwright/test").Page) {
    const row = page.locator(".feed-rail-person").filter({ hasText: PAGE_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "View" }).click();
    await expect(page.locator(".page-head")).toBeVisible({ timeout: 20_000 });
  }

  test("discovers a Page and renders its identity and posts", async ({ page }) => {
    await openPage(page);
    await expect(page.locator(".page-name")).toHaveText(PAGE_NAME);
    await expect(page.locator(".page-sub")).toContainText(`@${pageHandle}`);
    // Posts tab is the default section and reuses the shared PostCard.
    await expect(page.locator(".feed-post").filter({ hasText: "E2E page post body" })).toBeVisible();
  });

  test("navigates between Posts and About", async ({ page }) => {
    await openPage(page);
    await page.getByRole("tab", { name: "About" }).click();
    await expect(page.locator(".page-about-panel")).toBeVisible();
    await expect(page.locator(".page-about-text")).toContainText("We design calm interfaces");
    await expect(page.locator(".page-fact").filter({ hasText: "Created" })).toBeVisible();
    // The posts feed is not shown while About is active.
    await expect(page.locator(".feed-post").filter({ hasText: "E2E page post body" })).toHaveCount(0);
  });

  test("shows owner management controls, not a Follow button", async ({ page }) => {
    await openPage(page);
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    // Scope to the Page header: the rail still lists other Pages to follow.
    await expect(page.locator(".page-head").getByRole("button", { name: /^Follow$/ })).toHaveCount(0);
  });

  test("keeps owner actions visible on a mobile viewport", async ({ page }) => {
    await openPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.locator(".page-head")).toBeVisible();
  });
});
