import { expect, test } from "@playwright/test";

test("unsigned root opens the real staff sign-in with keyboard access", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Staff sign in", exact: true })).toBeVisible();
  await expect(page.getByText(/Patient records and hospital workflows will be added/)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png"), fullPage: true });
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email or role", { exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("workspace fits a narrow screen without horizontal page overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Staff sign in", exact: true })).toBeVisible();
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

test("readiness verifies the configured PostgreSQL schema without exposing details", async ({ request }) => {
  const response = await request.get("/api/health/ready");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ready" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
