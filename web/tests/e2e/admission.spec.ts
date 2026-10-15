import { expect, test } from "@playwright/test";
import { useStaffSession } from "../support/browser-session";
import { openWorkflowTab } from "../support/workflow-tabs";
import { submitServerAction } from "../support/server-action";

test("admission desk reserves a pending stay and safely cancels it", async ({
  page,
}, testInfo) => {
  await useStaffSession(page, "ADMISSION");
  await expect(
    page.getByRole("main"),
  ).toBeVisible();
  await page.goto("/admissions");
  await expect(
    page.getByRole("heading", { name: "Admissions", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New admission", exact: true }).click();
  const name = `Synthetic browser patient ${Date.now()}`;
  await page.getByLabel("Patient name", { exact: true }).fill(name);
  await openWorkflowTab(page, "Current admission work");
  await page.getByRole("link", { name: "New admission", exact: true }).click();
  await expect(page.getByLabel("Patient name", { exact: true })).toHaveValue(name);
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page
    .getByRole("combobox", { name: "Sex", exact: true })
    .selectOption("FEMALE");
  await page.getByLabel("Contact number").fill("9999999999");
  await page
    .getByLabel("Named treating Doctor")
    .selectOption({ label: "Synthetic external Doctor" });
  await page
    .getByLabel("Bed assignment")
    .selectOption({ label: "Synthetic E2E General bed · GENERAL · Available" });
  await page.getByLabel("Expected stay (days)").fill("2");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("admission-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("admission-narrow.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save pending admission" }).click();
  await expect(page.getByRole("status")).toContainText("Bed reserved");
  await page.getByRole("link", { name: "Open admission record" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current admission context" }).getByText("PENDING", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Not yet admitted", { exact: true }),
  ).toBeVisible();
  await openWorkflowTab(page, "Cancel pending episode");
  await page
    .getByLabel("Cancellation reason")
    .fill("Synthetic browser pending cancellation");
  await page.getByRole("button", { name: "Cancel pending admission" }).click();
  await expect(page.getByRole("region", { name: "Current admission context" }).getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.goto(`/admissions?q=${encodeURIComponent(name)}`);
  await expect(
    page
      .locator(".patient-search")
      .getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await page
    .locator(".patient-search")
    .getByRole("link", { name: new RegExp(name) })
    .click();
  await expect(page.getByText("Existing patient selected")).toBeVisible();
  await page.getByRole("link", { name: "New admission", exact: true }).click();
  await expect(page.getByText("Existing patient selected")).toHaveCount(0);
  await expect(page.getByLabel("Patient name", { exact: true })).toHaveValue("");
});

test("administrator can add beds and admission staff cannot manage inventory", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await useStaffSession(page, "ADMIN");
  await expect(
    page.getByRole("main"),
  ).toBeVisible();
  await page.goto("/admin/beds");
  const label = `Synthetic browser bed ${Date.now()}`;
  await page.getByRole("textbox", { name: "Bed label", exact: true }).fill(label);
  await page.getByLabel("Room category").selectOption("GENERAL");
  await page
    .getByLabel("Reason for adding bed")
    .fill("Synthetic browser inventory");
  await submitServerAction(page, page.getByRole("button", { name: "Add bed" }));
  await expect(page.getByRole("button", { name: "Add bed" })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole("status")).toContainText("Bed added");
  await page.getByText("Physical bed inventory and disable controls", { exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: label });
  await row.getByText("Disable available bed", { exact: true }).click();
  await row
    .getByLabel("Reason for disabling bed")
    .fill("Synthetic browser disable");
  await row.getByRole("button", { name: "Disable bed" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
  await useStaffSession(page, "ADMISSION");
  await expect(
    page.getByRole("main"),
  ).toBeVisible();
  await page.goto("/admin/beds");
  await expect(page).toHaveURL(/admissions/);
});
