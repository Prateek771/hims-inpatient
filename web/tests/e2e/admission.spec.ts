import { expect, test } from "@playwright/test";

test("admission desk reserves a pending stay and safely cancels it", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admission@e2e.fixture.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticE2EOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Synthetic E2E ADMISSION" }),
  ).toBeVisible();
  await page.goto("/admissions");
  await expect(
    page.getByRole("heading", { name: "A smooth start to the stay" }),
  ).toBeVisible();
  const name = `Synthetic browser patient ${Date.now()}`;
  await page.getByLabel("Patient name", { exact: true }).fill(name);
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page
    .getByRole("combobox", { name: "Sex", exact: true })
    .selectOption("FEMALE");
  await page.getByLabel("Contact number").fill("9999999999");
  await page
    .getByLabel("Admitting doctor")
    .selectOption({ label: "Synthetic E2E DOCTOR" });
  await page
    .getByLabel("Assessing clinician")
    .selectOption({ label: "Synthetic E2E DOCTOR" });
  await page.getByLabel("Assessment time").fill("2026-01-01T09:00");
  await page
    .getByLabel("Chief complaint")
    .fill("Synthetic clinician complaint");
  await page
    .getByLabel("Clinician-recorded vitals")
    .fill("Synthetic vitals as recorded by clinician");
  await page
    .getByLabel("Clinical routing assessment")
    .fill("Synthetic clinician-selected General destination");
  await page
    .getByLabel("Clinician-selected destination")
    .selectOption("GENERAL");
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
  await expect(page.getByText("PENDING", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Not yet admitted", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Cancellation reason")
    .fill("Synthetic browser pending cancellation");
  await page.getByRole("button", { name: "Cancel pending admission" }).click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
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
});

test("administrator can add beds and admission staff cannot manage inventory", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@e2e.fixture.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticE2EOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Synthetic E2E ADMIN" }),
  ).toBeVisible();
  await page.goto("/admin/beds");
  const label = `Synthetic browser bed ${Date.now()}`;
  await page.getByLabel("Bed label").fill(label);
  await page.getByLabel("Room category").selectOption("GENERAL");
  await page
    .getByLabel("Reason for adding bed")
    .fill("Synthetic browser inventory");
  await page.getByRole("button", { name: "Add bed" }).click();
  await expect(page.getByRole("status")).toContainText("Bed added");
  const row = page.getByRole("row").filter({ hasText: label });
  await row
    .getByLabel("Reason for disabling bed")
    .fill("Synthetic browser disable");
  await row.getByRole("button", { name: "Disable bed" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email").fill("admission@e2e.fixture.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticE2EOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Synthetic E2E ADMISSION" }),
  ).toBeVisible();
  await page.goto("/admin/beds");
  await expect(page).toHaveURL(/workspace/);
});
