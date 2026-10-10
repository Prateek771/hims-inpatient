import { expect,test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession as loadStaffSession } from "../support/browser-session";
import { fillUtcDateTime } from "../support/datetime-input";
test("unallocated insured responsibility stays unknown while real zero cash and positive charges remain visible",async({page})=>{
  const f=JSON.parse(await readFile(resolve("tmp/e2e-discharge.json"),"utf8")) as {unallocatedAdmissionId:string};
  await loadStaffSession(page,"BILLING");await page.goto(`/discharge?admissionId=${f.unallocatedAdmissionId}`);
  expect(Number((await page.getByTestId("discharge-net").innerText()).replace(/[^0-9.]/g,""))).toBeGreaterThan(0);
  for(const label of ["Patient amount remaining","Insurer amount remaining","Excess patient cash to resolve","Excess insurer cash to resolve"]){const row=page.locator(".discharge-money > div").filter({has:page.getByText(label,{exact:true})});await expect(row).toContainText("Awaiting responsibility review");await expect(row).not.toContainText("₹0.00");}
  await expect(page.locator(".discharge-money > div").filter({has:page.getByText("Actual insurer money retained",{exact:true})})).toContainText("₹0.00");
  await expect(page.getByTestId("gate-BILLING")).toContainText("Waiting");await expect(page.getByRole("button",{name:"Clearance unavailable"})).toBeDisabled();
});
test("real staff sign in sequence, settle exact occupied time and record hospital departure separately",async({page},testInfo)=>{
  const f=JSON.parse(await readFile(resolve("tmp/e2e-discharge.json"),"utf8")) as {admissionId:string;bedLabel:string};
  for(const [role,gate] of [["DOCTOR","DOCTOR"],["PHARMACY","PHARMACY"],["NURSE","NURSING"]] as const){
    await loadStaffSession(page,role);await page.goto(`/discharge?admissionId=${f.admissionId}`);
    const sign=page.getByTestId("clearance-sign");await sign.getByLabel("Review and reconciliation note").fill(`Actual ${role} reviewed this admission's displayed records`);await sign.getByRole("button").click();
    await expect(page.getByTestId(`gate-${gate}`)).toContainText("Approved");
  }
  await page.getByText("Record actual end of bed use",{exact:true}).click();const vacate=page.getByTestId("room-vacate");
  await fillUtcDateTime(vacate.getByLabel("Actual bed vacancy (Asia/Kolkata)"),new Date());await vacate.getByLabel("Actual waiting location outside the bed").fill("Discharge waiting chairs; bed physically vacant");await vacate.getByLabel("Nursing handover and ongoing monitoring").fill("Continue prescribed monitoring with assigned nurse");await vacate.getByRole("button").click();await expect(page.getByText(/Physical bed use ended.*waiting at/)).toBeVisible();
  await loadStaffSession(page,"BILLING");await page.goto(`/discharge?admissionId=${f.admissionId}`);
  await expect(page.getByText("Synthetic Doctor diagnosis")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Three checks complete. One step waiting."})).toBeVisible();
  const amount=(await page.getByTestId("discharge-net").innerText()).replace(/[^0-9.]/g,"");expect(Number(amount)).toBeGreaterThan(0);
  await page.getByRole("heading",{level:1}).click();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:testInfo.outputPath("discharge-waiting-desktop.png"),fullPage:true});
  await page.getByText("Record actual money received",{exact:true}).click();
  const receipt=page.locator("form").filter({has:page.getByRole("button",{name:"Record manual receipt",exact:true})});
  await receipt.getByLabel("Receipt kind").selectOption("PAYMENT");await receipt.getByLabel("Amount received (INR)").fill(amount);await receipt.getByLabel("Cash book / channel account").fill("Synthetic discharge cashbook");await receipt.getByLabel("Receipt number / transaction ID").fill(`EXIT-${crypto.randomUUID()}`);await receipt.getByLabel("Staff reference",{exact:true}).fill("Actual final self-pay receipt");await receipt.getByRole("button").click();await expect(receipt.getByRole("status")).toContainText("Manual receipt recorded");
  await page.reload();await expect(page.getByTestId("discharge-net")).toHaveText(`₹${Number(amount).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  await expect(page.getByRole("heading",{name:"Ready for a complete handover"})).toBeVisible();
  await page.getByRole("heading",{level:1}).click();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:testInfo.outputPath("discharge-ready-desktop.png"),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath("discharge-ready-narrow.png"),fullPage:true});
  const seal=page.getByTestId("clearance-sign");await seal.getByLabel("Review and reconciliation note").fill("Exact room cutoff and actual patient settlement reviewed");await seal.getByRole("button").click();await expect(page.getByTestId("gate-BILLING")).toContainText("Approved");
  const depart=page.getByTestId("hospital-departure");await fillUtcDateTime(depart.getByLabel("Actual hospital departure (Asia/Kolkata)"),new Date());await depart.getByRole("button").click();await expect(page.getByRole("heading",{name:"Hospital departure recorded."})).toBeVisible();
  await page.reload();await expect(page.getByTestId("gate-BILLING")).toContainText("Approved");
  await loadStaffSession(page,"ADMIN");await page.goto("/discharge");await page.getByText(`${f.bedLabel} · cleaning pending`,{exact:true}).click();const cleaning=page.locator("details").filter({has:page.getByText(`${f.bedLabel} · cleaning pending`,{exact:true})});await fillUtcDateTime(cleaning.getByLabel("Actual cleaning completed (Asia/Kolkata)"),new Date());await cleaning.getByLabel("Housekeeping confirmation / evidence").fill("Housekeeping staff confirmed bed clean");await cleaning.getByRole("button").click();await expect(page.getByText(`${f.bedLabel} · cleaning pending`,{exact:true})).toHaveCount(0);
  await loadStaffSession(page,"LAB");expect((await page.request.get(`/discharge?admissionId=${f.admissionId}`)).status()).toBe(404);
});
