import { test, expect } from "@playwright/test";

test.describe("UI Screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the app shell to render
    await page.waitForSelector("nav");
  });

  test("capture chat view", async ({ page }) => {
    // Chat view is the default, just wait for it to settle
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: "screenshots/chat-view.png",
      fullPage: false,
    });
  });

  test("capture wrapped view", async ({ page }) => {
    // Click the "Wrapped" nav button
    await page.click('button:has-text("Wrapped")');
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: "screenshots/wrapped-view.png",
      fullPage: false,
    });
  });
});
