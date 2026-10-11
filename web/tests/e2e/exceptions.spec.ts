import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession } from "../support/browser-session";
import { fillUtcDateTime } from "../support/datetime-input";
import { openWorkflowTab } from "../support/workflow-tabs";
import { submitServerAction } from "../support/server-action";

test.describe.serial("accountable exceptional exit and retained collection", () => {
  let f: { admissionId: string; doctorId: string; cashierId: string };
  let T: Date, amount: string;
  const url = () => `/exceptions?admissionId=${f.admissionId}`;
  test.beforeAll(async () => {
    f = JSON.parse(await readFile(resolve("tmp/e2e-exceptions.json"), "utf8"));
  });
  test("assigned Nurse records actual witnessed exit", async ({ page }) => {
    await useStaffSession(page, "NURSE");
    await page.goto(url());
    await expect(page.getByTestId("exception-authorize")).toHaveCount(0);
    await openWorkflowTab(page,"My professional evidence");await page.getByText("Record my professional evidence", { exact: true }).click();
    const evidence = page.getByTestId("exception-evidence"); T = new Date();
    await evidence.getByLabel("My actual witnessing shift").selectOption({ index: 1 });
    await fillUtcDateTime(evidence.getByLabel("Actual hospital exit (Asia/Kolkata)"), T);
    await fillUtcDateTime(evidence.getByLabel("Actual bed vacancy (Asia/Kolkata)"), T);
    await evidence.getByLabel("Actual professional findings / witnessed facts").fill("Patient left before Doctor advice was available; actual Nurse witnessed exit");
    await evidence.getByRole("button").click();
    await expect(evidence.getByRole("status")).toContainText("Recorded with its authority");
  });
  test("Admin authorizes actual departure with retained debt and missing Doctor follow-up", async ({ page }, testInfo) => {
    await useStaffSession(page, "ADMIN");
    await page.goto(url());
    await openWorkflowTab(page,"Record authority");await page.getByText("Record a named administrator decision", { exact: true }).click();
    const form = page.getByTestId("exception-authorize");
    await form.getByRole("combobox", { name: "Situation", exact: true }).selectOption("EARLY_EXIT");
    await form.locator('input[name="evidenceIds"]').check();
    await form.getByLabel("Decision authority / responsible position").fill("On-call hospital administrator");
    await form.getByLabel("Reason", { exact: true }).fill("Record actual early departure and retain the unpaid bill");
    await form.getByLabel("Operational evidence and reference").fill("Original assigned Nurse witness; Doctor advice remains pending");
    await form.getByLabel("Accountable follow-up owner").selectOption(f.doctorId);
    await form.getByRole("button").click();
    // The first recorded authority changes the server's default to its next-work tab.
    // Wait for that persisted result before returning to the retained form status.
    await expect(page.getByRole("tab", { name: "Cases & next work", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Recorded exception decisions" })).toContainText("Record actual early departure and retain the unpaid bill");
    await openWorkflowTab(page,"Record authority");
    await expect(form.getByRole("status")).toContainText("Recorded with its authority");
    await openWorkflowTab(page,"Cases & next work");const depart = page.getByTestId("exception-departure");
    await depart.getByLabel("Authorized actual Nurse departure evidence").selectOption({ index: 1 });
    await depart.getByRole("button").click();
    await expect(page.locator(".discharge-identity .status")).toHaveText("DISCHARGED");
    await openWorkflowTab(page,"Money & obligations");await expect(page.getByText(/Doctor follow-up: pending doctor/)).toBeVisible();
    amount = (await page.getByTestId("exception-net").innerText()).replace(/[^0-9.]/g, "");
    expect(Number(amount)).toBeGreaterThan(0);
    await openWorkflowTab(page,"Record authority");await page.getByText("Record a named administrator decision", { exact: true }).click();
    await page.getByRole("heading", { level: 1 }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("exceptions-debt-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("exceptions-debt-narrow.png"), fullPage: true });
  });
  test("Admin routes an exact later collection and Billing records actual money", async ({ page }) => {
    test.setTimeout(60_000);
    await useStaffSession(page, "ADMIN");
    await page.goto(url());
    await openWorkflowTab(page,"Record authority");await page.getByText("Record a named administrator decision", { exact: true }).click();
    const form = page.getByTestId("exception-authorize");
    await form.getByRole("combobox", { name: "Situation", exact: true }).selectOption("POST_DISCHARGE_CORRECTION");
    await form.getByLabel("Specific later correction").selectOption("RECEIPT");
    await form.getByRole("combobox", { name: "Original source", exact: true }).selectOption({ index: 1 });
    await form.getByLabel("Decision authority / responsible position").fill("Administrator later collection review");
    await form.getByLabel("Reason", { exact: true }).fill("Actual later payment after exit");
    await form.getByLabel("Operational evidence and reference").fill("Manual cashier book receipt received after departure");
    await form.getByLabel("Accountable follow-up owner").selectOption(f.cashierId);
    await form.getByRole("button").click();
    await expect(form.getByRole("status")).toContainText("Recorded with its authority");
    await useStaffSession(page, "BILLING");
    await page.goto(url());
    await expect(page.getByText("Private clinical assessment excluded from Billing")).toHaveCount(0);
    const cash = page.getByTestId("exception-amend");
    await cash.getByLabel("Actual amount (₹)").fill(amount);
    await cash.getByLabel("Cash book / bank / channel name").fill("Synthetic actual cashier book");
    await cash.getByLabel("Unique actual transaction reference").fill(`LATER-${crypto.randomUUID()}`);
    await cash.getByLabel("Receipt evidence / description").fill("Actual cash received after exceptional exit");
    await submitServerAction(page, cash.getByRole("button"));
    await expect(cash.getByRole("button")).toBeEnabled({ timeout: 15_000 });
    await expect(cash.getByRole("status")).toContainText("Recorded with its authority");
    await openWorkflowTab(page,"Money & obligations");await expect(page.locator(".discharge-money > div").filter({ has: page.getByText("Patient money still owed", { exact: true }) })).toContainText("₹0.00");
  });
  test("the original Nurse signs factual attendance after actual exit", async ({ page }) => {
    await useStaffSession(page, "NURSE");
    await page.goto(url());
    await openWorkflowTab(page,"My professional evidence");await page.getByText("Close my original actual attendance", { exact: true }).click();
    const attendance = page.getByTestId("exception-nurse-attendance");
    await attendance.getByLabel("My original shift").selectOption({ index: 1 });
    await fillUtcDateTime(attendance.getByLabel("Actual attendance ended (Asia/Kolkata)"), T);
    await attendance.getByLabel("My actual handover").fill("Original Nurse signs actual attendance ending at witnessed hospital exit");
    await attendance.getByRole("button").click();
    await expect(attendance.getByRole("status")).toContainText("Recorded with its authority");
  });

});

test("Doctor explicitly reconsiders the original return instruction before renewed clearance", async ({ page }) => {
  const f = JSON.parse(await readFile(resolve("tmp/e2e-return-review.json"), "utf8")) as { admissionId: string };
  await useStaffSession(page, "DOCTOR");
  await page.goto(`/discharge?admissionId=${f.admissionId}`);
  await expect(page.getByText(/Current Doctor return instruction requires/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clearance unavailable" })).toBeDisabled();
  await page.goto(`/exceptions?admissionId=${f.admissionId}`);
  await openWorkflowTab(page,"My professional evidence");await page.getByText("Record my professional evidence", { exact: true }).click();
  const form = page.getByTestId("exception-evidence");
  await form.getByLabel("Professional record").selectOption("RETURN_CANCELLED");
  await form.getByLabel("Original professional source").selectOption({ index: 1 });
  await fillUtcDateTime(form.getByLabel("Actual event time (Asia/Kolkata)"), new Date());
  await form.getByLabel("Actual professional findings / witnessed facts").fill("Doctor reassessed the patient: bed care is no longer required; proceed to ordinary discharge reviews");
  await form.getByRole("button").click();
  await expect(form.getByRole("status")).toContainText("Recorded with its authority");
  await page.goto(`/discharge?admissionId=${f.admissionId}`);
  await expect(page.getByText(/Current Doctor return instruction requires/)).toHaveCount(0);
  const seal = page.getByTestId("clearance-sign");
  await seal.getByLabel("Review and reconciliation note").fill("Doctor reviewed the explicit revised return decision and current clinical sources");
  await seal.getByRole("button").click();
  await expect(page.getByTestId("gate-DOCTOR")).toContainText("Approved");
  await expect(page.getByTestId("gate-PHARMACY")).toContainText("Waiting");
  await useStaffSession(page, "NURSE");
  await page.goto(`/exceptions?admissionId=${f.admissionId}`);
  await expect(page.getByTestId("exception-return").getByLabel("Authorized fresh Doctor instruction").locator("option")).toHaveCount(1);
});
