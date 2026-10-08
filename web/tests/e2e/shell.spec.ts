import { expect, test } from "@playwright/test";

test("staff workspace is readable, keyboard accessible and honest about setup", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hospital sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A clear view of today" })).toBeVisible();
  await expect(page.getByText("Workspace setup in progress", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png"), fullPage: true });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("link", { name: "Review approved prototype" })).toHaveAttribute("href", /figma\.com\/proto\//);
  expect(errors).toEqual([]);
});

test("workspace fits a narrow screen without horizontal page overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A clear view of today" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("workspace-narrow.png"), fullPage: true });
});

test("health endpoint exposes liveness without pretending the database is configured", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", service: "hims-inpatient" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
