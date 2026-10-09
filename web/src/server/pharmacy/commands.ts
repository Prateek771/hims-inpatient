import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, patients } from "../admissions/schema";
import { hospitalSettings, settingVersions } from "../schema/core";
import { user } from "../schema/auth";
import { clinicalOrders, clinicalSummaries, clinicalTaskEvents } from "../clinical/schema";
import { requestKey } from "../clinical/commands";
import { quantity } from "../clinical/input";
import { actorColumns, billingRequest, bumpBillRevision, itemPolicyInput, lockBillingAdmission, postChargeInTransaction, resolveBillableRate } from "../billing/commands";
import { charges, chargeReversals } from "../billing/schema";
import { quantityAmount } from "../billing/money";
import { appendAudit } from "../audit";
import { pharmacyBatches, pharmacyMovements, pharmacyPreparations, type PreparedItem } from "./schema";
// Supplied-Tx callers take shared 729104211 before staff/request/admission locks,
// then admission followed by affected batches in sorted ID order. These primitives
// compose directly on that transaction; no nested/global pool operation owns effects.
const label = z.string().trim().min(1).max(150);
const reason = z.string().trim().min(3).max(500);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const barcode = z.string().trim().regex(/^[A-Za-z0-9_.:/-]{2,100}$/);
const medicineId = z.string().regex(/^[A-Z0-9_-]{2,32}$/);
// Integer millionths preserve exact stock quantities independently of dose units and floating point.
export function stockUnits(value: string, scale = 6): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value) || (value.split(".")[1]?.length ?? 0) > scale)
    throw new DomainError("VALIDATION", "Stock quantity exceeds the configured decimal scale");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6,"0"));
}
export function stockQuantity(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  const fraction = (n % 1000000n).toString().padStart(6,"0").replace(/0+$/,"");
  return `${sign}${n/1000000n}${fraction ? `.${fraction}` : ""}`;
}
export function hospitalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  return ["year","month","day"].map(type => parts.find(p => p.type === type)!.value).join("-");
}
async function operator(tx: Transaction, ctx: CommandContext, adjustment = false) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
  return admissionOperator(ctx, adjustment ? ["ADMIN"] : ["PHARMACY", "ADMIN"], tx);
}
async function hospital(tx: Transaction) {
  const [h] = await tx.select().from(hospitalSettings).limit(1);
  if (!h) throw new DomainError("PRECONDITION", "Configure the hospital first");
  return h;
}
async function episode(tx: Transaction, admissionId: string, active = true) {
  const e = await lockBillingAdmission(tx, admissionId);
  if (active && e.status !== "ADMITTED") throw new DomainError("PRECONDITION", "Medicine fulfillment requires an active admission");
  const orders = await tx.select({ id: clinicalOrders.id }).from(clinicalOrders).where(and(eq(clinicalOrders.admissionId, e.id), eq(clinicalOrders.kind,"MEDICINE"))).limit(1);
  if (!orders.length) throw new DomainError("FORBIDDEN", "Pharmacy access requires a persisted medicine order");
  return e;
}
async function batches(tx: Transaction, ids: string[]) {
  const rows = ids.length ? await tx.select().from(pharmacyBatches).where(inArray(pharmacyBatches.id,[...new Set(ids)].sort())).orderBy(asc(pharmacyBatches.id)).for("update") : [];
  if (rows.length !== new Set(ids).size) throw new DomainError("VALIDATION", "Unknown medicine batch");
  return rows;
}
async function availableBatch(tx: Transaction, batch: typeof pharmacyBatches.$inferSelect, hospitalId: string) {
  const h = await hospital(tx);
  if (batch.hospitalId !== hospitalId || h.id !== hospitalId) throw new DomainError("FORBIDDEN", "Batch belongs to another hospital");
  // Valid through the end of the expiry date in the configured hospital timezone.
  if (batch.expiresOn < hospitalDate(new Date(), h.timezone)) throw new DomainError("PRECONDITION", "Expired batch cannot be issued");
}
async function medicineOrder(tx: Transaction, admissionId: string, orderId: string) {
  const [o] = await tx.select().from(clinicalOrders).where(eq(clinicalOrders.id,orderId));
  if (!o || o.admissionId !== admissionId || o.kind !== "MEDICINE") throw new DomainError("VALIDATION", "Issue requires this admission's actual medicine order");
  if (!o.medicineItemId || !o.medicineCatalogVersionId) throw new DomainError("PRECONDITION", "Doctor must resolve the prescribed medicine identity; text is not stock authority");
  if ((await tx.select().from(clinicalTaskEvents).where(and(eq(clinicalTaskEvents.orderId,o.id),eq(clinicalTaskEvents.status,"STOPPED")))).length) throw new DomainError("PRECONDITION", "Stopped medicine order cannot be fulfilled");
  return o;
}
async function audit(tx: Transaction, ctx: CommandContext, action: string, id: string, why: string) {
  await appendAudit(tx, ctx, { event: `pharmacy.${action}`, entityType: "pharmacy", entityId:id, reason:why });
}
const receiptInput = z.strictObject({ medicineId, batchNo:label, expiresOn:date, quantity, unit:label, barcode, reference:reason, reorderThreshold:z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(), requestId:z.uuid() });
export async function recordStockReceipt(ctx: CommandContext, input: unknown) { return withTransaction(tx => recordStockReceiptInTransaction(tx,ctx,input)); }
export async function recordStockReceiptInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const v = receiptInput.parse(input); requestKey(ctx,v.requestId);
  const staff = await operator(tx,ctx);
  return billingRequest(tx,ctx,"pharmacy.receipt",v,async () => {
    const h = await hospital(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pharmacy-stock:${h.id}`},0))`);
    const [old] = await tx.select().from(pharmacyBatches).where(and(eq(pharmacyBatches.hospitalId,h.id),eq(pharmacyBatches.medicineId,v.medicineId),eq(pharmacyBatches.batchNo,v.batchNo))).for("update");
    if(old) {
      if(old.expiresOn !== v.expiresOn || old.unit !== v.unit || old.barcode !== v.barcode || (v.reorderThreshold !== undefined && (old.reorderThreshold === null || stockUnits(old.reorderThreshold) !== stockUnits(v.reorderThreshold,old.quantityScale)))) throw new DomainError("CONFLICT","Existing batch identity, unit, expiry or threshold differs; omit an unchanged batch threshold on later receipts");
      const receivedQuantity=stockUnits(v.quantity,old.quantityScale);
      // Physical source: immutable hospital/medicine/batch + qualified book/vendor/document/line reference.
      // It is independent of staff/request/price. Replaying history adds no stock, movement or audit.
      const [source]=await tx.select().from(pharmacyMovements).where(and(eq(pharmacyMovements.batchId,old.id),eq(pharmacyMovements.kind,"RECEIPT"),eq(pharmacyMovements.reference,v.reference)));
      if(source) {
        if(stockUnits(source.quantity)!==receivedQuantity) throw new DomainError("CONFLICT","This physical receipt source already has a different quantity");
        return {id:old.id};
      }
    }
    const rate = await resolveBillableRate(tx,{ itemId:v.medicineId,eventKind:"medicine",unit:v.unit,quantity:v.quantity });
    if (rate.version.hospitalId !== h.id) throw new DomainError("FORBIDDEN","Catalogue belongs to another hospital");
    if (v.expiresOn < hospitalDate(new Date(),h.timezone)) throw new DomainError("PRECONDITION","Expired stock requires the hospital's quarantine process");
    if (v.reorderThreshold !== undefined) stockUnits(v.reorderThreshold,rate.policy.quantityScale);
    if(old) {
      const [identity] = await tx.select().from(settingVersions).where(eq(settingVersions.id,old.catalogVersionId));
      if(identity.payload.name!==rate.policy.name) throw new DomainError("PRECONDITION","Existing batch medicine identity differs from the current catalogue; receive a distinct batch and obtain Doctor review");
      if(old.quantityScale !== rate.policy.quantityScale) throw new DomainError("CONFLICT","Existing batch quantity scale differs from the current catalogue");
    }
    const batch = old ?? (await tx.insert(pharmacyBatches).values({ hospitalId:h.id, medicineId:v.medicineId,catalogVersionId:rate.version.id,batchNo:v.batchNo,expiresOn:v.expiresOn,unit:v.unit,quantityScale:rate.policy.quantityScale,barcode:v.barcode,reorderThreshold:v.reorderThreshold,signedBy:staff.id }).returning())[0];
    await tx.update(pharmacyBatches).set({ availableQuantity: sql`${pharmacyBatches.availableQuantity} + ${v.quantity}::numeric` }).where(eq(pharmacyBatches.id,batch.id));
    await tx.insert(pharmacyMovements).values({ batchId:batch.id,kind:"RECEIPT",quantity:v.quantity,reference:v.reference,signedBy:staff.id });
    await audit(tx,ctx,"stock-received",batch.id,v.reference);
    return { id:batch.id };
  });
}
const issueInput = z.strictObject({ admissionId:z.uuid(),orderId:z.uuid(),batchId:z.uuid(),quantity,unit:label,barcode:barcode.optional(),requestId:z.uuid() });
export async function issueMedicine(ctx: CommandContext, input: unknown) { return withTransaction(tx => issueMedicineInTransaction(tx,ctx,input)); }
export async function issueMedicineInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const v = issueInput.parse(input); requestKey(ctx,v.requestId);
  const staff = await operator(tx,ctx);
  return billingRequest(tx,ctx,"pharmacy.issue",v,async () => {
    const e = await episode(tx,v.admissionId);
    const [batch] = await batches(tx,[v.batchId]);
    return issue(tx,ctx,staff.id,e.hospitalId,v,batch,"WARD");
  });
}
async function issue(tx: Transaction, ctx: CommandContext, staffId: string, hospitalId: string, v: z.infer<typeof issueInput>, batch: typeof pharmacyBatches.$inferSelect, purpose:"WARD"|"TAKE_HOME") {
  const order = await medicineOrder(tx,v.admissionId,v.orderId);
  if ((purpose === "WARD" && order.details.medicationPurpose === "TAKE_HOME") || (purpose === "TAKE_HOME" && order.details.medicationPurpose === "WARD")) throw new DomainError("VALIDATION","Medicine order purpose does not match this stock issue");
  const [identity] = await tx.select().from(settingVersions).where(eq(settingVersions.id,order.medicineCatalogVersionId!));
  const original = itemPolicyInput.parse(identity.payload);
  const [batchIdentity] = await tx.select().from(settingVersions).where(eq(settingVersions.id,batch.catalogVersionId));
  if (batchIdentity.payload.name !== original.name) throw new DomainError("PRECONDITION","Batch medicine identity changed; Doctor review required, no substitution");
  if (batch.medicineId !== order.medicineItemId || batch.unit !== v.unit || original.unit !== v.unit || original.quantityScale !== batch.quantityScale || (v.barcode && v.barcode !== batch.barcode)) throw new DomainError("VALIDATION","Medicine identity, exact unit or scanned batch barcode differs from the Doctor order");
  await availableBatch(tx,batch,hospitalId);
  const q = stockUnits(v.quantity,batch.quantityScale);
  if (q > stockUnits(batch.availableQuantity)) throw new DomainError("PRECONDITION","Insufficient batch stock");
  // Resolve current price only after admission/batch ownership. Catalogue changes serialize through operator's shared lock.
  const rate = await resolveBillableRate(tx,{ itemId:order.medicineItemId!,eventKind:"medicine",unit:v.unit,quantity:v.quantity });
  if (rate.policy.name !== original.name) throw new DomainError("PRECONDITION","Current catalogue identity changed; Doctor must review and replace the order");
  if (rate.policy.quantityScale !== batch.quantityScale) throw new DomainError("PRECONDITION","Stock scale changed; explicit catalogue and stock reconciliation required");
  const id = crypto.randomUUID();
  const charge = await postChargeInTransaction(tx,ctx,{ admissionId:v.admissionId,sourceEventId:id,category:"medicine",itemId:order.medicineItemId,quantity:v.quantity,unit:v.unit,tariffVersionId:rate.version.id,status:"FINAL" },rate);
  await tx.update(pharmacyBatches).set({ availableQuantity:sql`${pharmacyBatches.availableQuantity} - ${v.quantity}::numeric` }).where(eq(pharmacyBatches.id,batch.id));
  await tx.insert(pharmacyMovements).values({ id,batchId:batch.id,admissionId:v.admissionId,orderId:order.id,kind:"ISSUE",purpose,quantity:`-${v.quantity}`,chargeId:charge.id,reference:`${purpose} issue against signed Doctor order`,signedBy:staffId });
  batch.availableQuantity = stockQuantity(stockUnits(batch.availableQuantity)-q);
  await audit(tx,ctx,"medicine-issued",id,`${purpose} stock issue; nursing administration is a separate factual record`);
  return { id };
}
const returnInput = z.strictObject({ issueId:z.uuid(),quantity,reason,requestId:z.uuid() });
export async function returnMedicine(ctx: CommandContext, input: unknown) { return withTransaction(tx => returnMedicineInTransaction(tx,ctx,input)); }
export async function returnMedicineInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const v = returnInput.parse(input); requestKey(ctx,v.requestId);
  const staff = await operator(tx,ctx);
  return billingRequest(tx,ctx,"pharmacy.return",v,async () => {
    const [source] = await tx.select().from(pharmacyMovements).where(eq(pharmacyMovements.id,v.issueId));
    if (!source || source.kind !== "ISSUE" || !source.admissionId) throw new DomainError("FORBIDDEN","Return requires an actual persisted pharmacy issue");
    await episode(tx,source.admissionId);
    const [batch] = await batches(tx,[source.batchId]);
    const [issued] = await tx.select().from(pharmacyMovements).where(eq(pharmacyMovements.id,v.issueId));
    const returns = await tx.select().from(pharmacyMovements).where(eq(pharmacyMovements.originalIssueId,issued.id));
    const prior = returns.reduce((n,r)=> n+stockUnits(r.quantity),0n);
    const q = stockUnits(v.quantity,batch.quantityScale), originalQ = stockUnits(issued.quantity.slice(1));
    if (prior+q > originalQ) throw new DomainError("PRECONDITION","Return exceeds the net quantity of this original issue");
    const [charge] = await tx.select().from(charges).where(eq(charges.id,issued.chargeId!));
    if (!charge || charge.sourceEventId !== issued.id || charge.admissionId !== issued.admissionId || charge.category !== "medicine" || charge.itemId !== batch.medicineId || charge.unit !== batch.unit || stockUnits(charge.quantity) !== originalQ) throw new DomainError("CONFLICT","Original pharmacy charge/source linkage is inconsistent");
    const oldReversals = await tx.select().from(chargeReversals).where(eq(chargeReversals.chargeId,charge.id));
    const previousReturnMoney = oldReversals.filter(r=> returns.some(m=>m.reversalId===r.id)).reduce((n,r)=> n+r.amountPaise,0n);
    // Cumulative original-price rounding gives exactly the original total at full return, even in tiny fractional lots.
    const cumulative = quantityAmount(charge.ratePaise,stockQuantity(prior+q),batch.quantityScale);
    const amount = (cumulative > charge.amountPaise ? charge.amountPaise : cumulative) - previousReturnMoney;
    if (amount < 0n || oldReversals.reduce((n,r)=>n+r.amountPaise,0n)+amount > charge.amountPaise) throw new DomainError("PRECONDITION","Existing financial adjustment requires Billing reconciliation before this return");
    const reversal = amount > 0n ? (await tx.insert(chargeReversals).values({ chargeId:charge.id,amountPaise:amount,reason:v.reason,...actorColumns(ctx) }).returning())[0] : undefined;
    const [movement] = await tx.insert(pharmacyMovements).values({ batchId:batch.id,admissionId:issued.admissionId,orderId:issued.orderId,kind:"RETURN",purpose:issued.purpose,quantity:v.quantity,originalIssueId:issued.id,chargeId:charge.id,reversalId:reversal?.id,reference:v.reason,signedBy:staff.id }).returning();
    await tx.update(pharmacyBatches).set({ availableQuantity:sql`${pharmacyBatches.availableQuantity} + ${v.quantity}::numeric` }).where(eq(pharmacyBatches.id,batch.id));
    await bumpBillRevision(tx,issued.admissionId!);
    await audit(tx,ctx,"medicine-returned",movement.id,v.reason);
    return { id:movement.id };
  });
}
const adjustmentInput = z.strictObject({ batchId:z.uuid(),quantity,direction:z.enum(["INCREASE","DECREASE"]),reason,requestId:z.uuid() });
export async function adjustStock(ctx: CommandContext, input: unknown) {
  const v = adjustmentInput.parse(input); requestKey(ctx,v.requestId);
  return withTransaction(async tx => {
    const staff = await operator(tx,ctx,true);
    return billingRequest(tx,ctx,"pharmacy.adjustment",v,async ()=> {
      const [batch] = await batches(tx,[v.batchId]);
      const q = stockUnits(v.quantity,batch.quantityScale)*(v.direction === "DECREASE" ? -1n : 1n);
      if (stockUnits(batch.availableQuantity)+q < 0n) throw new DomainError("PRECONDITION","Adjustment would make stock negative");
      const [m] = await tx.insert(pharmacyMovements).values({ batchId:batch.id,kind:"ADJUSTMENT",quantity:stockQuantity(q),reference:v.reason,signedBy:staff.id }).returning();
      await tx.update(pharmacyBatches).set({ availableQuantity:sql`${pharmacyBatches.availableQuantity}+${stockQuantity(q)}::numeric` }).where(eq(pharmacyBatches.id,batch.id));
      await audit(tx,ctx,"stock-adjusted",m.id,v.reason);
      return { id:m.id };
    });
  });
}
const preparationInput = z.strictObject({ admissionId:z.uuid(),prescriptionVersionId:z.uuid(),items:z.array(z.strictObject({orderId:z.uuid(),batchId:z.uuid(),quantity,unit:label,barcode:barcode.optional()})).max(100),requestId:z.uuid() });
export async function prepareTakeHomeMedicines(ctx: CommandContext, input: unknown) { return withTransaction(tx=>prepareTakeHomeMedicinesInTransaction(tx,ctx,input)); }
export async function prepareTakeHomeMedicinesInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const v = preparationInput.parse(input); requestKey(ctx,v.requestId);
  const staff = await operator(tx,ctx);
  return billingRequest(tx,ctx,"pharmacy.prepare",v,async ()=> {
    const e = await episode(tx,v.admissionId);
    const [rx] = await tx.select().from(clinicalSummaries).where(eq(clinicalSummaries.admissionId,e.id)).orderBy(desc(clinicalSummaries.version)).limit(1);
    if (!rx || rx.id !== v.prescriptionVersionId) throw new DomainError("CONFLICT","Review the latest signed prescription version");
    if (new Set(v.items.map(i=>i.orderId)).size !== v.items.length || v.items.length !== rx.prescription.length) throw new DomainError("VALIDATION","Preparation must match every signed prescription line exactly once");
    const selected = await batches(tx,v.items.map(i=>i.batchId));
    const oldIssues = await issuedReview(tx,e.id);
    if (oldIssues.some(i=>i.purpose === "TAKE_HOME" && stockUnits(i.netQuantity)>0n && !v.items.some(v=>v.orderId === i.orderId))) throw new DomainError("PRECONDITION","Return take-home medicines removed from the current prescription before re-preparing");
    const items: PreparedItem[] = [];
    for (const item of v.items) {
      const line = rx.prescription.find(p=>p.orderId === item.orderId);
      const order = await medicineOrder(tx,e.id,item.orderId);
      if (!line || line.medicineIdentityState !== "CONFIGURED" || line.medicineId !== order.medicineItemId || line.medicineCatalogVersionId !== order.medicineCatalogVersionId || line.dispensingUnit !== item.unit || stockUnits(line.dispensingQuantity) !== stockUnits(item.quantity) || order.details.dispensingUnit !== item.unit || stockUnits(order.details.dispensingQuantity!) !== stockUnits(item.quantity)) throw new DomainError("VALIDATION","Signed prescription identity, dispensing quantity or exact unit differs");
      const batch = selected.find(b=>b.id === item.batchId)!;
      await availableBatch(tx,batch,e.hospitalId);
      if (batch.medicineId !== line.medicineId || batch.unit !== item.unit || (item.barcode && item.barcode !== batch.barcode)) throw new DomainError("VALIDATION","Selected or scanned batch differs from prescription");
      stockUnits(item.quantity,batch.quantityScale);
      const existing = oldIssues.filter(i=>i.purpose === "TAKE_HOME" && i.orderId === item.orderId && stockUnits(i.netQuantity)>0n);
      if (existing.some(i=>i.batchId !== item.batchId)) throw new DomainError("PRECONDITION","Return previously prepared stock before choosing a different batch");
      const net = existing.reduce((n,i)=>n+stockUnits(i.netQuantity),0n), wanted=stockUnits(item.quantity);
      if (net>wanted) throw new DomainError("PRECONDITION","Return excess take-home medicine before preparing");
      const issueIds = existing.map(i=>i.id);
      if (net<wanted) issueIds.push((await issue(tx,ctx,staff.id,e.hospitalId,{ ...item,admissionId:e.id,quantity:stockQuantity(wanted-net),requestId:v.requestId },batch,"TAKE_HOME")).id);
      items.push({ orderId:item.orderId,batchId:item.batchId,quantity:stockQuantity(wanted),unit:item.unit,issueIds });
    }
    const [previous] = await tx.select({version:pharmacyPreparations.version}).from(pharmacyPreparations).where(eq(pharmacyPreparations.admissionId,e.id)).orderBy(desc(pharmacyPreparations.version)).limit(1);
    const [prepared] = await tx.insert(pharmacyPreparations).values({ admissionId:e.id,version:(previous?.version ?? 0)+1,prescriptionVersionId:rx.id,items,signedBy:staff.id }).returning();
    await audit(tx,ctx,"take-home-prepared",prepared.id,"Stock issued against current signed prescription; collection and professional seal remain separate");
    return { id:prepared.id };
  });
}
async function issuedReview(tx: Transaction, admissionId: string) {
  const movements = await tx.select().from(pharmacyMovements).where(eq(pharmacyMovements.admissionId,admissionId));
  return movements.filter(m=>m.kind === "ISSUE").map(m=> {
    const returned = movements.filter(r=>r.originalIssueId === m.id).reduce((n,r)=>n+stockUnits(r.quantity),0n);
    return { ...m,quantity:stockQuantity(stockUnits(m.quantity.slice(1))),returnedQuantity:stockQuantity(returned),netQuantity:stockQuantity(stockUnits(m.quantity.slice(1))-returned) };
  });
}
export async function getPharmacyReview(ctx: CommandContext, admissionId: string) { return withTransaction(tx=>getPharmacyReviewInTransaction(tx,ctx,admissionId)); }
export async function getPharmacyReviewInTransaction(tx: Transaction, ctx: CommandContext, admissionId: string) {
  await operator(tx,ctx);
  const e = await episode(tx,z.uuid().parse(admissionId),false);
  return pharmacyClearanceSourceInTransaction(tx, e);
}
/** Internal clearance composition: admission is locked and caller enforces the purpose-specific role.
 * This also supports an explicit empty prescription without granting a general no-order Pharmacy chart. */
