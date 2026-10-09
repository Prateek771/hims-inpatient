import { db } from "../../src/server/db";
import { eq } from "drizzle-orm";
import { createStaffAuth } from "../../src/server/auth";
import { user } from "../../src/server/schema/auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
async function prepare() {
  for (const role of ["ADMIN", "DOCTOR", "ADMISSION", "BILLING", "NURSE", "PHARMACY", "LAB", "INSURANCE"] as const) {
    const email = `${role.toLowerCase()}@e2e.fixture.invalid`;
    const [existing] = await db
      .select()
      .from(user)
      .where(eq(user.email, email));
    if (!existing)
      await createStaffAuth().api.createUser({
        body: {
          name: `Synthetic E2E ${role}`,
          email,
          password: "SyntheticE2EOnly123!",
          role,
        },
      });
  }
  const { getAuth } = await import("../../src/server/auth");
  const { saveSetting, listSettings } = await import(
    "../../src/server/settings"
  );
  const { requireStaff, staffContext } = await import(
    "../../src/server/access"
  );
  const { createBed } = await import("../../src/server/admissions/commands");
  const { beds } = await import("../../src/server/admissions/schema");
  const response = await getAuth().api.signInEmail({
    asResponse: true,
    body: {
      email: "admin@e2e.fixture.invalid",
      password: "SyntheticE2EOnly123!",
    },
  });
  if (!response.ok) throw new Error("Synthetic fixture admin login failed");
  const h = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  let state = await listSettings(h);
  if (!state.hospital)
    await saveSetting(h, {
      expectedVersion: 0,
      reason: "Synthetic browser identity",
      value: {
        type: "hospital",
        name: "Synthetic E2E hospital",
        address: "Synthetic address",
        timezone: "Asia/Kolkata",
      },
    });
  state = await listSettings(h);
  if (
    !state.versions.some(
      (v) => v.payload.type === "bed-category" && v.payload.code === "GENERAL",
    )
  ) {
    await saveSetting(h, {
      expectedVersion: Math.max(
        0,
        ...state.versions
          .filter((v) => v.kind === "rule")
          .map((v) => v.version),
      ),
      reason: "Synthetic browser room category",
      value: {
        type: "bed-category",
        code: "GENERAL",
        name: "General",
        active: true,
      },
    });
  }
  const [bed] = await db
    .select()
    .from(beds)
    .where(eq(beds.label, "Synthetic E2E General bed"));
  if (!bed)
    await createBed(
      staffContext(await requireStaff(h), "synthetic-browser-bed"),
      {
        label: "Synthetic E2E General bed",
        category: "GENERAL",
        reason: "Synthetic browser inventory",
      },
    );
  await prepareBillingFixtures(h);
  await prepareCareFixtures(h);
  await prepareTransferFixtures(h);
  await preparePharmacyFixtures(h);
  await prepareLabFixtures(h);
  await prepareInsuranceFixtures(h);
  await prepareDischargeFixture(h);
  // Workflow browser contexts reuse real synthetic sessions, avoiding unrelated login-limiter traffic.
  // These signed cookies are credentials and stay exclusively inside the ignored test output folder.
  for (const role of ["ADMIN", "DOCTOR", "ADMISSION", "BILLING", "NURSE", "PHARMACY", "LAB", "INSURANCE"] as const) {
    const response = await getAuth().api.signInEmail({ asResponse: true, body: { email: `${role.toLowerCase()}@e2e.fixture.invalid`, password: "SyntheticE2EOnly123!" } });
    if (!response.ok) throw new Error("Synthetic storage-state sign-in failed");
    const cookies = response.headers.getSetCookie().map((header) => {
      const [pair, ...parts] = header.split(";");
      const separator = pair.indexOf("=");
      const attributes = new Map(parts.map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key.toLowerCase(), value.join("=")] as const;
      }));
      const maxAge = attributes.get("max-age"), expires = attributes.get("expires");
      const sameSite = attributes.get("samesite")?.toLowerCase();
      return { name: pair.slice(0, separator), value: pair.slice(separator+1), domain: attributes.get("domain") ?? "127.0.0.1", path: attributes.get("path") ?? "/", expires: maxAge ? Math.floor(Date.now()/1000) + Number(maxAge) : expires ? Date.parse(expires)/1000 : -1, httpOnly: attributes.has("httponly"), secure: attributes.has("secure"), sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax" };
    });
    const current = await requireStaff(new Headers({ cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }));
    if (current.role !== role) throw new Error("Synthetic storage-state role mismatch");
    const directory = resolve("tmp/e2e-auth");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${role.toLowerCase()}.json`), JSON.stringify({ cookies, origins: [] }));
  }
}

async function prepareBillingFixtures(adminHeaders: Headers) {
  const { getAuth } = await import("../../src/server/auth");
  const { requireStaff, staffContext } = await import("../../src/server/access");
  const { listSettings, saveSetting } = await import("../../src/server/settings");
  const { createAdmission, createBed, activateAdmission } = await import("../../src/server/admissions/commands");
  const { recordReceipt, postChargeInTransaction, reconcileBill } = await import("../../src/server/billing/commands");
  const { withTransaction } = await import("../../src/server/db");
  const { admissions } = await import("../../src/server/admissions/schema");
  const admin = await requireStaff(adminHeaders);
  const [doctor] = await db.select().from(user).where(eq(user.email, "doctor@e2e.fixture.invalid"));
  async function context(role: string) {
    const r = await getAuth().api.signInEmail({ asResponse: true, body: { email: `${role}@e2e.fixture.invalid`, password: "SyntheticE2EOnly123!" } });
    if (!r.ok) throw new Error("Synthetic billing fixture sign-in failed");
    const staff = await requireStaff(new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }));
    return staffContext(staff, "synthetic-browser-billing");
  }
  async function setting(value: Record<string, unknown>) {
    const state = await listSettings(adminHeaders);
    const kind = ["tariff", "billable-item"].includes(String(value.type)) ? "tariff" : "rule";
    return saveSetting(adminHeaders, { expectedVersion: Math.max(0, ...state.versions.filter((v) => v.kind === kind).map((v) => v.version)), value, reason: "Synthetic browser billing policy" });
  }
  const state = await listSettings(adminHeaders);
  if (!state.versions.some((v) => v.payload.type === "tariff" && v.payload.category === "GENERAL")) await setting({ type: "tariff", category: "GENERAL", amount: "500", basis: "hour", rounding: "exact", graceMinutes: 0 });
  await setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "500" });
  const item = await setting({ type: "billable-item", code: "E2E_CONSULT", name: "Synthetic recorded consultation", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1200", active: true });
  for (const name of ["Synthetic E2E billing patient", "Synthetic E2E activation patient"]) {
    const bed = await createBed(staffContext(admin, "synthetic-browser-bed"), { label: `Synthetic billing ${crypto.randomUUID()}`, category: "GENERAL", reason: "Synthetic browser billing inventory" });
    const desk = await context("admission");
    const a = await createAdmission(desk, { patientDetails: { name, ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: doctor.id, clinicianAssessment: { clinicianId: doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic complaint", vitals: "Synthetic assessment", triage: "Synthetic destination", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 2, requestId: desk.requestId });
    if (name.includes("activation")) continue;
    const cashier = await context("billing");
    await recordReceipt(cashier, { admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "50000", mode: "CASH", channel: "Synthetic E2E fixture book", sourceReference: crypto.randomUUID(), reference: "Synthetic initial deposit", requestId: cashier.requestId });
    const arrival = await context("admission");
    await activateAdmission(arrival, { admissionId: a.admissionId, expectedVersion: 1, arrivedAt: new Date().toISOString(), requestId: arrival.requestId });
    await withTransaction(async (tx) => {
      await tx.select().from(admissions).where(eq(admissions.id, a.admissionId)).for("update");
      await postChargeInTransaction(tx, await context("billing"), { admissionId: a.admissionId, sourceEventId: crypto.randomUUID(), itemId: "E2E_CONSULT", category: "consultation", quantity: "1", unit: "session", tariffVersionId: item.id, status: "FINAL" });
    });
    await reconcileBill(await context("billing"), { admissionId: a.admissionId, cutoff: new Date().toISOString() });
  }
}
async function prepareCareFixtures(adminHeaders: Headers, transferCase = false) {
  const { requireStaff } = await import("../../src/server/access");
  const { createAdmission, createBed, activateAdmission } = await import("../../src/server/admissions/commands");
  const { recordReceipt } = await import("../../src/server/billing/commands");
  const { recordRound } = await import("../../src/server/clinical/commands");
  const { assignNurse } = await import("../../src/server/nursing/commands");
  const admin = await requireStaff(adminHeaders);
  const [doctor] = await db.select().from(user).where(eq(user.email, "doctor@e2e.fixture.invalid"));
  const [nurse] = await db.select().from(user).where(eq(user.email, "nurse@e2e.fixture.invalid"));
  // This entrypoint is launched only by the guarded synthetic auth fixture process.
  const context = (id: string) => ({ actor: { type: "staff" as const, staffId: id }, source: "synthetic-browser-care", requestId: crypto.randomUUID() });
  const [desk] = await db.select().from(user).where(eq(user.email, "admission@e2e.fixture.invalid"));
  const [billing] = await db.select().from(user).where(eq(user.email, "billing@e2e.fixture.invalid"));
  const bed = await createBed(context(admin.id), { label: `Synthetic care ${crypto.randomUUID()}`, category: "GENERAL", reason: "Synthetic care inventory" });
  const deskCtx = context(desk.id);
  const a = await createAdmission(deskCtx, { patientDetails: { name: transferCase ? "Synthetic E2E transfer patient" : "Synthetic E2E care patient", ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: doctor.id, clinicianAssessment: { clinicianId: doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic complaint", vitals: "Synthetic assessment", triage: "Synthetic destination", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 2, requestId: deskCtx.requestId });
  const receiptCtx = context(billing.id);
  await recordReceipt(receiptCtx, { admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "50000", mode: "CASH", channel: "Synthetic care fixture book", sourceReference: crypto.randomUUID(), reference: "Synthetic care deposit", requestId: receiptCtx.requestId });
  const arrival = context(desk.id), startedAt = new Date().toISOString();
  await activateAdmission(arrival, { admissionId: a.admissionId, expectedVersion: 1, arrivedAt: startedAt, requestId: arrival.requestId });
  await assignNurse(context(admin.id), { admissionId: a.admissionId, nurseId: nurse.id, authority: "Synthetic hospital administrator schedule", reason: "Synthetic ward responsibility" });
  const round = context(doctor.id);
  await recordRound(round, { admissionId: a.admissionId, notes: "Synthetic care fixture round", requestId: round.requestId, orders: [
    { kind: "MEDICINE", requestedItem: "Synthetic prescribed medicine", dose: "5", doseUnit: "mg", route: "oral", frequency: "Clinician explicit schedule", durationDays: 1, medicationPurpose: "BOTH", dispensingQuantity: "4", dispensingUnit: "tablet", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } },
    { kind: "VITALS", requestedItem: "Synthetic clinician monitoring", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } },
    { kind: "VITALS", requestedItem: "Synthetic unresolved monitoring for handover", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } }
  ] });
  if (!transferCase) writeFileSync(resolve("tmp/e2e-care.json"), JSON.stringify({ admissionId: a.admissionId }));
  return { admissionId: a.admissionId, sourceBedId: bed.id, sourceBedLabel: bed.label };
}

async function prepareTransferFixtures(adminHeaders: Headers) {
  const { requireStaff, staffContext } = await import("../../src/server/access");
  const { listSettings, saveSetting } = await import("../../src/server/settings");
  const { createBed } = await import("../../src/server/admissions/commands");
  for (const value of [{ type: "bed-category", code: "ICU", name: "Synthetic ICU", active: true }, { type: "tariff", category: "ICU", amount: "1000", basis: "hour", rounding: "exact", graceMinutes: 0 }]) {
    const kind = value.type === "tariff" ? "tariff" : "rule";
    const settings = await listSettings(adminHeaders);
    await saveSetting(adminHeaders, { value, reason: "Synthetic transfer browser policy", expectedVersion: Math.max(0, ...settings.versions.filter(v => v.kind === kind).map(v => v.version)) });
  }
  const admin = await requireStaff(adminHeaders);
  const bed = await createBed(staffContext(admin, "synthetic-browser-transfer"), { label: `Synthetic transfer ICU ${crypto.randomUUID()}`, category: "ICU", reason: "Independent synthetic transfer target" });
  const episode = await prepareCareFixtures(adminHeaders, true);
  writeFileSync(resolve("tmp/e2e-transfer.json"), JSON.stringify({ ...episode, targetBedId: bed.id, targetBedLabel: bed.label }));
}

async function preparePharmacyFixtures(adminHeaders: Headers) {
  const { listSettings,saveSetting }=await import("../../src/server/settings");
  const { createBed,createAdmission,activateAdmission }=await import("../../src/server/admissions/commands");
  const { recordRound,getCare,signClinicalSummary }=await import("../../src/server/clinical/commands");
  const { recordReceipt }=await import("../../src/server/billing/commands");
  const { recordStockReceipt }=await import("../../src/server/pharmacy/commands");
  const staff=await db.select({id:user.id,email:user.email}).from(user);
  const id=(role:string)=>staff.find(s=>s.email===`${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx=(role:string)=>({actor:{type:"staff" as const,staffId:id(role)},source:"synthetic-browser-pharmacy",requestId:crypto.randomUUID()});
  const settings=await listSettings(adminHeaders);
  await saveSetting(adminHeaders,{expectedVersion:Math.max(0,...settings.versions.filter(v=>v.kind==="tariff").map(v=>v.version)),reason:"Synthetic pharmacy medicine",value:{type:"billable-item",code:"E2E_PHARM",name:"Synthetic pharmacy medicine",category:"medicine",department:"PHARMACY",unit:"tablet",quantityScale:0,amount:"25",active:true}});
  const bed=await createBed(ctx("ADMIN"),{label:`Synthetic pharmacy ${crypto.randomUUID()}`,category:"GENERAL",reason:"Independent synthetic pharmacy patient"});
  const ac=ctx("ADMISSION");
  const a=await createAdmission(ac,{patientDetails:{name:"Synthetic E2E pharmacy patient",ageYearsAtRegistration:54,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Synthetic assessment",vitals:"Synthetic vitals",triage:"Synthetic routing",destinationCategory:"GENERAL"},bedId:bed.id,paymentRoute:"SELF_PAY",expectedStayDays:2,requestId:ac.requestId});
  const rc=ctx("BILLING");await recordReceipt(rc,{admissionId:a.admissionId,party:"PATIENT",kind:"DEPOSIT",amountPaise:"50000",mode:"CASH",channel:"Synthetic pharmacy book",sourceReference:crypto.randomUUID(),reference:"Synthetic pharmacy deposit",requestId:rc.requestId});
  const activation=ctx("ADMISSION"),start=new Date().toISOString();await activateAdmission(activation,{admissionId:a.admissionId,arrivedAt:start,expectedVersion:1,requestId:activation.requestId});
  const dc=ctx("DOCTOR");await recordRound(dc,{admissionId:a.admissionId,notes:"Pharmacy fixture order, no contact/clinical notes projection",orders:[{kind:"MEDICINE",requestedItem:"Synthetic pharmacy medicine",itemId:"E2E_PHARM",dose:"5",doseUnit:"mg",route:"oral",frequency:"Explicit schedule",durationDays:1,medicationPurpose:"BOTH",dispensingQuantity:"4",dispensingUnit:"tablet",schedule:{startsAt:start,intervalMinutes:60,occurrences:1}}],requestId:dc.requestId});
  const order=(await getCare(ctx("DOCTOR"),a.admissionId)).orders[0];
  const rx=await signClinicalSummary(ctx("DOCTOR"),{admissionId:a.admissionId,expectedVersion:0,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Follow up",advice:"Advice",prescriptionOrderIds:[order.id]});
  const stock=ctx("PHARMACY"),suffix=crypto.randomUUID();
  const batch=await recordStockReceipt(stock,{medicineId:"E2E_PHARM",batchNo:`E2E-${suffix}`,expiresOn:"2099-12-31",quantity:"20",unit:"tablet",barcode:`SYNTH-${suffix}`,reference:"Synthetic browser stock",reorderThreshold:"18",requestId:stock.requestId});
  writeFileSync(resolve("tmp/e2e-pharmacy.json"),JSON.stringify({admissionId:a.admissionId,orderId:order.id,batchId:batch.id,barcode:`SYNTH-${suffix}`,prescriptionVersionId:rx.id}));
}

async function prepareLabFixtures(adminHeaders:Headers){
  const {listSettings,saveSetting}=await import("../../src/server/settings");
  const {createBed,createAdmission,activateAdmission}=await import("../../src/server/admissions/commands");
  const {recordRound,getCare}=await import("../../src/server/clinical/commands");
  const {recordReceipt}=await import("../../src/server/billing/commands");
  const staff=await db.select({id:user.id,email:user.email}).from(user),id=(role:string)=>staff.find(s=>s.email===`${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx=(role:string)=>({actor:{type:"staff" as const,staffId:id(role)},source:"synthetic-browser-lab",requestId:crypto.randomUUID()});
  for(const [code,category,name] of [["E2E_LAB","lab","Synthetic CBC"],["E2E_RADIO","radiology","Synthetic radiology"]]){
    const settings=await listSettings(adminHeaders);await saveSetting(adminHeaders,{expectedVersion:Math.max(0,...settings.versions.filter(v=>v.kind==="tariff").map(v=>v.version)),reason:"Synthetic diagnostic price",value:{type:"billable-item",code,name,category,department:"LAB",unit:"test",quantityScale:0,amount:"100",active:true}});
  }
  const bed=await createBed(ctx("ADMIN"),{label:`Synthetic lab ${crypto.randomUUID()}`,category:"GENERAL",reason:"Independent synthetic lab inventory"}),aCtx=ctx("ADMISSION");
  const a=await createAdmission(aCtx,{patientDetails:{name:"Synthetic E2E lab patient",ageYearsAtRegistration:54,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Private lab patient clinical assessment",vitals:"Synthetic vitals",triage:"Synthetic routing",destinationCategory:"GENERAL"},bedId:bed.id,paymentRoute:"SELF_PAY",expectedStayDays:2,requestId:aCtx.requestId});
  const receipt=ctx("BILLING");await recordReceipt(receipt,{admissionId:a.admissionId,party:"PATIENT",kind:"DEPOSIT",amountPaise:"50000",mode:"CASH",channel:"Synthetic lab book",sourceReference:crypto.randomUUID(),reference:"Synthetic lab deposit",requestId:receipt.requestId});
  const ac=ctx("ADMISSION");await activateAdmission(ac,{admissionId:a.admissionId,expectedVersion:1,arrivedAt:new Date().toISOString(),requestId:ac.requestId});
  const dc=ctx("DOCTOR");await recordRound(dc,{admissionId:a.admissionId,notes:"Private diagnostic clinician notes must stay out of Lab",orders:[{kind:"LAB",requestedItem:"Synthetic CBC",itemId:"E2E_LAB",quantity:"1",unit:"test"},{kind:"RADIOLOGY",requestedItem:"Synthetic radiology",itemId:"E2E_RADIO",quantity:"1",unit:"test"}],requestId:dc.requestId});
  const chart=await getCare(ctx("DOCTOR"),a.admissionId);writeFileSync(resolve("tmp/e2e-lab.json"),JSON.stringify({admissionId:a.admissionId,orderId:chart.orders.find(o=>o.kind==="LAB")!.id,radiologyId:chart.orders.find(o=>o.kind==="RADIOLOGY")!.id}));
}

async function prepareInsuranceFixtures(adminHeaders:Headers){
  const {createBed,createAdmission,activateAdmission}=await import("../../src/server/admissions/commands");
  const {createInsuranceCase,recordPolicyVerification,recordPayerDecision,getInsuranceCase}=await import("../../src/server/insurance/commands");
  const {listSettings,saveSetting}=await import("../../src/server/settings");
  const {recordRound}=await import("../../src/server/clinical/commands");
  const {recordReceipt}=await import("../../src/server/billing/commands");
  const staff=await db.select({id:user.id,email:user.email}).from(user),id=(role:string)=>staff.find(s=>s.email===`${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx=(role:string)=>({actor:{type:"staff" as const,staffId:id(role)},source:"synthetic-browser-insurance",requestId:crypto.randomUUID()});
  async function episode(assigned:boolean,name=assigned?"Synthetic E2E insurance patient":"Synthetic unassigned private case"){const bed=await createBed(ctx("ADMIN"),{label:`Synthetic insurance ${crypto.randomUUID()}`,category:"GENERAL",reason:"Independent synthetic insurance case"});const a=ctx("ADMISSION"),admission=await createAdmission(a,{patientDetails:{name,ageYearsAtRegistration:54,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Private clinical assessment excluded from Insurance",vitals:"Synthetic vitals",triage:"Synthetic routing",destinationCategory:"GENERAL"},bedId:bed.id,paymentRoute:"INSURED",expectedStayDays:2,requestId:a.requestId});const c=ctx("ADMIN"),record=await createInsuranceCase(c,{admissionId:admission.admissionId,assignedStaffId:assigned?id("INSURANCE"):null,reason:"Synthetic case assignment",requestId:c.requestId});return {...record,admissionId:admission.admissionId};}
  const assigned=await episode(true),unassigned=await episode(false);
  // A real signed consultation and Billing receipts reproduce the revised-allocation refund review.
  for(const value of [
    {type:"deposit",category:"GENERAL",route:"insured",requirement:"not-required",amount:"0"},
    {type:"billable-item",code:"E2E_INS_CONSULT",name:"Synthetic insurance consultation",category:"consultation",department:"DOCTOR",unit:"session",quantityScale:0,amount:"1000",active:true}
  ]){
    const settings=await listSettings(adminHeaders),kind=value.type==="deposit"?"rule":"tariff";
    await saveSetting(adminHeaders,{value,reason:"Synthetic insurance refund-review fixture",expectedVersion:Math.max(0,...settings.versions.filter(v=>v.kind===kind).map(v=>v.version))});
  }
  const revised=await episode(true,"Synthetic revised insurance allocation"),arrival=ctx("ADMISSION");
  await activateAdmission(arrival,{admissionId:revised.admissionId,expectedVersion:1,arrivedAt:new Date().toISOString(),requestId:arrival.requestId});
  const doctor=ctx("DOCTOR");
  await recordRound(doctor,{admissionId:revised.admissionId,notes:"Synthetic signed consultation",feeScheduleId:"E2E_INS_CONSULT",feeUnit:"session",orders:[],requestId:doctor.requestId});
  for(const [party,amountPaise] of [["PATIENT","70000"],["INSURER","30000"]]){
    const cashier=ctx("BILLING");
    await recordReceipt(cashier,{admissionId:revised.admissionId,party,kind:"PAYMENT",amountPaise,mode:"BANK",channel:"Synthetic insurance receipt book",sourceReference:crypto.randomUUID(),reference:`Synthetic ${party} applied payment`,requestId:cashier.requestId});
  }
  const verifier=ctx("INSURANCE");
  await recordPolicyVerification(verifier,{caseId:revised.id,expectedCaseVersion:1,requestId:verifier.requestId,insurer:"Synthetic external insurer",tpa:"",policyNumber:"SYN-REVISED-POL",memberNumber:"SYN-REVISED-MEM",validFrom:"2026-01-01",validTo:"2099-12-31",verifiedBy:"External human verifier",verifiedAt:new Date().toISOString(),reference:"SYN-REVISED-VERIFY",documentIds:[]});
  const bill=await getInsuranceCase(ctx("INSURANCE"),revised.id),decision=ctx("INSURANCE");
  assert.equal(bill.money.netPaise,100000n);
  assert.equal(bill.money.patientAppliedPaise,70000n);
  assert.equal(bill.money.insurerCashPaise,30000n);
  assert.equal(bill.money.unallocatedDepositPaise,0n);
  await recordPayerDecision(decision,{caseId:revised.id,expectedCaseVersion:bill.case.version,requestId:decision.requestId,kind:"PREAUTH",status:"APPROVED",verifiedBy:"External payer human",verifiedAt:new Date().toISOString(),reference:"SYN-INITIAL-AUTH",reason:"Synthetic initial external approval",approvedPaise:"30000",coPayBps:0,documentIds:[],allocation:{billRevision:bill.money.revision,netBillPaise:"100000",eligibleBillPaise:"100000",nonPayablePaise:"0",verifiedPatientLiabilityPaise:"70000",sourceReference:"Synthetic initial bill allocation"}});
  const initial=await getInsuranceCase(ctx("INSURANCE"),revised.id);
  assert.equal(initial.responsibility?.patientExcessPaise,0n);
  assert.equal(initial.responsibility?.insurerOutstandingPaise,0n);
  writeFileSync(resolve("tmp/e2e-insurance.json"),JSON.stringify({caseId:assigned.id,wrongCaseId:unassigned.id,revisedCaseId:revised.id}));
}

async function prepareDischargeFixture(adminHeaders:Headers){
  const {listSettings,saveSetting}=await import("../../src/server/settings");
  const {createBed,createAdmission,activateAdmission}=await import("../../src/server/admissions/commands");
  const {signClinicalSummary}=await import("../../src/server/clinical/commands");
  const {assignNurse,recordShift}=await import("../../src/server/nursing/commands");
  const staff=await db.select({id:user.id,email:user.email}).from(user),id=(role:string)=>staff.find(s=>s.email===`${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx=(role:string)=>({actor:{type:"staff" as const,staffId:id(role)},source:"synthetic-browser-discharge",requestId:crypto.randomUUID()});
  for(const value of [{type:"bed-category",code:"DISCHARGE",name:"Synthetic exact-hour discharge",active:true},{type:"deposit",category:"DISCHARGE",route:"self-pay",requirement:"not-required",amount:"0"},{type:"tariff",category:"DISCHARGE",amount:"3600",basis:"hour",rounding:"exact",graceMinutes:0}]){
    const state=await listSettings(adminHeaders),kind=value.type==="tariff"?"tariff":"rule";
    await saveSetting(adminHeaders,{value,expectedVersion:Math.max(0,...state.versions.filter(v=>v.kind===kind).map(v=>v.version)),reason:"Isolated synthetic discharge browser policy"});
  }
  const bed=await createBed(ctx("ADMIN"),{label:`Synthetic discharge ${crypto.randomUUID()}`,category:"DISCHARGE",reason:"Isolated discharge browser bed"});
  const a=ctx("ADMISSION"),admission=await createAdmission(a,{patientDetails:{name:"Synthetic E2E discharge patient",ageYearsAtRegistration:54,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Private clinical assessment not for Billing",vitals:"Synthetic vitals",triage:"Synthetic route",destinationCategory:"DISCHARGE"},bedId:bed.id,paymentRoute:"SELF_PAY",expectedStayDays:1,requestId:a.requestId});
  const ac=ctx("ADMISSION"),arrivedAt=new Date().toISOString();await activateAdmission(ac,{admissionId:admission.admissionId,arrivedAt,expectedVersion:1,requestId:ac.requestId});
  await assignNurse(ctx("ADMIN"),{admissionId:admission.admissionId,nurseId:id("NURSE"),reason:"Actual browser nursing assignment",authority:"Synthetic roster"});
  const nurse=ctx("NURSE");await recordShift(nurse,{admissionId:admission.admissionId,startedAt:new Date().toISOString(),handover:"Continue monitoring until physical departure",requestId:nurse.requestId});
  await signClinicalSummary(ctx("DOCTOR"),{admissionId:admission.admissionId,expectedVersion:0,diagnosis:"Synthetic Doctor diagnosis",course:"Signed human course",condition:"Reviewed by Doctor",followUp:"Human follow-up",advice:"Human advice",prescriptionOrderIds:[]});
  const settings=await listSettings(adminHeaders);await saveSetting(adminHeaders,{value:{type:"deposit",category:"DISCHARGE",route:"insured",requirement:"not-required",amount:"0"},expectedVersion:Math.max(0,...settings.versions.filter(v=>v.kind==="rule").map(v=>v.version)),reason:"Synthetic unallocated insured browser policy"});
  const unallocatedBed=await createBed(ctx("ADMIN"),{label:`Synthetic unallocated ${crypto.randomUUID()}`,category:"DISCHARGE",reason:"Independent responsibility review fixture"});
  const u=ctx("ADMISSION"),unallocated=await createAdmission(u,{patientDetails:{name:"Synthetic unallocated discharge patient",ageYearsAtRegistration:40,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Synthetic complaint",vitals:"Synthetic vitals",triage:"Synthetic route",destinationCategory:"DISCHARGE"},bedId:unallocatedBed.id,paymentRoute:"INSURED",expectedStayDays:1,requestId:u.requestId});
  const arrival=ctx("ADMISSION");await activateAdmission(arrival,{admissionId:unallocated.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:arrival.requestId});
  await new Promise(resolve=>setTimeout(resolve,80));
  const {reconcileBill,getBill}=await import("../../src/server/billing/commands");await reconcileBill(ctx("BILLING"),{admissionId:unallocated.admissionId,cutoff:new Date().toISOString()});assert((await getBill(ctx("BILLING"),unallocated.admissionId)).netPaise>0n);
  writeFileSync(resolve("tmp/e2e-discharge.json"),JSON.stringify({admissionId:admission.admissionId,bedLabel:bed.label,arrivedAt,unallocatedAdmissionId:unallocated.admissionId}));
}

prepare()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify({
        fixtureError: error.name,
        code: error.code ?? error.cause?.code ?? null,
      }),
    );
    process.exit(1);
  });
