import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession as loadStaffSession } from "../support/browser-session";
import { openWorkflowTab } from "../support/workflow-tabs";
import { submitServerAction } from "../support/server-action";
type Fixture={transferId:string;summaryId:string;closedId:string;chargeId:string;careSourceId:string;cancelledId:string;doctorId:string;cashierId:string};
const fixture=async()=>JSON.parse(await readFile(resolve("tmp/e2e-final-review.json"),"utf8")) as Fixture;
test("Doctor withdraws current unperformed transfer from the retained chart",async({page})=>{
  const f=await fixture();await loadStaffSession(page,"DOCTOR");await page.goto(`/clinical?admissionId=${f.transferId}`);await openWorkflowTab(page,"Transfer");
  const form=page.getByTestId("transfer-withdraw-form");await form.getByLabel("Reason for clinical reconsideration").fill("Current Doctor reassessment makes this unperformed move unnecessary");await form.getByRole("button").click();
  await expect(page.getByText(/Withdrawal.*Current Doctor reassessment/)).toBeVisible();await expect(page.getByTestId("transfer-withdraw-form")).toHaveCount(0);
});
test("summary-only Pharmacy row opens the real empty-prescription clearance",async({page})=>{
  const f=await fixture();await loadStaffSession(page,"PHARMACY");await page.locator("details.staff-alerts-compact > summary").click();
  await page.locator(`a[href="/discharge?admissionId=${f.summaryId}"]`).first().click();await expect(page).toHaveURL(new RegExp(`/discharge\\?admissionId=${f.summaryId}$`));
  await expect(page.getByText("No medicines ordered; explicit empty prescription still requires this Pharmacy review.")).toBeVisible();
  const form=page.getByTestId("clearance-sign");await form.getByLabel("Review and reconciliation note").fill("Actual Pharmacy reviewed the signed empty prescription");await form.getByRole("button").click();await expect(page.getByTestId("gate-PHARMACY")).toContainText("Approved");
});
test("cancelled-deposit Billing guidance reaches current Admin authority",async({page})=>{
  const f=await fixture();await loadStaffSession(page,"ADMIN");await page.goto(`/billing?admissionId=${f.cancelledId}`);await page.getByRole("link",{name:"Open cancelled-deposit return authority"}).click();
  await expect(page).toHaveURL(new RegExp(`/exceptions\\?admissionId=${f.cancelledId}$`));await openWorkflowTab(page,"Record authority");await page.getByText("Record a named administrator decision",{exact:true}).click();
  const form=page.getByTestId("exception-authorize");await expect(form.getByLabel("Situation")).toHaveValue("CANCELLED_DEPOSIT");await expect(form.getByLabel("Original source").locator("option")).toHaveCount(2);
});
test("Admin routes original closed sources and proper roles record both linked financial amendments",async({page})=>{
  test.setTimeout(60_000);
  const f=await fixture();
  async function authorize(kind:string,sourceId:string,owner:string) {
    await loadStaffSession(page,"ADMIN");await page.goto(`/exceptions?admissionId=${f.closedId}`);await openWorkflowTab(page,"Record authority");await page.getByText("Record a named administrator decision",{exact:true}).click();
    const form=page.getByTestId("exception-authorize");await form.getByLabel("Specific later correction").selectOption(kind);await form.getByLabel("Original source").selectOption(sourceId);
    await form.getByLabel("Decision authority / responsible position").fill("Administrator source review");await form.getByLabel("Reason",{exact:true}).fill("Reconcile this exact retained original source");await form.getByLabel("Operational evidence and reference").fill("Retained original event and financial record");await form.getByLabel("Accountable follow-up owner").selectOption(owner);await form.getByRole("button").click();await expect(form.getByRole("status")).toContainText("Recorded with its authority");
    await openWorkflowTab(page,"Cases & next work");const row=page.locator(".exception-register tbody tr").filter({hasText:kind.toLowerCase().replaceAll("_"," ")});const link=row.getByRole("link"),target=await link.getAttribute("href");expect(target).toMatch(/^\/exceptions\?/);await link.click();await page.waitForURL(new URL(target!,page.url()).href,{waitUntil:"load"});return page.url();
  }
  const reversal=await authorize("REVERSE_CHARGE",f.chargeId,f.cashierId);await loadStaffSession(page,"BILLING");await page.goto(reversal);
  let form=page.getByTestId("exception-amend");await form.getByLabel("Amount of original charge to reverse (₹)").fill("25");await form.getByLabel("Reason for original charge correction").fill("Original overcharge correction");await submitServerAction(page,form.getByRole("button"));await expect(form.getByRole("button")).toBeEnabled({timeout:15_000});await expect(form.getByRole("status")).toContainText("Recorded with its authority");await openWorkflowTab(page,"Money & obligations");await expect(page.getByTestId("exception-net")).toHaveText("₹75.00");
  const care=await authorize("CARE_BILLING",f.careSourceId,f.doctorId);await loadStaffSession(page,"DOCTOR");await page.goto(care);
  form=page.getByTestId("exception-amend");await form.getByLabel("Reason for original-source financial review").fill("Resolve the original actual consultation with its configured rate");await submitServerAction(page,form.getByRole("button"));await expect(form.getByRole("button")).toBeEnabled({timeout:15_000});await expect(form.getByRole("status")).toContainText("Recorded with its authority");await expect(page.getByTestId("exception-net")).toHaveCount(0);
  await loadStaffSession(page,"BILLING");await page.goto(`/exceptions?admissionId=${f.closedId}`);await openWorkflowTab(page,"Money & obligations");await expect(page.getByTestId("exception-net")).toHaveText("₹175.00");
  await openWorkflowTab(page,"Cases & next work");await page.getByRole("link",{name:"Review and regenerate final copies"}).click();await expect(page.getByTestId("generate-document")).toBeVisible();await expect(page.getByText("Current bill version",{exact:false})).toBeVisible();
});