export async function pharmacyClearanceSourceInTransaction(tx: Transaction, e: typeof admissions.$inferSelect) {
  const [p] = await tx.select({name:patients.name,uhid:patients.uhid,sex:patients.sex}).from(patients).where(eq(patients.id,e.patientId));
  const [bed] = await tx.select({label:beds.label}).from(beds).where(eq(beds.id,e.bedId));
  const orders = await tx.select({id:clinicalOrders.id,requestedItem:clinicalOrders.requestedItem,medicineItemId:clinicalOrders.medicineItemId,medicineCatalogVersionId:clinicalOrders.medicineCatalogVersionId,details:clinicalOrders.details,signedBy:clinicalOrders.signedBy,signedAt:clinicalOrders.signedAt}).from(clinicalOrders).where(and(eq(clinicalOrders.admissionId,e.id),eq(clinicalOrders.kind,"MEDICINE")));
  const stops = orders.length ? await tx.select().from(clinicalTaskEvents).where(and(inArray(clinicalTaskEvents.orderId,orders.map(o=>o.id)),eq(clinicalTaskEvents.status,"STOPPED"))) : [];
  const [rx] = await tx.select({id:clinicalSummaries.id,version:clinicalSummaries.version,prescription:clinicalSummaries.prescription,signedBy:clinicalSummaries.signedBy,signedAt:clinicalSummaries.signedAt}).from(clinicalSummaries).where(eq(clinicalSummaries.admissionId,e.id)).orderBy(desc(clinicalSummaries.version)).limit(1);
  const preparations = await tx.select().from(pharmacyPreparations).where(eq(pharmacyPreparations.admissionId,e.id)).orderBy(desc(pharmacyPreparations.version));
  const issues = await issuedReview(tx,e.id);
  const unresolved: string[] = [];
  for (const i of issues) {
    const [charge] = await tx.select().from(charges).where(eq(charges.id,i.chargeId!));
    const reversals = await tx.select().from(chargeReversals).where(eq(chargeReversals.chargeId,i.chargeId!));
    const [batch] = await tx.select().from(pharmacyBatches).where(eq(pharmacyBatches.id,i.batchId));
    const returnedMoney = stockUnits(i.returnedQuantity)>0n ? quantityAmount(charge.ratePaise,i.returnedQuantity,batch.quantityScale) : 0n;
    const expected = returnedMoney>charge.amountPaise ? charge.amountPaise : returnedMoney;
    if (reversals.reduce((n,r)=>n+r.amountPaise,0n)!==expected) unresolved.push(`${i.purpose} issue ${i.id}: stock returns and original-charge adjustments require Billing reconciliation`);
  }
  for (const o of orders.filter(o=>!stops.some(s=>s.orderId===o.id))) {
    if (o.details.medicationPurpose !== "TAKE_HOME" && !issues.some(i=>i.orderId===o.id && i.purpose==="WARD")) unresolved.push(`${o.requestedItem}: ward order awaits an explicit stock issue or Doctor review`);
    if (!o.medicineItemId) unresolved.push(`${o.requestedItem}: Doctor identity resolution required`);
    else {
      const [identity] = await tx.select().from(settingVersions).where(eq(settingVersions.id,o.medicineCatalogVersionId!));
      try {
        const rate=await resolveBillableRate(tx,{itemId:o.medicineItemId,eventKind:"medicine",unit:o.details.dispensingUnit ?? String(identity.payload.unit),quantity:"1"});
        if(rate.policy.name!==identity.payload.name) unresolved.push(`${o.requestedItem}: catalogue medicine identity changed; Doctor review required`);
      }
      catch (error) {
        if (!(error instanceof DomainError) && !(error instanceof z.ZodError)) throw error;
        unresolved.push(`${o.requestedItem}: active medicine catalogue, exact unit and price require review`);
      }
    }
  }
  const current = preparations[0];
  if (!rx) unresolved.push("Doctor has not signed a take-home prescription version");
  else {
    if ((orders.length || rx.prescription.length) && (!current || current.prescriptionVersionId !== rx.id)) unresolved.push("Current signed prescription needs take-home preparation");
    const h = await hospital(tx);
    for (const line of rx.prescription) {
      const net = issues.filter(i=>i.purpose === "TAKE_HOME" && i.orderId === line.orderId).reduce((n,i)=>n+stockUnits(i.netQuantity),0n);
      if (net !== stockUnits(line.dispensingQuantity) || stops.some(s=>s.orderId===line.orderId) || line.medicineIdentityState !== "CONFIGURED") unresolved.push(`${line.requestedItem}: current prescription and net issued stock require reconciliation`);
      const prep = current?.items.find(i=>i.orderId === line.orderId);
      if (prep) {
        const [batch] = await tx.select().from(pharmacyBatches).where(eq(pharmacyBatches.id,prep.batchId));
        if (batch.expiresOn < hospitalDate(new Date(),h.timezone)) unresolved.push(`${line.requestedItem}: prepared batch expired; return and replace before collection`);
      }
    }
    for (const i of issues.filter(i=>i.purpose === "TAKE_HOME" && stockUnits(i.netQuantity)>0n)) {
      if (!rx.prescription.some(p=>p.orderId===i.orderId)) unresolved.push("Previously issued take-home medicine is absent from the current prescription; return/review required");
      const [batch]=await tx.select().from(pharmacyBatches).where(eq(pharmacyBatches.id,i.batchId));
      if(batch.expiresOn<hospitalDate(new Date(),h.timezone))unresolved.push(`Take-home issue ${i.id}: retained batch expired; return and replace before collection`);
    }
  }
  return { episode:{id:e.id,ipCode:e.ipCode,status:e.status,bedLabel:bed.label,...p},orders:orders.map(o=>({...o,stopped:stops.some(s=>s.orderId===o.id)})),prescription:rx,preparations,issues,unresolved:[...new Set(unresolved)],prepared:unresolved.length===0,sealRecorded:false as const };
}
export async function pharmacyWorkspace(ctx: CommandContext) {
  return withTransaction(async tx=> {
    await operator(tx,ctx);
    const [h] = await tx.select().from(hospitalSettings).limit(1);
    if(!h) return {configured:false,episodes:[],medicines:[],doctors:[],stock:[]};
    const rows = await tx.select({id:admissions.id,ipCode:admissions.ipCode,name:patients.name,bedLabel:beds.label}).from(admissions).innerJoin(patients,eq(patients.id,admissions.patientId)).innerJoin(beds,eq(beds.id,admissions.bedId)).innerJoin(clinicalOrders,eq(clinicalOrders.admissionId,admissions.id)).where(and(eq(admissions.status,"ADMITTED"),eq(clinicalOrders.kind,"MEDICINE"))).orderBy(asc(admissions.ipCode));
    const stock = await tx.select().from(pharmacyBatches).where(eq(pharmacyBatches.hospitalId,h.id)).orderBy(asc(pharmacyBatches.expiresOn));
    const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId,h.id)).orderBy(desc(settingVersions.version));
    const seen = new Set<string>();
    const medicines = versions.filter(v=> {
      if (v.payload.type!=="billable-item" || seen.has(String(v.payload.code))) return false;
      seen.add(String(v.payload.code));
      return v.payload.active===true && v.payload.category==="medicine" && v.payload.department==="PHARMACY";
    }).map(v=>({id:String(v.payload.code),name:String(v.payload.name),unit:String(v.payload.unit)}));
    const names = await tx.select({id:user.id,name:user.name}).from(user).where(eq(user.role,"DOCTOR"));
    return { configured:true,episodes:[...new Map(rows.map(r=>[r.id,r])).values()],medicines,doctors:names,stock:stock.map(b=>({...b,medicineName:String(versions.find(v=>v.id===b.catalogVersionId)!.payload.name),availableQuantity:stockQuantity(stockUnits(b.availableQuantity)),reorderThreshold:b.reorderThreshold===null ? null : stockQuantity(stockUnits(b.reorderThreshold)),expired:b.expiresOn<hospitalDate(new Date(),h.timezone),lowStock:b.reorderThreshold!==null && stockUnits(b.availableQuantity)<=stockUnits(b.reorderThreshold)})) };
  });
}
