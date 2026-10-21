import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession } from "../support/browser-session";
import { fillUtcDateTime } from "../support/datetime-input";
import { openWorkflowTab } from "../support/workflow-tabs";
import { submitServerAction } from "../support/server-action";

test.describe.configure({ mode: "serial" });

type Fixture={meeraAdmissionId:string;meeraShiftId:string;meeraFinalDocumentId:string;selfPayAdmissionId:string;selfPayShiftId:string};
const fixture=async():Promise<Fixture>=>JSON.parse(await readFile(resolve("tmp/e2e-mvp.json"),"utf8"));

test("Admin MVP shows real patient ownership, settled patient money and a separate insurer receivable",async({page},info)=>{
  const f=await fixture();await useStaffSession(page,"ADMIN");
  await page.goto(`/overview?q=Meera&selected=${f.meeraAdmissionId}`);
  await expect(page.getByRole("heading",{name:"Patients & admissions",exact:true})).toBeVisible();
  const nav=page.getByRole("navigation",{name:"Hospital sections"});
  await expect(nav.getByRole("link")).toHaveText(["Patients & admissions","Beds","Payments & insurance","Medicine bills & returns","Discharge","Staff & settings"]);
  await expect(page.getByRole("row").filter({has:page.locator(`a[href*="${f.meeraAdmissionId}"]`)})).toHaveCount(1);
  await expect(page.locator("main")).toContainText("₹90,000.00");
  await expect(page.locator("main")).toContainText("₹1,15,000.00");
  await expect(page.locator("main")).toContainText(/receivable/i);
  await expect(page.locator("main")).not.toContainText("Actual insurer money still owed");
  expect((await page.request.get("/clinical")).status()).toBe(404);
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.locator("body").evaluate(e=>getComputedStyle(e).fontFamily)).toContain("public");
  await page.screenshot({path:info.outputPath("mvp-admin-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("mvp-admin-narrow.png"),fullPage:true});
});

test("assigned Nurse records external approval and generates the first clinical papers before checklist or finance",async({page})=>{
  test.setTimeout(60_000);const f=await fixture();await useStaffSession(page,"NURSE");await page.goto(`/mvp/${f.selfPayAdmissionId}`);
  await page.getByText("Record external Doctor approval",{exact:true}).click();const form=page.getByTestId("mvp-doctor-approval");
  await form.getByLabel("Named clinical authorizer",{exact:true}).fill("Synthetic external Doctor");
  await fillUtcDateTime(form.getByLabel("Doctor source time (Asia/Kolkata)",{exact:true}),new Date());
  await form.getByLabel("Clinical source / signed evidence reference",{exact:true}).fill("Synthetic signed Doctor instruction for browser acceptance");
  await form.getByLabel("Doctor-provided clinical summary",{exact:true}).fill("Synthetic externally supplied clinical findings");
  await form.getByLabel("Doctor-provided prescription / explicit none",{exact:true}).fill("External Doctor recorded no take-home medicine");
  await form.getByLabel("Doctor-provided follow-up / advice",{exact:true}).fill("External Doctor supplied follow-up instructions");
  await submitServerAction(page,form.getByRole("button",{name:"Record Doctor approval",exact:true}));
  await expect(form.getByRole("status")).toContainText("Recorded");await page.reload();
  await expect(page.getByRole("heading",{name:"Published patient checklist",exact:true})).toHaveCount(0);
  await openWorkflowTab(page,"Vacancy, papers & exit");
  await page.getByText("Generate an authorized paper version",{exact:true}).click();const generate=page.getByTestId("mvp-generate-paper");
  await generate.getByRole("combobox",{name:"Authorized paper kind",exact:true}).selectOption("CLINICAL");
  await expect(generate.getByRole("combobox",{name:"Authorized paper kind",exact:true}).locator('option[value="FINAL"]')).toHaveCount(0);
  await submitServerAction(page,generate.getByRole("button",{name:"Generate authorized paper",exact:true}));
  await expect(generate.getByRole("status")).toContainText(/generat/i);
  const paper=page.getByRole("link",{name:/CLINICAL · version/}).first();await expect(paper).toBeVisible();
  const href=await paper.getAttribute("href");await paper.click();await expect(page.getByTestId("final-copy")).toContainText("Synthetic externally supplied clinical findings");
  const id=href!.split("/").at(-1)!;expect((await page.request.get(`/api/documents/${id}/pdf`)).status()).toBe(200);
  await useStaffSession(page,"PHARMACY");expect((await page.request.get(`/api/documents/${id}/pdf`)).status()).toBe(403);
});

test("Nurse delivers exact final papers and records exit; Billing settles insurer credit without rewriting that copy",async({page},info)=>{
  test.setTimeout(90_000);const f=await fixture();await useStaffSession(page,"NURSE");await page.goto(`/mvp/${f.meeraAdmissionId}?tab=exit`);
  const original=await page.request.get(`/api/documents/${f.meeraFinalDocumentId}/pdf`);expect(original.status()).toBe(200);const bytes=await original.body();
  await openWorkflowTab(page,"Vacancy, papers & exit");await page.getByText("Deliver authorized patient papers",{exact:true}).click();
  const delivery=page.getByTestId("mvp-delivery");await delivery.getByRole("combobox",{name:"Delivered paper kind",exact:true}).selectOption("FINAL");
  await delivery.getByRole("combobox",{name:"Exact document version delivered",exact:true}).selectOption(f.meeraFinalDocumentId);
  await delivery.getByLabel("Actual paper recipient",{exact:true}).fill("Meera Shah");
  await fillUtcDateTime(delivery.getByLabel("Actual paper delivery time (Asia/Kolkata)",{exact:true}),new Date());
  await delivery.getByLabel("Paper delivery evidence / acknowledgment",{exact:true}).fill("Synthetic patient acknowledged exact paper version");
  await submitServerAction(page,delivery.getByRole("button",{name:"Record authorized paper delivery",exact:true}));await expect(delivery.getByRole("status")).toContainText("Recorded");
  await page.reload();await openWorkflowTab(page,"Vacancy, papers & exit");await page.locator("summary").filter({hasText:/^Confirm actual hospital exit$/}).click();
  const exit=page.getByTestId("mvp-exit");await exit.getByRole("combobox",{name:"Your recorded care shift",exact:true}).selectOption(f.meeraShiftId);await fillUtcDateTime(exit.getByLabel("Actual hospital exit (Asia/Kolkata)",{exact:true}),new Date());
  await submitServerAction(page,exit.getByRole("button",{name:"Confirm actual hospital exit",exact:true}));await expect(page.locator("main")).toContainText("DISCHARGED");
  await useStaffSession(page,"BILLING");await page.goto(`/mvp/${f.meeraAdmissionId}?tab=money`);await openWorkflowTab(page,"Money & insurance");
  await page.getByText("Record actual insurer receipt against receivable",{exact:true}).click();const receipt=page.getByTestId("mvp-insurer-receipt");
  await receipt.getByLabel("Actual insurer receipt amount (INR)",{exact:true}).fill("90000");await receipt.getByRole("combobox",{name:"Actual receipt mode",exact:true}).selectOption("BANK");
  await receipt.getByLabel("Receipt bank / channel account",{exact:true}).fill("Synthetic insurer bank ledger");await receipt.getByLabel("Receipt transaction / book reference",{exact:true}).fill(`MVP-BROWSER-${Date.now()}`);
  await receipt.getByLabel("Insurer receipt record reference",{exact:true}).fill("Synthetic later ordinary insurer settlement");await receipt.getByLabel("Insurer receipt evidence reference",{exact:true}).fill("Synthetic actual bank receipt evidence");
  await submitServerAction(page,receipt.getByRole("button"));await expect(receipt.getByRole("status")).toContainText("Historical exit is unchanged");
  expect(await(await page.request.get(`/api/documents/${f.meeraFinalDocumentId}/pdf`)).body()).toEqual(bytes);
  await expect(page.getByRole("heading",{name:"Post-exit financial corrections",exact:true})).toBeVisible();
  await expect(page.getByTestId("mvp-correction-authorize-insurance_decision")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("mvp-late-insurer-settlement.png"),fullPage:true});
  await useStaffSession(page,"ADMIN");await page.goto(`/mvp/${f.meeraAdmissionId}?tab=money`);await openWorkflowTab(page,"Money & insurance");
  await expect(page.getByRole("heading",{name:"Post-exit financial corrections",exact:true})).toBeVisible();await expect(page.getByTestId("mvp-correction-authorize-reverse_charge")).toHaveCount(1);await expect(page.getByTestId("mvp-correction-authorize-receipt")).toHaveCount(0);
});

test("Billing records an externally performed service and retains its source after a linked reversal",async({page})=>{
  const f=await fixture();await useStaffSession(page,"BILLING");await page.goto(`/mvp/${f.selfPayAdmissionId}?tab=money`);await openWorkflowTab(page,"Money & insurance");
  await page.getByText("Record a performed service charge",{exact:true}).click();const form=page.getByTestId("mvp-service-charge");
  await form.getByRole("combobox",{name:"Configured performed service / exact unit",exact:true}).selectOption({label:"Synthetic recorded consultation · consultation · session · ₹1,200.00 per unit"});
  await form.getByLabel("Actually performed service quantity",{exact:true}).fill("1");await fillUtcDateTime(form.getByLabel("Service actually performed (Asia/Kolkata)",{exact:true}),new Date());
  await form.getByLabel("Named performing department / bill issuer",{exact:true}).fill("Synthetic external consultation desk");await form.getByLabel("External service bill / invoice reference",{exact:true}).fill("MVP-BROWSER-SERVICE");await form.getByLabel("Unique external service bill line reference",{exact:true}).fill("consultation-1");await form.getByLabel("Performed service evidence / document reference",{exact:true}).fill("Synthetic external performed consultation invoice");
  await submitServerAction(page,form.getByRole("button"));await expect(form.getByRole("status")).toContainText("configured-price charge recorded");await page.reload();await openWorkflowTab(page,"Money & insurance");
  const row=page.getByRole("row").filter({hasText:"Synthetic recorded consultation"});await expect(row).toContainText("₹1,200.00");await row.getByText("Correct original ledger charge",{exact:true}).click();const reversal=row.locator("form");await reversal.getByLabel("Reverse charge (INR)",{exact:true}).fill("1200");await reversal.getByLabel("Reversal reason",{exact:true}).fill("Synthetic source bill was attributed in error; linked correction retains evidence");await submitServerAction(page,reversal.getByRole("button"));await expect(row.getByText("Correct original ledger charge",{exact:true})).toHaveCount(0);await page.reload();await openWorkflowTab(page,"Money & insurance");
  await expect(page.getByRole("heading",{name:"Retained performed-service billing evidence",exact:true})).toBeVisible();await expect(page.locator("main")).toContainText("MVP-BROWSER-SERVICE");await expect(page.getByRole("row").filter({hasText:"Synthetic recorded consultation"}).getByText("Correct original ledger charge",{exact:true})).toHaveCount(0);
});

test("self-pay completes real medicine return, parallel checks, finance, exact papers and Nurse exit",async({page})=>{
  test.setTimeout(120_000);const f=await fixture(),url=`/mvp/${f.selfPayAdmissionId}`;
  const submit=async(form:ReturnType<typeof page.getByTestId>,message=/Recorded|credited/)=>{await submitServerAction(page,form.getByRole("button"));await expect(form.getByRole("status")).toContainText(message);await page.reload();};
  await useStaffSession(page,"PHARMACY");await page.goto(url);await openWorkflowTab(page,"Medicine bills & returns");await page.getByText("Record patient medicine charge",{exact:true}).click();
  let form=page.getByTestId("mvp-medicine-charge");await form.getByRole("combobox",{name:"Configured medicine / original price",exact:true}).selectOption({label:"Synthetic medicine patient charge · pack · ₹5,000.00"});await form.getByLabel("Medicine charge quantity",{exact:true}).fill("1");await form.getByLabel("Original patient medicine bill / charge reference",{exact:true}).fill("MVP-BROWSER-SELF-PAY-MEDICINE");await form.getByLabel("Medicine charge evidence",{exact:true}).fill("Synthetic actual patient medicine charge");await submit(form);
  await openWorkflowTab(page,"Medicine bills & returns");await page.getByText("Accept unused medicine return",{exact:true}).click();form=page.getByTestId("mvp-medicine-return");const original=await form.getByRole("combobox",{name:"Original patient medicine charge",exact:true}).locator('option[value]:not([value=""])').first().getAttribute("value");await form.getByRole("combobox",{name:"Original patient medicine charge",exact:true}).selectOption(original!);await form.getByLabel("Accepted return quantity",{exact:true}).fill("1");await form.getByLabel("Accepted return reason",{exact:true}).fill("Whole unused synthetic pack accepted");await form.getByLabel("Unused medicine acceptance evidence",{exact:true}).fill("Synthetic original-price accepted return");await submit(form,/credited/);
  await useStaffSession(page,"NURSE");await page.goto(url);await page.getByText("Publish physical patient checklist",{exact:true}).click();form=page.getByTestId("mvp-checklist");await form.getByLabel("Physical readiness items · one per line",{exact:true}).fill("External Doctor papers supplied\nPhysical waiting care handover ready");await form.getByRole("checkbox",{name:"insurance",exact:true}).check();await form.getByRole("checkbox",{name:"diagnostics",exact:true}).check();await form.getByLabel("Checklist and applicability remarks",{exact:true}).fill("Self-pay with accepted medicine return; no insurance or diagnostics");await submit(form);
  await page.getByText("Record your readiness check",{exact:true}).click();form=page.getByTestId("mvp-check");await form.getByRole("combobox",{name:"Responsible check",exact:true}).selectOption("NURSING");await form.getByLabel("Review outcome and remarks",{exact:true}).fill("Assigned Nurse completed physical readiness");await submit(form);
  await useStaffSession(page,"PHARMACY");await page.goto(url);await openWorkflowTab(page,"Readiness & checks");await page.getByText("Record your readiness check",{exact:true}).click();form=page.getByTestId("mvp-check");await form.getByRole("combobox",{name:"Responsible check",exact:true}).selectOption("PHARMACY");await form.getByLabel("Review outcome and remarks",{exact:true}).fill("Original medicine charge and unused return fully reconciled");await submit(form);
  await useStaffSession(page,"ADMIN");await page.goto(url);for(const check of ["INSURANCE","DIAGNOSTICS"]){await page.getByText("Confirm proposed optional N/A",{exact:true}).click();form=page.getByTestId("mvp-na");await form.getByRole("combobox",{name:"Optional check",exact:true}).selectOption(check);await form.getByLabel("No relevant service or pending work · reason",{exact:true}).fill("No applicable service or pending work in this synthetic self-pay episode");await submit(form);}
  await useStaffSession(page,"NURSE");await page.goto(url);await openWorkflowTab(page,"Vacancy, papers & exit");await page.locator("summary").filter({hasText:/^Record actual bed vacancy$/}).click();form=page.getByTestId("mvp-vacancy");await form.getByRole("combobox",{name:"Your recorded care shift",exact:true}).selectOption(f.selfPayShiftId);await fillUtcDateTime(form.getByLabel("Actual bed vacancy (Asia/Kolkata)",{exact:true}),new Date());await form.getByLabel("Actual waiting location",{exact:true}).fill("Synthetic supervised waiting chair");await form.getByLabel("Waiting care owner and ongoing handover",{exact:true}).fill("Assigned Nurse retains actual waiting care while bed remains held");await submitServerAction(page,form.getByRole("button"));await expect(page.locator("main")).toContainText("Bed vacant · held until exit & turnover");await expect(form).toHaveCount(0);await page.reload();
  await useStaffSession(page,"BILLING");await page.goto(url);await openWorkflowTab(page,"Vacancy, papers & exit");form=page.getByTestId("mvp-finance");await form.getByLabel("Final financial review and acceptance reason",{exact:true}).fill("Zero net after accepted original-price return; no receipt or refund invented");await submit(form);
  await useStaffSession(page,"NURSE");await page.goto(url);await openWorkflowTab(page,"Vacancy, papers & exit");await page.getByText("Generate an authorized paper version",{exact:true}).click();form=page.getByTestId("mvp-generate-paper");await form.getByRole("combobox",{name:"Authorized paper kind",exact:true}).selectOption("FINAL");await submit(form,/generat/i);
  await openWorkflowTab(page,"Vacancy, papers & exit");const paper=await page.getByRole("link",{name:/FINAL · version/}).first().getAttribute("href");await page.getByText("Deliver authorized patient papers",{exact:true}).click();form=page.getByTestId("mvp-delivery");await form.getByRole("combobox",{name:"Delivered paper kind",exact:true}).selectOption("FINAL");await form.getByRole("combobox",{name:"Exact document version delivered",exact:true}).selectOption(paper!.split("/").at(-1)!);await form.getByLabel("Actual paper recipient",{exact:true}).fill("Synthetic self-pay patient");await fillUtcDateTime(form.getByLabel("Actual paper delivery time (Asia/Kolkata)",{exact:true}),new Date());await form.getByLabel("Paper delivery evidence / acknowledgment",{exact:true}).fill("Synthetic acknowledged final exact-version copy");await submit(form);
  await openWorkflowTab(page,"Vacancy, papers & exit");await page.locator("summary").filter({hasText:/^Confirm actual hospital exit$/}).click();form=page.getByTestId("mvp-exit");await form.getByRole("combobox",{name:"Your recorded care shift",exact:true}).selectOption(f.selfPayShiftId);await fillUtcDateTime(form.getByLabel("Actual hospital exit (Asia/Kolkata)",{exact:true}),new Date());await submitServerAction(page,form.getByRole("button"));await expect(page.locator("main")).toContainText("DISCHARGED");
});
