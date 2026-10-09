import { expect, test } from "@playwright/test";
import { useStaffSession } from "../support/browser-session";
import { fillUtcDateTime } from "../support/datetime-input";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
async function currentCareAdmission() {
  return (
    JSON.parse(await readFile(resolve("tmp/e2e-care.json"), "utf8")) as {
      admissionId: string;
    }
  ).admissionId;
}

test("doctor signs rounds, addenda and prescription versions through actual forms", async ({
  page,
}, testInfo) => {
  await useStaffSession(page, "DOCTOR");
  await page.goto("/clinical");
  await expect(
    page.getByRole("heading", { name: "Care history, without the searching" }),
  ).toBeVisible();
  await page
    .locator(`a[href="/clinical?admissionId=${await currentCareAdmission()}"]`)
    .click();
  await page.getByText("Record a new round", { exact: true }).click();
  const round = page.getByTestId("round-form");
  await round
    .getByLabel("Clinical assessment / notes")
    .fill("Synthetic browser signed round");
  await round.getByRole("button", { name: "Sign round and orders" }).click();
  await expect(round.getByRole("status")).toContainText("Round signed");
  const latest = page
    .getByTestId("round-entry")
    .filter({ hasText: "Synthetic browser signed round" });
  await latest.getByText("Add a correction").click();
  await latest
    .getByLabel("Correction reason")
    .fill("Synthetic browser correction");
  await latest
    .getByLabel("Addendum text")
    .fill("Original retained; signed browser addendum");
  await latest.getByRole("button", { name: "Sign addendum" }).click();
  await expect(latest).toContainText(
    "Original retained; signed browser addendum",
  );
  await round
    .getByLabel("Clinical assessment / notes")
    .fill("Synthetic home-only prescription round");
  await round.getByLabel("Ordered work").selectOption("MEDICINE");
  await round
    .getByLabel("Requested medicine / work / clinical instructions")
    .fill("Synthetic home-only medicine");
  await round.getByLabel("Prescribed dose", { exact: true }).fill("5");
  await round.getByLabel("Prescribed dose unit").fill("mg");
  await round.getByLabel("Route", { exact: true }).fill("oral");
  await round
    .getByLabel("Frequency instructions")
    .fill("Clinician home directions");
  await round.getByLabel("Duration (days)").fill("2");
  await round.getByLabel("Medicine purpose").selectOption("TAKE_HOME");
  await expect(
    round.getByLabel("First scheduled occurrence (UTC)"),
  ).toHaveCount(0);
  await round.getByLabel("Prescribed dispensing quantity").fill("6");
  await round.getByLabel("Prescribed dispensing unit").fill("tablet");
  await round.getByRole("button", { name: "Sign round and orders" }).click();
  await expect(
    page
      .getByRole("cell")
      .filter({ hasText: "Synthetic home-only medicine" })
      .first(),
  ).toContainText("TAKE_HOME");
  const summary = page.getByTestId("summary-form");
  await summary
    .getByLabel("Diagnosis", { exact: true })
    .fill("Synthetic diagnosis");
  await summary.getByLabel("Course of care").fill("Synthetic course");
  await summary
    .getByLabel("Condition", { exact: true })
    .fill("Clinician recorded condition");
  await summary.getByLabel("Follow-up").fill("Clinician recorded follow-up");
  await summary.getByLabel("Advice", { exact: true }).fill("Clinician advice");
  await summary
    .getByLabel(/Include take-home: Synthetic prescribed medicine/)
    .check();
  await summary
    .getByLabel(/Include take-home: Synthetic home-only medicine/)
    .check();
  await summary
    .getByRole("button", { name: "Sign clinical summary and prescription" })
    .click();
  await expect(summary.getByRole("status")).toContainText(
    "Clinical summary signed",
  );
  await expect(page.getByTestId("summary-history")).toContainText("4 tablet");
  await expect(page.getByTestId("summary-history")).toContainText("6 tablet");
  await expect(page.getByTestId("summary-history")).toContainText(
    "Clinical signature",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("clinical-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("clinical-narrow.png"),
    fullPage: true,
  });
});

test("assigned nurse records explicit occurrences and handover without duplicate work", async ({
  page,
}, testInfo) => {
  await useStaffSession(page, "NURSE");
  await page.goto("/nursing");
  await expect(
    page.getByRole("heading", { name: "A dependable shift handover" }),
  ).toBeVisible();
  await page
    .locator(`a[href="/nursing?admissionId=${await currentCareAdmission()}"]`)
    .click();
  const shift = page.getByTestId("shift-start");
  await fillUtcDateTime(shift.getByLabel("Shift start (UTC)"), new Date());
  await shift
    .getByLabel("Incoming handover")
    .fill("Synthetic browser incoming handover");
  await shift.getByRole("button", { name: "Start assigned shift" }).click();
  await expect(page.getByTestId("shift-end")).toBeVisible();
  await page
    .getByText("Record medication outcome", { exact: true })
    .first()
    .click();
  const mar = page.getByTestId("mar-form").first();
  await fillUtcDateTime(mar.getByLabel("Actual time (UTC)"), new Date());
  await mar.getByLabel("Actual dose", { exact: true }).fill("0");
  await mar.getByLabel("Outcome").selectOption("REFUSED");
  await mar
    .getByLabel("Reason")
    .fill("Synthetic refusal recorded and doctor contacted");
  await mar.getByRole("button", { name: "Sign medication outcome" }).click();
  await expect(page.getByTestId("mar-history")).toContainText("REFUSED");
  await page
    .getByText("Record actual readings", { exact: true })
    .first()
    .click();
  const vitals = page.getByTestId("observation-form").first();
  await fillUtcDateTime(vitals.getByLabel("Observed at (UTC)"), new Date());
  await vitals.getByLabel("Pulse").fill("78");
  await vitals.getByRole("button", { name: "Sign actual readings" }).click();
  await expect(page.getByTestId("observation-history")).toContainText("78");
  const handover = page.getByTestId("shift-end");
  await fillUtcDateTime(handover.getByLabel("Shift end (UTC)"), new Date());
  await handover
    .getByLabel("Outgoing handover")
    .fill("Synthetic unfinished work handed over");
  await handover
    .getByRole("button", { name: "Sign handover and end shift" })
    .click();
  await expect(
    page.getByText("Synthetic unfinished work handed over"),
  ).toBeVisible();
  await expect(page.getByText(/OVERDUE/).first()).toBeVisible();
  await page.getByText("Add a signed correction", { exact: true }).click();
  await page
    .getByLabel("Correction reason")
    .fill("Synthetic nursing documentation correction");
  await page
    .getByLabel("Addendum text")
    .fill("Synthetic nurse addendum retains original refusal");
  await page.getByRole("button", { name: "Sign nursing addendum" }).click();
  await expect(
    page.getByText("Synthetic nurse addendum retains original refusal"),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("nursing-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("nursing-narrow.png"),
    fullPage: true,
  });
});

test("admin can assign care operationally but cannot open or sign clinical charts", async ({
  page,
}) => {
  await useStaffSession(page, "ADMIN");
  await page.goto("/admin/care");
  await expect(
    page.getByRole("heading", { name: "Nursing assignments" }),
  ).toBeVisible();
  await page.goto("/clinical");
  await expect(page.getByRole("heading", { name: /404/ })).toBeVisible();
  await page.goto("/nursing");
  await expect(page.getByRole("heading", { name: /404/ })).toBeVisible();
});
