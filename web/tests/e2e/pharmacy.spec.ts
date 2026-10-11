import { expect,test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession } from "../support/browser-session";
import { openWorkflowTab } from "../support/workflow-tabs";
test("pharmacy scans actual batch, issues/returns ward stock and prepares signed home stock through real forms",async({page},testInfo)=> {
  // Real stock receipt, barcode rejection, issue/return, home stock and rendered proofs.
  test.setTimeout(60_000);
  const f=JSON.parse(await readFile(resolve("tmp/e2e-pharmacy.json"),"utf8")) as {admissionId:string;orderId:string;batchId:string;barcode:string};
  await useStaffSession(page,"PHARMACY");await page.goto(`/pharmacy?admissionId=${f.admissionId}`);
  await expect(page.getByRole("heading",{name:"Medicine stock"})).toBeVisible();
  await expect(page.getByText("Pharmacy fixture order, no contact/clinical notes projection")).toHaveCount(0);
  await expect(page.getByTestId("stock-adjustment")).toHaveCount(0);
  await openWorkflowTab(page,"Stock");
  const receipt=page.getByTestId("stock-receipt"),suffix=Date.now().toString();
  await receipt.getByLabel("Configured medicine / exact unit").selectOption("E2E_PHARM|tablet");await receipt.getByLabel("Batch number",{exact:true}).fill(`BROWSER-${suffix}`);await receipt.getByLabel("Expiry date").fill("2099-12-31");await receipt.getByLabel("Stock quantity",{exact:true}).fill("3");await receipt.getByLabel("Unique batch barcode").fill(`BROWSER-CODE-${suffix}`);await receipt.getByLabel("Receipt reference").fill("Synthetic browser receipt record");await receipt.getByRole("button",{name:"Record stock receipt"}).click();const batchRow=page.getByRole("row").filter({hasText:`BROWSER-CODE-${suffix}`});await expect(batchRow).toHaveCount(1);await batchRow.getByText("Batch identity & barcode",{exact:true}).click();await expect(batchRow).toContainText(`BROWSER-CODE-${suffix}`);
  await page.getByLabel("Scan item / batch barcode",{exact:true}).fill("UNKNOWN-BARCODE");await page.getByRole("button",{name:"Find batch barcode"}).click();await expect(page.getByTestId("barcode-result")).toContainText("Barcode not found");
  await page.getByLabel("Scan item / batch barcode",{exact:true}).fill(f.barcode);await page.getByRole("button",{name:"Find batch barcode"}).click();await expect(page.getByTestId("barcode-result")).toContainText("20 tablet");
  await openWorkflowTab(page,"Ward issues");await page.getByText("Issue ward stock against this order",{exact:true}).click();const issue=page.getByTestId(`issue-${f.orderId}`);
  await issue.getByRole("combobox",{name:"Medicine batch",exact:true}).selectOption(`${f.batchId}|tablet`);await issue.getByLabel("Explicit stock quantity (no dose conversion)").fill("2");await issue.getByLabel("Scan selected ward batch barcode (optional)").fill("WRONG-BATCH");await issue.getByRole("button",{name:"Issue ward medicine"}).click();await expect(issue.getByRole("status")).toContainText("barcode differs");
  await issue.getByRole("combobox",{name:"Medicine batch",exact:true}).selectOption(`${f.batchId}|tablet`);await issue.getByLabel("Explicit stock quantity (no dose conversion)").fill("2");await issue.getByLabel("Scan selected ward batch barcode (optional)").fill(f.barcode);await issue.getByRole("button",{name:"Issue ward medicine"}).click();await openWorkflowTab(page,"Returns");await expect(page.getByRole("cell",{name:"2 tablet",exact:true})).toBeVisible();
  await page.getByText("Return unused stock",{exact:true}).first().click();const returned=page.locator('[data-testid^="return-"]').first();await returned.getByLabel("Quantity returned (original unit)").fill("1");await returned.getByLabel("Return reason / condition checked").fill("Unused sealed synthetic medicine returned");await returned.getByRole("button",{name:"Record medicine return"}).click();await expect(page.getByText("Return recorded",{exact:true})).toBeVisible();
  await openWorkflowTab(page,"Take-home");const prep=page.getByTestId("prepare-home");await prep.getByRole("combobox",{name:"Medicine batch",exact:true}).selectOption(`${f.batchId}|tablet`);await prep.getByLabel("Scan selected take-home batch barcode (optional)").fill(f.barcode);await prep.getByRole("button",{name:"Issue and prepare take-home medicines"}).click();await expect(page.getByTestId("pharmacy-reconciliation")).toContainText("Stock prepared and reconciled for review");await expect(page.getByText("No seal has been issued here.",{exact:false})).toBeVisible();
  while(await page.locator("details[open] > summary:visible").count()) await page.locator("details[open] > summary:visible").first().click();
  await page.getByRole("heading",{name:"Medicine stock"}).click();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:testInfo.outputPath("pharmacy-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath("pharmacy-narrow.png"),fullPage:true});
  await useStaffSession(page,"BILLING");const denied=await page.goto(`/pharmacy?admissionId=${f.admissionId}`);expect(denied?.status()).toBe(404);
});
