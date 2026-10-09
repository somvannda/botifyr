import { expect, test } from "@playwright/test";

/**
 * Chat keyboard-accessibility regressions.
 *
 * Requires a running portal and a bearer token:
 *   E2E_BASE_URL=http://localhost:1421 E2E_CHAT_TOKEN=<token> npx playwright test e2e/chat.spec.ts
 *
 * Skipped when no token is provided so CI without test credentials stays green.
 */
const TOKEN = process.env.E2E_CHAT_TOKEN ?? "";

test.describe("Chat keyboard accessibility", () => {
  test.skip(!TOKEN, "set E2E_CHAT_TOKEN to run the Chat keyboard tests");

  test.use({ viewport: { width: 390, height: 844 } });

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
  });

  test("mobile conversation drawer opens with the keyboard and closes on Escape", async ({ page }) => {
    const nav = page.getByRole("button", { name: /show chats/i });
    await expect(nav).toBeVisible({ timeout: 20_000 });

    await nav.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".app")).toHaveClass(/mobile-nav-open/);
    await expect(page.locator(".sidebar")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".app")).not.toHaveClass(/mobile-nav-open/);
    // Focus returns to the trigger so keyboard users don't lose their place.
    await expect(nav).toBeFocused();
  });

  test("the composer send control has an accessible name", async ({ page }) => {
    await expect(page.locator(".sidebar")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /send message/i })).toHaveCount(1);
  });
});
