import { expect, test } from "@playwright/test";

/** Boot the portal in a real browser and assert the SPA mounts. */
test("portal boots and renders the app or sign-in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/portal/", { waitUntil: "domcontentloaded" });

  // Unauthenticated → the sign-in screen; authenticated → the app shell.
  await expect(page.locator(".startup, .sidebar").first()).toBeVisible({ timeout: 20_000 });

  // The brand renders and there was no fatal JS error during boot.
  await expect(page.getByText("Botifyr").first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("portal serves the PWA manifest and service worker", async ({ request }) => {
  const manifest = await request.get("/portal/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const sw = await request.get("/portal/sw.js");
  expect(sw.ok()).toBeTruthy();
});
