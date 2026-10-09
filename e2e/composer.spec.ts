import { expect, test } from "@playwright/test";

/**
 * Composer publishing journey (docs/composer-implementation-plan.md).
 *
 * Requires a running app + cloud and a bearer token for an onboarded account:
 *   E2E_BASE_URL=http://localhost:1420 E2E_FEED_TOKEN=<token> \
 *     npx playwright test e2e/composer.spec.ts
 *
 * Skipped when no token is provided so CI without test credentials stays green.
 */
const TOKEN = process.env.E2E_FEED_TOKEN ?? "";

/** A 1x1 transparent PNG so the file input accepts a real image. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Composer publish journey", () => {
  // One account is shared, so run serially to keep server-side draft state
  // deterministic between tests. Each test still gets a fresh browser context.
  test.describe.configure({ mode: "serial" });
  test.skip(!TOKEN, "set E2E_FEED_TOKEN to run the composer journey tests");

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
    await page.locator("form.feed-composer").waitFor({ timeout: 20_000 });
  });

  test("shows a live character counter", async ({ page }) => {
    await page.getByLabel("Post text").fill("hello");
    await expect(page.locator("#feed-composer-count")).toHaveText("5 / 4000");
  });

  test("publishes a text post that appears in the feed", async ({ page }) => {
    const body = `e2e composer ${Date.now()}`;
    await page.getByLabel("Post text").fill(body);
    await page.getByRole("button", { name: "Post" }).click();

    await expect(page.locator(".feed-composer-notice")).toContainText("Post published");
    const card = page.locator(".feed-post", { hasText: body }).first();
    await expect(card).toBeVisible();
    // It renders through the shared PostCard, not a bare row.
    await expect(card.locator(".feed-actions")).toBeVisible();
    await expect(card.getByRole("button", { name: "Like" })).toBeVisible();
    // The composer resets only after the server confirms the post.
    await expect(page.getByLabel("Post text")).toHaveValue("");
  });

  test("refuses a past schedule instead of posting immediately", async ({ page }) => {
    await page.getByLabel("Post text").fill("e2e schedule guard");
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.locator('input[type="datetime-local"]').fill("2020-01-01T10:00");
    await page.getByRole("button", { name: "Schedule" }).click();

    await expect(page.locator(".feed-composer-error")).toContainText(/future time/i);
    await expect(page.locator(".feed-post", { hasText: "e2e schedule guard" })).toHaveCount(0);
  });

  test("attaches an image and publishes it", async ({ page }) => {
    const body = `e2e media ${Date.now()}`;
    await page.setInputFiles('input[type="file"][accept="image/*,video/*"]', {
      name: "e2e.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await expect(page.locator(".feed-composer-thumb")).toHaveCount(1);

    await page.getByLabel("Post text").fill(body);
    await page.getByRole("button", { name: "Post" }).click();

    await expect(page.locator(".feed-composer-notice")).toContainText("Post published");
    await expect(page.locator(".feed-post", { hasText: body }).first()).toBeVisible();
  });

  test("restores a typed draft after a reload", async ({ page }) => {
    await page.getByLabel("Post text").fill("e2e draft survives");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Feed" }).click();

    await expect(page.getByLabel("Post text")).toHaveValue("e2e draft survives");
    await expect(page.getByText("Draft restored")).toBeVisible();
  });

  test("clears the composer draft after publishing", async ({ page }) => {
    const body = `e2e draft clear ${Date.now()}`;
    await page.getByLabel("Post text").fill(body);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.locator(".feed-composer-notice")).toContainText("Post published");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Feed" }).click();
    // The published draft must not come back.
    await expect(page.getByLabel("Post text")).toHaveValue("");
    await expect(page.getByText("Draft restored")).toHaveCount(0);
  });
});
