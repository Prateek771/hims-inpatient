import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession } from "../support/browser-session";
import { Client } from "pg";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
test.use({ timezoneId: "America/Los_Angeles" });
for (const role of ["ADMIN", "ADMISSION", "DOCTOR", "NURSE", "PHARMACY", "LAB", "INSURANCE", "BILLING"] as const) {
  test(`${role} current work, role access, keyboard and desktop/narrow pixels`, async ({ page }) => {
    await useStaffSession(page, role);
    const homeHeading = { ADMIN: "Home", ADMISSION: "Admissions", DOCTOR: "Patients", NURSE: "My shift", PHARMACY: "Medicine stock", LAB: "Lab", INSURANCE: "Insurance cases", BILLING: "Billing" }[role];
    await expect(page.getByRole("heading", { name: homeHeading, level: 1, exact: true })).toBeVisible();
    await expect(page.getByText(/Asia\/Kolkata/).first()).toBeVisible();
    await expect(page.getByText(/build progresses|Task 11|Task11/)).toHaveCount(0);
    // Role pages retain the exact authorized alert projection behind native disclosures.
    const alertDisclosure = page.locator("details.staff-alerts-compact > summary").filter({ hasText: /^Attention needed/ });
    if (await alertDisclosure.count()) await alertDisclosure.click();
    await expect(page.getByRole("heading", { name: "Attention needed" })).toBeVisible();
    if (role === "PHARMACY") {
      await page.getByRole("tab", { name: "Ward issues", exact: true }).click();
      await expect(page.getByRole("tabpanel", { name: "Ward issues", exact: true }).getByText("DISCHARGED", { exact: true })).toHaveCount(0);
      await expect(page.locator(".work-history").getByText("DISCHARGED", { exact: true })).toHaveCount(0);
    }
    await page.reload();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    if (role !== "ADMIN") {
      expect((await page.request.get("/overview")).status()).toBe(404);
      await page.goto("/overview");
      await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      await expect(page.getByTestId("overview-metrics")).toHaveCount(0);
      await page.goto("/workspace");
      const homePath = { ADMISSION: "/admissions", DOCTOR: "/clinical", NURSE: "/nursing", PHARMACY: "/pharmacy", LAB: "/lab", INSURANCE: "/insurance", BILLING: "/billing" }[role];
      await page.waitForURL(new RegExp(`${homePath}$`), { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: homeHeading, level: 1, exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
      await expect(page.getByTestId("overview-metrics")).toBeVisible();
      await expect(page.getByLabel("Bed category")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Current posted money" })).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready);
    const directory = resolve("../tmp/ui-redesign/browser");
    await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: resolve(directory, `${role.toLowerCase()}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(directory, `${role.toLowerCase()}-narrow.png`), fullPage: true });
    const scroll = page.locator(".table-scroll:visible").first();
    if (await scroll.count()) {
      await scroll.scrollIntoViewIfNeeded();
      await expect(async () => { await scroll.focus(); await expect(scroll).toBeFocused(); }).toPass();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => scroll.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
    }
  });
}

test("overview uses real empty/large values and a safe error state", async ({ page }) => {
  await useStaffSession(page, "ADMIN");
  await page.goto("/overview?bedCategory=OV_EMPTY");
  const emptyMetrics = page.getByTestId("overview-metrics").locator("strong");
  await expect(emptyMetrics.nth(0)).toHaveText("0");
  await expect(emptyMetrics.nth(1)).toHaveText("0%");
  await expect(emptyMetrics.nth(2)).toHaveText("0");
  await expect(emptyMetrics.nth(3)).toHaveText("0");
  await expect(page.getByText("No current signed discharge summaries awaiting review.")).toBeVisible();
  const sharedStockAlerts = page.locator(".staff-alerts .alert-list > li");
  expect(Number(await emptyMetrics.nth(4).innerText())).toBe(await sharedStockAlerts.count());
  for (const heading of await sharedStockAlerts.getByRole("heading").allTextContents()) expect(["Review medicine stock", "Review expired retained stock"]).toContain(heading);
  if (!(await sharedStockAlerts.count())) await expect(page.getByText("No current actionable alerts in your authorized work.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current posted money" }).locator("..").getByText("₹0.00", { exact: true })).toHaveCount(4);
  const directory = resolve("../tmp/ui-redesign/browser");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, "overview-empty-zero.png"), fullPage: true });
  await page.getByLabel("Bed category").selectOption("OV_LARGE");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByText("₹99,99,99,999.99", { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(directory, "overview-large-narrow.png"), fullPage: true });
  await page.goto("/overview?bedCategory=UNKNOWN");
  await expect(page.getByRole("heading", { name: "Current records are unavailable" })).toBeVisible();
  await expect(page.getByTestId("overview-metrics")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry current records" }).focus();
  await expect(page.getByRole("button", { name: "Retry current records" })).toBeFocused();
  await page.screenshot({ path: resolve(directory, "overview-error-narrow.png"), fullPage: true });
});

test("workspace navigation exposes a loading state without placeholder counts", async ({ page }) => {
  await useStaffSession(page, "ADMIN");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  const { ownerUrl, databaseName } = getTestDatabaseConfig();
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    expect((await client.query("select current_database() name,current_user role")).rows[0]).toEqual({ name: databaseName, role: "hims_test_owner" });
    await client.query("begin");
    await client.query("set local lock_timeout='3s'; set local statement_timeout='3s'; set local idle_in_transaction_session_timeout='5s'");
    // Hold only a guarded synthetic source table, so the real streamed boundary is observable.
    await client.query("lock table hims.care_occurrences in access exclusive mode");
    const lockedAt = Date.now();
    await page.goto("/overview", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Loading current hospital work" })).toBeVisible();
    await expect(page.getByTestId("overview-metrics")).toHaveCount(0);
    const loadingPixels = page.screenshot({ path: resolve("../tmp/task15/author-final/screenshots/overview-loading.png"), fullPage: true });
    await client.query("commit");
    const heldMilliseconds = Date.now() - lockedAt;
    await loadingPixels;
    await writeFile(resolve("../tmp/task15/author-final/loading-lock.json"), JSON.stringify({ target: "guarded synthetic hims.care_occurrences", observedLoading: true, placeholderCounts: false, releasedBeforeAwaitingPixels: true, lockHeldMilliseconds: heldMilliseconds, maximumIdleTransactionMilliseconds: 5000 }, null, 2));
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 15000 });
  } finally { await client.query("rollback"); await client.end(); }
});
