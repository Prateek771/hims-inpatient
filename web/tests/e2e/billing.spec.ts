import { expect, test } from "@playwright/test";
import { useStaffSession } from "../support/browser-session";
import { fillUtcDateTime } from "../support/datetime-input";
test("billing shows real ledger history and records/allocates manual top-ups", async ({ page }, testInfo) => {
  await useStaffSession(page, "BILLING");
  await expect(page.getByRole("heading", { name: "Welcome, Synthetic E2E BILLING" })).toBeVisible();
  await page.getByRole("link", { name: "Charges & payments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "One bill. Every receipt visible." })).toBeVisible();
  await page.getByRole("link", { name: /Synthetic E2E billing patient/ }).first().click();
  await expect(page.getByRole("heading", { name: "Itemised charges" })).toBeVisible();
  await expect(page.getByRole("cell").filter({ hasText: "Synthetic recorded consultation" })).toBeVisible();
  await expect(page.getByText("Staff-recorded; HIMS has not verified bank receipt.")).toBeVisible();
  await expect(page.getByText(/Self-pay: patient responsibility is the reconciled bill/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record refund" })).toBeDisabled();
  await page.getByLabel("Receipt kind").selectOption("TOP_UP");
  await page.getByLabel("Amount received (INR)").fill("100");
  await page.getByLabel("Payment mode").selectOption("UPI");
  await page.getByLabel("Cash book / channel account").fill("Synthetic E2E UPI account");
  await page.getByLabel("Receipt number / transaction ID").fill(`synthetic-${Date.now()}`);
  await page.getByLabel("Staff reference").fill("Synthetic browser top-up");
  await page.getByRole("button", { name: "Record manual receipt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Manual receipt recorded" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Synthetic browser top-up" });
  await row.getByLabel("Allocate to bill (INR)").fill("100");
  await row.getByLabel("Allocation reason").fill("Synthetic browser allocation");
  await row.getByRole("button", { name: "Allocate deposit" }).click();
  await expect(row.getByRole("cell").last()).toContainText("₹100.00");
  await expect(row.getByRole("button", { name: "Allocate deposit" })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("billing-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("billing-narrow.png"), fullPage: true });
});
test("admission activation uses its limited deposit view and wrong roles cannot view bills", async ({ page }) => {
  await useStaffSession(page, "ADMISSION");
  await expect(page.getByRole("heading", { name: "Welcome, Synthetic E2E ADMISSION" })).toBeVisible();
  await page.goto("/admissions");
  await page.getByRole("link", { name: /Synthetic E2E activation patient/ }).first().click();
  await expect(page.getByRole("heading", { name: "Deposit and activation" })).toBeVisible();
  await page.getByLabel("Amount received (INR)").fill("500");
  await page.getByLabel("Cash book / channel account").fill("Synthetic E2E admission cash book");
  await page.getByLabel("Receipt number / transaction ID").fill(`activation-${Date.now()}`);
  await page.getByLabel("Staff reference").fill("Synthetic browser activation deposit");
  await page.getByRole("button", { name: "Record manual receipt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Manual receipt recorded" })).toBeVisible();
  const input = page.getByLabel("Actual bed occupancy start (UTC)");
  await expect(input).toHaveAttribute("step", "0.001");
  for (const [iso, canonical] of [
    ["2026-10-08T23:47:06.490Z", "2026-10-08T23:47:06.49"],
    ["2026-10-08T23:47:06.000Z", "2026-10-08T23:47:06"],
    ["2026-10-08T23:47:00.000Z", "2026-10-08T23:47"],
    ["2026-10-08T23:47:00.490Z", "2026-10-08T23:47:00.49"],
  ]) {
    const instant = new Date(iso);
    // Demonstrate native normalization independently of the helper, without submitting old occupancy.
    const normalized = await input.evaluate((element, value) => {
      const probe = document.createElement("input");
      probe.type = (element as HTMLInputElement).type;
      probe.step = (element as HTMLInputElement).step;
      probe.value = value;
      return probe.value;
    }, instant.toISOString().slice(0, 23));
    expect(normalized).toBe(canonical);
    await fillUtcDateTime(input, instant);
    await expect(input).toHaveValue(canonical);
    expect(new Date(`${await input.inputValue()}Z`).getTime()).toBe(instant.getTime());
    expect(await input.evaluate((element) => (element as HTMLInputElement).checkValidity())).toBe(true);
  }
  // Only the current precise instant is submitted; the older formatting probes never leave the input.
  await fillUtcDateTime(input, new Date());
  await page.getByRole("button", { name: "Activate admission" }).click();
  await expect(page.getByText("ADMITTED", { exact: true }).first()).toBeVisible();
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});
test("administrator saves a billable-item price from readable INR/unit fields as one paise version", async ({ page }) => {
  await useStaffSession(page, "ADMIN");
  await expect(page.getByRole("heading", { name: "Welcome, Synthetic E2E ADMIN" })).toBeVisible();
  await page.goto("/admin/settings");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Billable items and prices" }) });
  const code = `BROWSER_${Date.now()}`;
  await section.getByLabel("Stable item code").fill(code);
  await section.getByLabel("Item name").fill("Synthetic browser-priced test");
  await section.getByLabel("Charge category").selectOption("lab");
  await section.getByLabel("Source department").selectOption("LAB");
  await section.getByLabel("Billing unit (e.g. session, test, tablet)").fill("test");
  await section.getByLabel("Permitted quantity decimal places (0–6)").fill("0");
  await section.getByLabel("Unit price (INR)").fill("125.45");
  await section.getByLabel("Reason for change").fill("Synthetic browser fee configuration");
  await section.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText("New settings version saved");
  const response = await page.request.get("/api/admin/settings");
  expect(response.ok()).toBe(true);
  const state = await response.json();
  const versions = state.versions.filter((v: {
    payload: {
      code?: string;
    };
  }) => v.payload.code === code);
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({ kind: "tariff", payload: {
      type: "billable-item", code, unit: "test", quantityScale: 0, amount: "12545", department: "LAB", active: true
    } });
  expect(versions[0].version).toBeGreaterThan(0);
  const history = page.locator("details").filter({ hasText: code });
  await history.locator("summary").click();
  await expect(history).toContainText("₹125.45");
});
