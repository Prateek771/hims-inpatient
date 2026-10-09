import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/schema";
import type { Transaction } from "../../src/server/db";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
loadLocalEnvironment();
const appUrl = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = appUrl; vi.useRealTimers(); });
const runtimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticPharmacyOnlySecretAtLeast32Characters12345";

export async function pharmacyFixture(purpose: "BOTH"|"TAKE_HOME" = "BOTH") {
  const f = await billingFixture();
  const care = await import("../../src/server/clinical/commands");
  const { activateAdmission } = await import("../../src/server/admissions/commands");
  await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
  const policy = { type: "billable-item", code: "PHARM_MED", name: "Synthetic prescribed medicine", category: "medicine", department: "PHARMACY", unit: "tablet", quantityScale: 0, amount: "101", active: true };
  const price = await f.setting(policy);
  const a = await f.episode();
  const ac = f.deskCtx();
  const arrivedAt = new Date().toISOString();
  await activateAdmission(ac, { admissionId: a.admissionId, arrivedAt, expectedVersion: 1, requestId: ac.requestId });
  const dc = () => staffContext(f.doctor, "synthetic-pharmacy-doctor");
  const pc = () => staffContext(f.pharmacy, "synthetic-pharmacy");
  const c = dc();
  await care.recordRound(c, { admissionId: a.admissionId, notes: "Synthetic medicine order", orders: [{ kind: "MEDICINE", requestedItem: policy.name, itemId: policy.code, dose: "5", doseUnit: "mg", route: "oral", frequency: "explicit schedule", durationDays: 1, medicationPurpose: purpose, dispensingQuantity: "4", dispensingUnit: "tablet", ...(purpose==="BOTH" ? {schedule: { startsAt: arrivedAt, intervalMinutes: 60, occurrences: 2 }} : {}) }], requestId: c.requestId });
  const order = (await care.getCare(dc(), a.admissionId)).orders[0];
  const summary = await care.signClinicalSummary(dc(), { admissionId: a.admissionId, expectedVersion: 0, diagnosis: "Synthetic diagnosis", course: "Synthetic course", condition: "Stable", followUp: "Synthetic follow up", advice: "Synthetic advice", prescriptionOrderIds: [order.id] });
  return { ...f, ...a, dc, pc, order, summary, arrivedAt, price, policy };
}
async function race(first: (tx: Transaction)=>Promise<unknown>, second: (tx: Transaction)=>Promise<unknown>) {
  const a = new Client({connectionString:runtimeUrl}), b = new Client({connectionString:runtimeUrl});
  await Promise.all([a.connect(),b.connect()]);
  const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  expect(pidA).not.toBe(pidB);
  let release!:()=>void, ready!:()=>void, failReady!:(e:unknown)=>void;
  const held = new Promise<void>(r=>{release=r;});
  const reached = new Promise<void>((r,j)=>{ready=r;failReady=j;});
  let left:Promise<unknown>|undefined,right:Promise<unknown>|undefined;
  try {
    left = drizzle(a,{schema}).transaction(async tx=> {const result=await first(tx);ready();await held;return result;});
    void left.catch(failReady); await reached;
    right = drizzle(b,{schema}).transaction(second); void right.catch(()=>{});
    let blocked=false;
    for(let n=0;n<100 && !blocked;n++) {
      blocked=(await a.query("SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked",[pidA,pidB])).rows[0].blocked;
      if(!blocked) await new Promise(r=>setTimeout(r,10));
    }
    expect(blocked).toBe(true); release();
    return await Promise.allSettled([left,right]);
  } finally { release();await Promise.all([left?.catch(()=>{}),right?.catch(()=>{})]);await Promise.all([a.end(),b.end()]); }
}
describe("pharmacy stock and money on actual PostgreSQL", () => {
  it("deduplicates a physical receipt across fresh keys while distinct qualified delivery lines remain valid",async()=> {
    await withTestDatabase(async({runtime})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture(),p=await import("../../src/server/pharmacy/commands");
      const c=f.pc();
      const details={medicineId:f.policy.code,batchNo:"SOURCE-BATCH",expiresOn:"2099-12-31",quantity:"7",unit:"tablet",barcode:"SYNTH-SOURCE-BATCH",reference:"VendorA/stock-book-2026/INV42/line1",requestId:c.requestId};
      const original=await p.recordStockReceipt(c,details);
      const fresh=f.pc();expect(await p.recordStockReceipt(fresh,{...details,quantity:"07",requestId:fresh.requestId})).toEqual(original);
      const whitespace=f.pc();expect(await p.recordStockReceipt(whitespace,{...details,reference:` \t${details.reference}\u00a0`,requestId:whitespace.requestId})).toEqual(original);
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[original.id])).rows[0].available_quantity).toBe("7.000000");
      const changed=f.pc();await expect(p.recordStockReceipt(changed,{...details,quantity:"3",requestId:changed.requestId})).rejects.toMatchObject({code:"CONFLICT"});
      for(const fields of [{unit:"strip"},{barcode:"DIFFERENT-BARCODE"},{expiresOn:"2099-12-30"}]) {const ctx=f.pc();await expect(p.recordStockReceipt(ctx,{...details,...fields,requestId:ctx.requestId})).rejects.toMatchObject({code:"CONFLICT"});}
      for(const reference of [details.reference,"VendorA/stock-book-2026/INV44/line1"]) {const ctx=f.pc();await expect(p.recordStockReceipt(ctx,{...details,reference,reorderThreshold:"0",requestId:ctx.requestId})).rejects.toMatchObject({code:"CONFLICT"});}
      await f.setting({...f.policy,amount:"999"});
      const admin=staffContext(f.admin,"synthetic-delivery-handoff");expect(await p.recordStockReceipt(admin,{...details,requestId:admin.requestId})).toEqual(original);
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.pharmacy_movements WHERE kind='RECEIPT' AND batch_id=$1",[original.id])).rows[0].count).toBe(1);
      expect((await runtime.query("SELECT signed_by FROM hims.pharmacy_movements WHERE kind='RECEIPT' AND batch_id=$1",[original.id])).rows[0].signed_by).toBe(f.pharmacy.id);
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.audit_events WHERE event='pharmacy.stock-received' AND entity_id=$1",[original.id])).rows[0].count).toBe(1);
      for(const [reference,quantity] of [["VendorA/stock-book-2026/INV43/line1","3"],["VendorA/stock-book-2026/INV42/line2","4"],["VendorB/stock-book-2026/INV42/line1","2"]]) {const ctx=f.pc();await p.recordStockReceipt(ctx,{...details,reference,quantity,requestId:ctx.requestId});}
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[original.id])).rows[0].available_quantity).toBe("16.000000");
      const other=f.pc();await p.recordStockReceipt(other,{...details,batchNo:"SECOND-SOURCE-BATCH",barcode:"SYNTH-SOURCE-BATCH-SECOND",quantity:"2",requestId:other.requestId});
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.pharmacy_movements WHERE kind='RECEIPT' AND reference=$1",[details.reference])).rows[0].count).toBe(2);
      await f.setting({...f.policy,active:false});
      const historical=f.pc();expect(await p.recordStockReceipt(historical,{...details,requestId:historical.requestId})).toEqual(original);
      await runtime.query("UPDATE hims.staff_user SET banned=true WHERE id=$1",[f.pharmacy.id]);
      const revoked=f.pc();await expect(p.recordStockReceipt(revoked,{...details,requestId:revoked.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
    });
  });
  it("serializes two staff entering one receipt source and rejects native duplicates without repairing legacy history",async()=> {
    await withTestDatabase(async({runtime,owner})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture(),p=await import("../../src/server/pharmacy/commands");
      const first=f.pc(),second=staffContext(f.admin,"synthetic-source-second-actor");
      expect(first.actor).not.toEqual(second.actor);
      const details={medicineId:f.policy.code,batchNo:"CONCURRENT-RECEIPT",expiresOn:"2099-12-31",quantity:"7",unit:"tablet",barcode:"SYNTH-CONCURRENT-RECEIPT",reference:"StockDeskBook2026/delivery8/line1"};
      const entered=await race(tx=>p.recordStockReceiptInTransaction(tx,first,{...details,reorderThreshold:"5",requestId:first.requestId}),tx=>p.recordStockReceiptInTransaction(tx,second,{...details,requestId:second.requestId}));
      expect(entered[0]).toEqual(entered[1]);expect(entered[0].status).toBe("fulfilled");
      const batchId=(entered[0] as PromiseFulfilledResult<{id:string}>).value.id;
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[batchId])).rows[0].available_quantity).toBe("7.000000");
      expect((await runtime.query("SELECT reorder_threshold FROM hims.pharmacy_batches WHERE id=$1",[batchId])).rows[0].reorder_threshold).toBe("5.000000");
      const threshold=f.pc();await expect(p.recordStockReceipt(threshold,{...details,reorderThreshold:"6",requestId:threshold.requestId})).rejects.toMatchObject({code:"CONFLICT"});
      const a=f.pc(),b=staffContext(f.admin,"synthetic-source-conflicting-handoff");
      const next={...details,reference:"StockDeskBook2026/delivery9/line1"};
      const conflicting=await race(tx=>p.recordStockReceiptInTransaction(tx,a,{...next,quantity:"2",requestId:a.requestId}),tx=>p.recordStockReceiptInTransaction(tx,b,{...next,quantity:"3",requestId:b.requestId}));
      expect(conflicting[0].status).toBe("fulfilled");expect(conflicting[1]).toMatchObject({status:"rejected",reason:{code:"CONFLICT"}});
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[batchId])).rows[0].available_quantity).toBe("9.000000");
      await expect(runtime.query("INSERT INTO hims.pharmacy_movements(batch_id,kind,quantity,reference,signed_by) VALUES($1,'RECEIPT',7,$2,$3)",[batchId,details.reference,f.pharmacy.id])).rejects.toMatchObject({code:"23505"});
      await expect(runtime.query("INSERT INTO hims.pharmacy_movements(batch_id,kind,quantity,reference,signed_by) VALUES($1,'RECEIPT',7,$2,$3)",[batchId,`\u00a0${details.reference} `,f.pharmacy.id])).rejects.toMatchObject({code:"23514"});
      const migration=await readFile(new URL("../../drizzle/0018_pharmacy_receipt_source.sql",import.meta.url),"utf8");
      try {
        await owner.query("BEGIN");
        await owner.query("DROP INDEX hims.pharmacy_receipt_source_once");
        await owner.query("INSERT INTO hims.pharmacy_movements(batch_id,kind,quantity,reference,signed_by) VALUES($1,'RECEIPT',7,$2,$3)",[batchId,details.reference,f.pharmacy.id]);
        await owner.query("UPDATE hims.pharmacy_batches SET available_quantity=available_quantity+7 WHERE id=$1",[batchId]);
        await owner.query("SET CONSTRAINTS ALL IMMEDIATE");
        await expect(owner.query(migration)).rejects.toMatchObject({code:"P0001",message:expect.stringContaining("Duplicate physical pharmacy receipt sources")});
      } finally {await owner.query("ROLLBACK");}
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[batchId])).rows[0].available_quantity).toBe("9.000000");
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.pharmacy_movements WHERE batch_id=$1",[batchId])).rows[0].count).toBe(2);
      await expect(runtime.query("INSERT INTO hims.pharmacy_movements(batch_id,kind,quantity,reference,signed_by) VALUES($1,'RECEIPT',7,$2,$3)",[batchId,details.reference,f.pharmacy.id])).rejects.toMatchObject({code:"23505"});
    });
  });
  it("shows an empty worklist awaiting hospital configuration",async()=> {
    await withTestDatabase(async()=> {
      process.env.DATABASE_URL=runtimeUrl;
      const {bootstrapAdmin}=await import("../../src/server/staff"),{getAuth}=await import("../../src/server/auth"),{requireStaff}=await import("../../src/server/access"),p=await import("../../src/server/pharmacy/commands");
      await bootstrapAdmin({name:"Synthetic unconfigured admin",email:"unconfigured@pharmacy.invalid",password:"SyntheticPharmacyOnly123!",role:"ADMIN",reason:"Synthetic bare configuration test"});
      const login=await getAuth().api.signInEmail({asResponse:true,body:{email:"unconfigured@pharmacy.invalid",password:"SyntheticPharmacyOnly123!"}});expect(login.ok).toBe(true);
      const current=await requireStaff(new Headers({cookie:login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")}));
      expect(await p.pharmacyWorkspace(staffContext(current,"synthetic-empty-pharmacy"))).toMatchObject({configured:false,episodes:[],stock:[],medicines:[]});
    });
  });
  it("issues stock against actual doctor identity, retries once and returns at original price", async () => {
    await withTestDatabase(async ({ runtime }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const f = await pharmacyFixture();
      const pharmacy = await import("../../src/server/pharmacy/commands");
      const c = f.pc();
      const stockInput = { medicineId: f.policy.code, batchNo: "SYNTHETIC-01", expiresOn: "2099-12-31", quantity: "10", unit: "tablet", barcode: "SYNTHETIC-BATCH-01", reference: "Synthetic receipt", requestId: c.requestId };
      const batch = await pharmacy.recordStockReceipt(c, stockInput);
      expect(await pharmacy.recordStockReceipt(c, stockInput)).toEqual(batch);
      const issueContext = f.pc();
      const input = { admissionId: f.admissionId, orderId: f.order.id, batchId: batch.id, quantity: "3", unit: "tablet", barcode: stockInput.barcode, requestId: issueContext.requestId };
      const issued = await pharmacy.issueMedicine(issueContext, input);
      expect(await pharmacy.issueMedicine(issueContext, input)).toEqual(issued);
      await expect(pharmacy.issueMedicine(issueContext,{...input,quantity:"4"})).rejects.toMatchObject({code:"CONFLICT"});
      expect((await runtime.query("SELECT amount_paise FROM hims.charges WHERE source_event_id=$1", [issued.id])).rows).toEqual([{ amount_paise: "30300" }]);
      await f.setting({ ...f.policy, amount: "999" });
      const returnContext = f.pc();
      const returnInput = { issueId: issued.id, quantity: "1", reason: "Unused sealed medicine returned", requestId: returnContext.requestId };
      const returned = await pharmacy.returnMedicine(returnContext, returnInput);
      expect(await pharmacy.returnMedicine(returnContext, returnInput)).toEqual(returned);
      expect((await runtime.query("SELECT amount_paise FROM hims.charge_reversals")).rows).toEqual([{ amount_paise: "10100" }]);
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1", [batch.id])).rows[0].available_quantity).toBe("8.000000");
      const transaction=await import("../../src/server/db"),rollback=f.pc();
      await expect(transaction.withTransaction(async tx=>{await pharmacy.returnMedicineInTransaction(tx,rollback,{...returnInput,quantity:"2",requestId:rollback.requestId});throw new Error("Synthetic return failure after reversal and stock");})).rejects.toThrow("Synthetic return failure");
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[batch.id])).rows[0].available_quantity).toBe("8.000000");
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.charge_reversals")).rows[0].count).toBe(1);
      const excess=f.pc();
      await expect(pharmacy.returnMedicine(excess, { ...returnInput, quantity: "3", requestId: excess.requestId })).rejects.toMatchObject({code:"PRECONDITION"});
      const review = await pharmacy.getPharmacyReview(f.pc(), f.admissionId);
      expect(review.issues).toHaveLength(1);
      expect(review.issues[0].quantity).toBe("3");
      expect(review.issues[0].returnedQuantity).toBe("1");
      expect(review).not.toHaveProperty("clinicalNotes");
      await expect(pharmacy.getPharmacyReview(f.ctx(), f.admissionId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const repriced=f.pc();expect(await pharmacy.recordStockReceipt(repriced,{...stockInput,quantity:"1",reference:"Separate delivery at changed price only",requestId:repriced.requestId})).toEqual(batch);
      const nursing = await import("../../src/server/nursing/commands");
      await nursing.assignNurse(staffContext(f.admin,"synthetic-assign"),{admissionId:f.admissionId,nurseId:f.nurse.id,authority:"Synthetic assignment",reason:"Ward care"});
      const nc=()=>staffContext(f.nurse,"synthetic-mar");
      const shiftContext=nc();
      const shift=await nursing.recordShift(shiftContext,{admissionId:f.admissionId,startedAt:f.arrivedAt,handover:"Synthetic attendance",requestId:shiftContext.requestId});
      const mc=nc();
      await nursing.recordAdministration(mc,{orderId:f.order.id,shiftId:shift.id,scheduledAt:f.arrivedAt,actualAt:new Date().toISOString(),actualDose:"5",doseUnit:"mg",outcome:"GIVEN",reason:"Given as prescribed",requestId:mc.requestId});
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.charges WHERE category='medicine'")).rows[0].count).toBe(1);
    });
  });
  it("serializes oversell and excess-return races on distinct PostgreSQL backends",async()=> {
    await withTestDatabase(async({runtime})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture(), p=await import("../../src/server/pharmacy/commands");
      const c=f.pc();
      const batch=await p.recordStockReceipt(c,{medicineId:f.policy.code,batchNo:"RACE",expiresOn:"2099-12-31",quantity:"5",unit:"tablet",barcode:"SYNTH-RACE",reference:"Synthetic stock",requestId:c.requestId});
      const secondEpisode=await f.episode();
      const admissions=await import("../../src/server/admissions/commands"),care=await import("../../src/server/clinical/commands");
      const activate=f.deskCtx();await admissions.activateAdmission(activate,{admissionId:secondEpisode.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:activate.requestId});
      const doctor=f.dc();await care.recordRound(doctor,{admissionId:secondEpisode.admissionId,notes:"Independent episode medicine",orders:[{...f.order.details,schedule:{...f.order.details.schedule!,startsAt:new Date().toISOString()}}],requestId:doctor.requestId});
      const secondOrder=(await care.getCare(f.dc(),secondEpisode.admissionId)).orders[0];
      const input=(ctx:ReturnType<typeof f.pc>)=>({admissionId:f.admissionId,orderId:f.order.id,batchId:batch.id,quantity:"4",unit:"tablet",requestId:ctx.requestId});
      const a=f.pc(),b=f.pc();
      const issued=await race(tx=>p.issueMedicineInTransaction(tx,a,input(a)),tx=>p.issueMedicineInTransaction(tx,b,{...input(b),admissionId:secondEpisode.admissionId,orderId:secondOrder.id}));
      expect(issued[0].status).toBe("fulfilled");expect(issued[1]).toMatchObject({status:"rejected",reason:{code:"PRECONDITION"}});
      const id=(issued[0] as PromiseFulfilledResult<{id:string}>).value.id;
      const r1=f.pc(),r2=f.pc();
      const returns=await race(tx=>p.returnMedicineInTransaction(tx,r1,{issueId:id,quantity:"3",reason:"Unused medicines",requestId:r1.requestId}),tx=>p.returnMedicineInTransaction(tx,r2,{issueId:id,quantity:"2",reason:"Other unused medicines",requestId:r2.requestId}));
      expect(returns[0].status).toBe("fulfilled");expect(returns[1]).toMatchObject({status:"rejected",reason:{code:"PRECONDITION"}});
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches WHERE id=$1",[batch.id])).rows[0].available_quantity).toBe("4.000000");
      const retry=f.pc();
      const retries=await race(tx=>p.issueMedicineInTransaction(tx,retry,input(retry)),tx=>p.issueMedicineInTransaction(tx,retry,input(retry)));
      expect(retries[0]).toEqual(retries[1]);
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.charges WHERE category='medicine'")).rows[0].count).toBe(2);
    });
  });
  it("prepares exact signed quantities once and exposes stale prescriptions, returns and stopped identity",async()=> {
    await withTestDatabase(async({runtime,owner})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture("TAKE_HOME"),p=await import("../../src/server/pharmacy/commands"),care=await import("../../src/server/clinical/commands");
      const c=f.pc(),batch=await p.recordStockReceipt(c,{medicineId:f.policy.code,batchNo:"HOME",expiresOn:"2099-12-31",quantity:"20",unit:"tablet",barcode:"SYNTH-HOME",reference:"Synthetic home stock",requestId:c.requestId});
      const pc=f.pc(),input={admissionId:f.admissionId,prescriptionVersionId:f.summary.id,items:[{orderId:f.order.id,batchId:batch.id,quantity:"4",unit:"tablet"}],requestId:pc.requestId};
      const wrong=f.pc();await expect(p.prepareTakeHomeMedicines(wrong,{...input,items:[{...input.items[0],quantity:"3"}],requestId:wrong.requestId})).rejects.toMatchObject({code:"VALIDATION"});
      const first=await p.prepareTakeHomeMedicines(pc,input);expect(await p.prepareTakeHomeMedicines(pc,input)).toEqual(first);
      const another=f.pc();await p.prepareTakeHomeMedicines(another,{...input,requestId:another.requestId});
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.charges WHERE category='medicine'")).rows[0].count).toBe(1);
      let review=await p.getPharmacyReview(f.pc(),f.admissionId);expect(review.prepared).toBe(true);expect(review.sealRecorded).toBe(false);expect(review.issues[0].purpose).toBe("TAKE_HOME");
      const rc=f.pc();await p.returnMedicine(rc,{issueId:review.issues[0].id,quantity:"1",reason:"Unused home medicine",requestId:rc.requestId});
      expect((await p.getPharmacyReview(f.pc(),f.admissionId)).prepared).toBe(false);
      const replenish=f.pc();await p.prepareTakeHomeMedicines(replenish,{...input,requestId:replenish.requestId});
      expect((await runtime.query("SELECT sum(amount_paise)::text AS amount FROM hims.charges WHERE category='medicine'")).rows[0].amount).toBe("50500");
      const summary2=await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:1,diagnosis:"Synthetic updated diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Follow up",advice:"Advice",prescriptionOrderIds:[f.order.id]});
      const stale=f.pc();await expect(p.prepareTakeHomeMedicines(stale,{...input,requestId:stale.requestId})).rejects.toMatchObject({code:"CONFLICT"});
      expect((await p.getPharmacyReview(f.pc(),f.admissionId)).prepared).toBe(false);
      const latest=f.pc();await p.prepareTakeHomeMedicines(latest,{...input,prescriptionVersionId:summary2.id,requestId:latest.requestId});
      expect((await p.getPharmacyReview(f.pc(),f.admissionId)).prepared).toBe(true);
      await care.stopClinicalOrder(f.dc(),{orderId:f.order.id,reason:"Doctor stopped prescribed medicine"});
      review=await p.getPharmacyReview(f.pc(),f.admissionId);expect(review.prepared).toBe(false);
      const stopped=f.pc();await expect(p.prepareTakeHomeMedicines(stopped,{...input,prescriptionVersionId:summary2.id,requestId:stopped.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      const empty=await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:2,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Follow up",advice:"Advice",prescriptionOrderIds:[]});
      const removed=f.pc();await expect(p.prepareTakeHomeMedicines(removed,{...input,prescriptionVersionId:empty.id,items:[],requestId:removed.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      await expect(owner.query("UPDATE hims.pharmacy_preparations SET items='[]'")).rejects.toBeDefined();
      await expect(owner.query("DELETE FROM hims.pharmacy_movements")).rejects.toBeDefined();
    });
  });
  it("rejects wrong identity/unit/barcode, expires at hospital date and rolls stock/money back atomically",async()=> {
    await withTestDatabase(async({runtime,owner})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture(),p=await import("../../src/server/pharmacy/commands"),d=await import("../../src/server/db");
      const c=f.pc(),batch=await p.recordStockReceipt(c,{medicineId:f.policy.code,batchNo:"SAFE",expiresOn:"2099-12-31",quantity:"10",unit:"tablet",barcode:"SYNTH-SAFE",reorderThreshold:"8",reference:"Synthetic safe stock",requestId:c.requestId});
      const input=(ctx:ReturnType<typeof f.pc>)=>({admissionId:f.admissionId,orderId:f.order.id,batchId:batch.id,quantity:"3",unit:"tablet",requestId:ctx.requestId});
      for(const override of [{unit:"strip"},{barcode:"WRONG-BARCODE"},{quantity:"0.5"},{orderId:crypto.randomUUID()}]) {const ctx=f.pc();await expect(p.issueMedicine(ctx,{...input(ctx),...override})).rejects.toBeDefined();}
      const other=await f.episode(),ctx=f.pc();await expect(p.issueMedicine(ctx,{...input(ctx),admissionId:other.admissionId})).rejects.toMatchObject({code:"PRECONDITION"});
      const admissions=await import("../../src/server/admissions/commands"),care=await import("../../src/server/clinical/commands");
      const activation=f.deskCtx(),startedAt=new Date().toISOString();await admissions.activateAdmission(activation,{admissionId:other.admissionId,arrivedAt:startedAt,expectedVersion:1,requestId:activation.requestId});
      const round=f.dc();await care.recordRound(round,{admissionId:other.admissionId,notes:"Separate active episode order",orders:[{...f.order.details,schedule:{...f.order.details.schedule!,startsAt:startedAt}}],requestId:round.requestId});
      const wrongEpisode=f.pc();await expect(p.issueMedicine(wrongEpisode,{...input(wrongEpisode),admissionId:other.admissionId})).rejects.toMatchObject({code:"VALIDATION"});
      const unresolved=f.dc();await care.recordRound(unresolved,{admissionId:f.admissionId,notes:"Unconfigured medicine text must not authorize stock",orders:[{kind:"MEDICINE",requestedItem:f.policy.name,dose:"5",doseUnit:"mg",route:"oral",frequency:"Explicit schedule",durationDays:1,medicationPurpose:"WARD",schedule:{startsAt:new Date().toISOString(),intervalMinutes:60,occurrences:1}}],requestId:unresolved.requestId});
      const unresolvedOrder=(await care.getCare(f.dc(),f.admissionId)).orders.find(o=>o.medicineItemId===null)!;
      const guessed=f.pc();await expect(p.issueMedicine(guessed,{...input(guessed),orderId:unresolvedOrder.id})).rejects.toMatchObject({code:"PRECONDITION"});
      const rollback=f.pc();await expect(d.withTransaction(async tx=>{await p.issueMedicineInTransaction(tx,rollback,input(rollback));throw new Error("Synthetic failure after economic source");})).rejects.toThrow("Synthetic failure");
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.charges WHERE category='medicine'")).rows[0].count).toBe(0);
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches")).rows[0].available_quantity).toBe("10.000000");
      await f.setting({...f.policy,active:false});const inactive=f.pc();await expect(p.issueMedicine(inactive,input(inactive))).rejects.toMatchObject({code:"PRECONDITION"});
      await f.setting({...f.policy,amount:"202"});const actual=f.pc();const issued=await p.issueMedicine(actual,input(actual));
      expect((await runtime.query("SELECT amount_paise FROM hims.charges WHERE source_event_id=$1",[issued.id])).rows[0].amount_paise).toBe("60600");
      expect((await p.pharmacyWorkspace(f.pc())).stock[0].lowStock).toBe(true);
      await f.setting({...f.policy,name:"Different synthetic drug under reused code",amount:"202"});
      const reused=f.pc();await expect(p.recordStockReceipt(reused,{medicineId:f.policy.code,batchNo:"SAFE",expiresOn:"2099-12-31",quantity:"1",unit:"tablet",barcode:"SYNTH-SAFE",reference:"Different drug must not merge into old stock",requestId:reused.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      const renamed=f.pc();await expect(p.issueMedicine(renamed,input(renamed))).rejects.toMatchObject({code:"PRECONDITION"});
      const receipt=f.pc();const changedBatch=await p.recordStockReceipt(receipt,{medicineId:f.policy.code,batchNo:"RENAMED",expiresOn:"2099-12-31",quantity:"2",unit:"tablet",barcode:"SYNTH-RENAMED",reference:"Different drug catalogue receipt",requestId:receipt.requestId});
      const labels=(await p.pharmacyWorkspace(f.pc())).stock;
      expect(labels.find(b=>b.id===batch.id)?.medicineName).toBe(f.policy.name);
      expect(labels.find(b=>b.id===changedBatch.id)?.medicineName).toBe("Different synthetic drug under reused code");
      const substitution=f.pc();await expect(p.issueMedicine(substitution,{...input(substitution),batchId:changedBatch.id,quantity:"1"})).rejects.toMatchObject({code:"PRECONDITION"});
      expect((await p.getPharmacyReview(f.pc(),f.admissionId)).unresolved.join(" ")).toContain("catalogue medicine identity changed");
      await f.setting({...f.policy,amount:"303"});
      const adjust=f.pc();await expect(p.adjustStock(adjust,{batchId:batch.id,direction:"INCREASE",quantity:"1",reason:"Unauthorized stock change",requestId:adjust.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
      const admin=staffContext(f.admin,"synthetic-adjustment");await p.adjustStock(admin,{batchId:batch.id,direction:"DECREASE",quantity:"1",reason:"Synthetic damaged stock",requestId:admin.requestId});
      await expect(owner.query("UPDATE hims.pharmacy_batches SET barcode='replacement'")).rejects.toBeDefined();
      await expect(runtime.query("UPDATE hims.pharmacy_batches SET available_quantity=99")).rejects.toBeDefined();
      vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2099-12-31T18:29:59Z"));
      const lastMinute=f.pc();await p.issueMedicine(lastMinute,{...input(lastMinute),quantity:"1"});
      vi.setSystemTime(new Date("2099-12-31T18:30:00Z"));
      const expired=f.pc();await expect(p.issueMedicine(expired,input(expired))).rejects.toMatchObject({code:"PRECONDITION"});vi.useRealTimers();
      expect(p.hospitalDate(new Date("2026-10-09T18:29:59Z"),"Asia/Kolkata")).toBe("2026-10-09");expect(p.hospitalDate(new Date("2026-10-09T18:30:00Z"),"Asia/Kolkata")).toBe("2026-10-10");
      const billing=await import("../../src/server/billing/commands");const reverse=f.pc();await expect(billing.reverseCharge(reverse,{chargeId:(await runtime.query("SELECT id FROM hims.charges WHERE source_event_id=$1",[issued.id])).rows[0].id,amountPaise:"1",reason:"Arbitrary reversal",requestId:reverse.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
      await owner.query("UPDATE hims.staff_user SET banned=true WHERE id=$1",[f.pharmacy.id]);await expect(p.issueMedicine(actual,input(actual))).rejects.toMatchObject({code:"FORBIDDEN"});
    });
  });
  it("preserves fractional original-price rounding and rejects stale roles while configuration owns its lock",async()=> {
    await withTestDatabase(async({owner,runtime})=> {
      process.env.DATABASE_URL=runtimeUrl;
      const f=await pharmacyFixture(),p=await import("../../src/server/pharmacy/commands"),care=await import("../../src/server/clinical/commands");
      await f.setting({...f.policy,code:"PHARM_FRAC",name:"Synthetic fractional unit medicine",unit:"ml",quantityScale:2,amount:"0.01"});
      const dc=f.dc();await care.recordRound(dc,{admissionId:f.admissionId,notes:"Explicit clinical dose distinct from stock quantity",orders:[{kind:"MEDICINE",requestedItem:"Synthetic fractional unit medicine",itemId:"PHARM_FRAC",dose:"1",doseUnit:"mg",route:"oral",frequency:"Explicit schedule",durationDays:1,medicationPurpose:"WARD",schedule:{startsAt:new Date().toISOString(),intervalMinutes:60,occurrences:1}}],requestId:dc.requestId});
      const order=(await care.getCare(f.dc(),f.admissionId)).orders.find(o=>o.medicineItemId==="PHARM_FRAC")!;
      const c=f.pc(),batch=await p.recordStockReceipt(c,{medicineId:"PHARM_FRAC",batchNo:"FRACTION",expiresOn:"2099-12-31",quantity:"1",unit:"ml",barcode:"SYNTH-FRAC",reference:"Fractional synthetic stock",requestId:c.requestId});
      const ic=f.pc(),issue=await p.issueMedicine(ic,{admissionId:f.admissionId,orderId:order.id,batchId:batch.id,quantity:"1",unit:"ml",requestId:ic.requestId});
      for(const q of ["0.49","0.01","0.50"]) {const rc=f.pc();await p.returnMedicine(rc,{issueId:issue.id,quantity:q,reason:"Checked unused fractional stock",requestId:rc.requestId});}
      expect((await runtime.query("SELECT amount_paise FROM hims.charge_reversals")).rows).toEqual([{amount_paise:"1"}]);
      expect((await runtime.query("SELECT available_quantity FROM hims.pharmacy_batches")).rows[0].available_quantity).toBe("1.000000");
      const arbitrary=f.ctx(),billing=await import("../../src/server/billing/commands");
      const normal=f.pc(),issued=await p.issueMedicine(normal,{admissionId:f.admissionId,orderId:order.id,batchId:batch.id,quantity:"1",unit:"ml",requestId:normal.requestId});
      const charge=(await runtime.query("SELECT id FROM hims.charges WHERE source_event_id=$1",[issued.id])).rows[0].id;
      await billing.reverseCharge(arbitrary,{chargeId:charge,amountPaise:"1",reason:"Synthetic billing adjustment without physical return",requestId:arbitrary.requestId});
      expect((await p.getPharmacyReview(f.pc(),f.admissionId)).unresolved.join(" ")).toContain("Billing reconciliation");
      const denied=f.pc();
      const connection=new Client({connectionString:runtimeUrl});await connection.connect();
      let operation:Promise<unknown>|undefined;
      try {
        const pid=(await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const ownerPid=(await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        expect(pid).not.toBe(ownerPid);
        await owner.query("BEGIN");await owner.query("SELECT pg_advisory_xact_lock(729104211)");
        await owner.query("UPDATE hims.staff_user SET role='BILLING' WHERE id=$1",[f.pharmacy.id]);
        operation=drizzle(connection,{schema}).transaction(tx=>p.issueMedicineInTransaction(tx,denied,{admissionId:f.admissionId,orderId:order.id,batchId:batch.id,quantity:"0.01",unit:"ml",requestId:denied.requestId}));void operation.catch(()=>{});
        let waiting=false;
        for(let n=0;n<100 && !waiting;n++) {waiting=(await owner.query("SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS waiting",[ownerPid,pid])).rows[0].waiting;if(!waiting)await new Promise(r=>setTimeout(r,10));}
        expect(waiting).toBe(true);await owner.query("COMMIT");await expect(operation).rejects.toMatchObject({code:"FORBIDDEN"});
      } finally {await owner.query("ROLLBACK");await operation?.catch(()=>{});await connection.end();}
    });
  });
});
