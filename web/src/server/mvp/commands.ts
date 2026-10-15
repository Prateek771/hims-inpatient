import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError, assertHumanActor, type CommandContext, type StaffRole } from "../contracts";
import { getDb, withTransaction, type Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, bedHolds, roomStays, effectiveRoomStays } from "../admissions/schema";
import { billingRequest, lockBillingAdmission, postChargeInTransaction, resolveBillableRate, bumpBillRevision, actorColumns, receiptInput, recordReceiptInTransaction, fingerprint } from "../billing/commands";
import { charges, chargeReversals, billingRequests } from "../billing/schema";
import { quantityAmount, paise } from "../billing/money";
import { reconcileRoomChargesInTransaction } from "../billing/room-charges";
import { roomVacations, departures, bedTurnovers } from "../discharge/schema";
import { shiftForCare } from "../nursing/commands";
import { appendAudit } from "../audit";
import { user } from "../schema/auth";
import { dischargeDocuments } from "../documents/schema";
import { jsonSnapshot } from "../discharge/dependencies";
import { mvpEvents, mvpChecks, optionalMvpChecks, mvpMedicineSources, mvpReceivableReceipts } from "./schema";
import { mvpState } from "./dependencies";

const note = z.string().trim().min(3).max(2000), time = z.iso.datetime();
const common = { admissionId:z.uuid(),requestId:z.uuid(),expectedReviewHash:z.string().regex(/^[0-9a-f]{64}$/) };
export const mvpActionInput = z.discriminatedUnion("action", [
  z.strictObject({...common,action:z.literal("doctor-approval"),authorizerName:note,authorizerId:z.string().trim().min(1).max(200).optional(),sourceTime:time,evidence:note,clinicalSummary:note,prescription:note,followUp:note}),
  z.strictObject({...common,action:z.literal("checklist"),items:z.array(note).min(1).max(50),proposedNa:z.array(z.enum(optionalMvpChecks)).max(3),remarks:note}),
  z.strictObject({...common,action:z.literal("check"),check:z.enum(mvpChecks),status:z.enum(["COMPLETE","PENDING"]),remarks:note,confirmerName:note.optional(),sourceTime:time.optional(),evidence:note.optional()}),
  z.strictObject({...common,action:z.literal("n-a"),check:z.enum(optionalMvpChecks),reason:note}),
  z.strictObject({...common,action:z.literal("vacancy"),shiftId:z.uuid(),vacatedAt:time,waitingLocation:note,handover:note}),
  z.strictObject({...common,action:z.literal("finance"),reason:note}),
  z.strictObject({...common,action:z.literal("deliver"),kind:z.enum(["CLINICAL","FINAL"]),documentId:z.uuid().optional(),recipient:note,deliveredAt:time,evidence:note}),
  z.strictObject({...common,action:z.literal("exit"),shiftId:z.uuid(),departedAt:time}),
]);
export type MvpActionInput = z.input<typeof mvpActionInput>;
const allowed: StaffRole[] = ["ADMIN","ADMISSION","NURSE","PHARMACY","INSURANCE","BILLING"];
async function own(tx:Transaction,ctx:CommandContext,admissionId:string,roles:StaffRole[]=allowed,readOnly=false) {
  const actor=assertHumanActor(ctx);
  const staff=readOnly?(await tx.select({id:user.id,name:user.name,role:user.role,banned:user.banned}).from(user).where(eq(user.id,actor.staffId)))[0]:await admissionOperator(ctx,roles,tx);
  if(!staff||staff.banned||!roles.includes(staff.role as StaffRole))throw new DomainError("FORBIDDEN","Staff access denied");
  if(!readOnly)await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e=readOnly?(await tx.select().from(admissions).where(eq(admissions.id,admissionId)))[0]:await lockBillingAdmission(tx,admissionId);
  if(!e)throw new DomainError("FORBIDDEN","Admission access denied");
  if(e.workflowVersion!==2) throw new DomainError("PRECONDITION","This action belongs to the version 2 inpatient workflow");
  if(staff.role==="NURSE") {
    const assignment = await tx.execute(sql`select 1 from hims.nurse_assignments a where a.admission_id=${e.id} and a.nurse_id=${staff.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=a.id)`);
    if(!assignment.rows.length)throw new DomainError("FORBIDDEN","Current episode Nurse assignment required");
  }
  if(staff.role==="INSURANCE"&&!(await tx.execute(sql`select 1 from hims.insurance_cases where admission_id=${e.id} and assigned_staff_id=${staff.id}`)).rows.length)throw new DomainError("FORBIDDEN","Current Insurance case assignment required");
  return {staff,e};
}
type Json<T> = T extends Date ? string : T extends bigint ? string : T extends (infer V)[] ? Json<V>[] : T extends object ? {[K in keyof T]:Json<T[K]>} : T;
async function exceptionalCollectionAuthority(tx:Transaction,e:typeof admissions.$inferSelect,state:Awaited<ReturnType<typeof mvpState>>){
  const authority=state.exceptions.find(x=>x.id===state.exceptionalDeparture?.authorityId&&x.action==="AUTHORITY");
  if(e.status!=="DISCHARGED"||!authority)return null;
  const pinned=authority.payload.financial as {responsibility?:{allocationComplete?:boolean;patientPaise?:string;insurerPaise?:string}}|undefined;
  const current=state.financial.responsibility,originalComplete=pinned?.responsibility?.allocationComplete===true;
  let allocationAmendmentId:string|null=null,reason:string|null=null;
  if(!current?.allocationComplete)reason="Current complete verified party allocation is required";
  else if(!originalComplete){
    if(authority.type!=="INSURANCE_DELAY")reason="Original complete party responsibility is required for this exception";
    else{
      const result=await tx.execute<{id:string|null}>(sql`select hims.mvp_delay_allocation_amendment(${e.id},${state.financial.decisionId??null}::uuid) id`);
      allocationAmendmentId=result.rows[0]?.id??null;
      if(!allocationAmendmentId)reason="Exact current Admin-authorized post-exit insurance allocation amendment is required";
    }
  }
  const remaining=(share:bigint,cash:bigint)=>share>cash?share-cash:0n;
  const originalBill=authority.payload.bill as {netPaise?:string}|undefined;
  const originalNet=BigInt(originalBill?.netPaise??"0"),aggregate=remaining(originalNet,state.bill.retainedPaise);
  let patientRemainingPaise=0n,insurerRemainingPaise=0n;
  if(!reason&&current){
    const patientCap=originalComplete?BigInt(pinned?.responsibility?.patientPaise??"0"):current.patientPaise,insurerCap=originalComplete?BigInt(pinned?.responsibility?.insurerPaise??"0"):current.insurerPaise;
    patientRemainingPaise=remaining(patientCap<current.patientPaise?patientCap:current.patientPaise,state.bill.patientCashPaise);
    insurerRemainingPaise=remaining(insurerCap<current.insurerPaise?insurerCap:current.insurerPaise,state.bill.insurerCashPaise);
    if(!originalComplete){patientRemainingPaise=patientRemainingPaise<aggregate?patientRemainingPaise:aggregate;insurerRemainingPaise=insurerRemainingPaise<aggregate?insurerRemainingPaise:aggregate;}
  }
  const partyRemaining=patientRemainingPaise+insurerRemainingPaise;
  return {exceptionAuthorityId:authority.id,allocationAmendmentId,eligible:!reason,reason,patientRemainingPaise,insurerRemainingPaise,totalRemainingPaise:originalComplete||partyRemaining<aggregate?partyRemaining:aggregate};
}
export async function getMvpEpisode(ctx:CommandContext,admissionId:string) {
  return getDb().transaction(async tx=>{
    const {staff,e}=await own(tx,ctx,z.uuid().parse(admissionId),allowed,true);
    const state=await mvpState(tx,e);
    const services=["ADMIN","BILLING"].includes(staff.role)?await (await import("./services")).externalServiceProjection(tx,e):{serviceItems:[],serviceSources:[]};
    const collectionAuthority=["ADMIN","BILLING"].includes(staff.role)?await exceptionalCollectionAuthority(tx,e,state):null;
    const documents=["ADMIN","NURSE","BILLING"].includes(staff.role)?await tx.select({id:dischargeDocuments.id,kind:dischargeDocuments.kind,version:dischargeDocuments.version,createdAt:dischargeDocuments.createdAt}).from(dischargeDocuments).where(eq(dischargeDocuments.admissionId,e.id)).orderBy(desc(dischargeDocuments.version)):[];
    const {history: _history,...projection}=state;void _history;
    // Clinical text is supplied by the external Doctor; only coordinating staff need its contents.
    if(!["ADMIN","NURSE"].includes(staff.role)&&projection.clinical) projection.clinical={...projection.clinical,payload:{authorizerName:projection.clinical.payload.authorizerName,sourceTime:projection.clinical.payload.sourceTime,recorderName:projection.clinical.payload.recorderName}};
    const moneyAllowed=["ADMIN","BILLING","INSURANCE"].includes(staff.role);
    if(!["ADMIN","BILLING"].includes(staff.role)&&projection.finance)projection.finance={...projection.finance,payload:{reason:projection.finance.payload.reason}};
    if(!["ADMIN","NURSE"].includes(staff.role)&&projection.checklist)projection.checklist={...projection.checklist,payload:{proposedNa:projection.checklist.payload.proposedNa}};
    if(!["ADMIN","NURSE"].includes(staff.role)&&projection.vacancy)projection.vacancy={...projection.vacancy,handover:"Restricted to coordinating Nurse/Admin",originalHandover:"Restricted to coordinating Nurse/Admin"};
    const bill=staff.role==="INSURANCE"?{...projection.bill,charges:[],reversals:[],receipts:[],allocations:[],refunds:[],cancellations:[],activeAllocations:[]}:projection.bill;
    const exceptions=["ADMIN","BILLING"].includes(staff.role)?projection.exceptions:staff.role==="NURSE"?projection.exceptions.map(x=>{const {bill:_bill,financial:_financial,...payload}=x.payload;void _bill;void _financial;return {...x,payload};}):[];
    const exceptionalDeparture=["ADMIN","BILLING"].includes(staff.role)?projection.exceptionalDeparture:staff.role==="NURSE"&&projection.exceptionalDeparture?{...projection.exceptionalDeparture,snapshot:{clinicalId:projection.exceptionalDeparture.clinicalId,authorityId:projection.exceptionalDeparture.authorityId}}:null;
    const checks=["ADMIN","NURSE"].includes(staff.role)?projection.checks:projection.checks.map(c=>({...c,event:c.event?{...c.event,payload:c.check===staff.role?c.event.payload:{recorderName:c.event.payload.recorderName}}:null}));
    const result={episode:{id:e.id,ipCode:e.ipCode,status:e.status,version:e.version,workflowVersion:e.workflowVersion,billRevision:e.billRevision,patientId:e.patientId},...projection,...services,checks,exceptions,collectionAuthority,returns:["ADMIN","NURSE"].includes(staff.role)?projection.returns:[],exceptionalDeparture,documents,bill:moneyAllowed?bill:null,financial:moneyAllowed?projection.financial:null,deliveries:["ADMIN","NURSE","BILLING"].includes(staff.role)?projection.deliveries:[],medicine:["ADMIN","BILLING","PHARMACY"].includes(staff.role)?projection.medicine:[]};
    return jsonSnapshot(result) as Json<typeof result>;
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
function actual(value:string,minimum?:Date) {const t=new Date(value);if(t>new Date()||(minimum&&t<minimum))throw new DomainError("VALIDATION","Recorded actual time must fall within its source history and no later than now");return t;}
async function event(tx:Transaction,ctx:CommandContext,e:typeof admissions.$inferSelect,state:Awaited<ReturnType<typeof mvpState>>,v:Extract<MvpActionInput,{action:"doctor-approval"|"checklist"|"check"|"n-a"|"finance"|"deliver"}>,extra:Record<string,unknown>={}) {
  const {action,admissionId: _admissionId,requestId:_requestId,expectedReviewHash:_expectedReviewHash,...payload}=v;void _admissionId;void _requestId;void _expectedReviewHash;
  const recorderId=ctx.actor.type==="staff"?ctx.actor.staffId:"",[recorder]=await tx.select({name:user.name}).from(user).where(eq(user.id,recorderId));
  const [row]=await tx.insert(mvpEvents).values({admissionId:e.id,action,check:"check" in v?v.check:null,status:v.action==="n-a"?"NA":v.action==="check"?v.status:null,payload:jsonSnapshot({...payload,...extra,recorderName:recorder?.name??recorderId}),reviewHash:state.reviewHash,billVersion:e.billRevision,clinicalId:state.clinical?.id,checklistId:state.checklist?.id,recordedBy:recorderId}).returning();
  await appendAudit(tx,ctx,{event:`mvp.${v.action}`,entityType:"mvp-event",entityId:row.id,reason:"reason" in v?v.reason:"remarks" in v?v.remarks:"Staff recorded source-bound inpatient coordination evidence"});
  return {id:row.id};
}
export async function recordMvpAction(ctx:CommandContext,input:unknown):Promise<{id:string;documentId?:string}> {
  const v=mvpActionInput.parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  if(v.action==="deliver"){
    const retry=await withTransaction(async tx=>{await own(tx,ctx,v.admissionId,["NURSE","ADMIN"]);const [r]=await tx.select().from(billingRequests).where(and(eq(billingRequests.actorId,ctx.actor.type==="staff"?ctx.actor.staffId:""),eq(billingRequests.requestId,ctx.requestId)));if(r&&(r.action!=="mvp.deliver"||r.payload!==fingerprint(v)))throw new DomainError("CONFLICT","Request key already belongs to different facts");return r?.result;});
    if(retry)return retry;
  }
  // Rendering happens outside admission ownership; publication and delivery each reread their authority.
  let preparedDocumentId=v.action==="deliver"?v.documentId:undefined;
  if(v.action==="deliver"&&!preparedDocumentId) preparedDocumentId=(await (await import("../documents/mvp")).createMvpDocument(ctx,{admissionId:v.admissionId,kind:v.kind,expectedReviewHash:v.expectedReviewHash})).documentId;
  return withTransaction(async tx=>{
    const roles:StaffRole[]=v.action==="n-a"?["ADMIN"]:v.action==="finance"?["ADMIN","BILLING"]:v.action==="check"?(v.check==="NURSING"||v.check==="DIAGNOSTICS"?["NURSE"]:v.check==="PHARMACY"?["PHARMACY"]:["INSURANCE"]):v.action==="deliver"?["NURSE","ADMIN"]:["NURSE"];
    const {staff,e}=await own(tx,ctx,v.admissionId,roles);
    return billingRequest(tx,ctx,`mvp.${v.action}`,v,async()=>{
      if(e.status!=="ADMITTED")throw new DomainError("PRECONDITION","New coordination actions require an active episode");
      const state=await mvpState(tx,e);
      if(state.reviewHash!==v.expectedReviewHash)throw new DomainError("CONFLICT","Episode sources changed; refresh and review before acting");
      if(v.action==="doctor-approval") {actual(v.sourceTime,e.admittedAt??undefined);return event(tx,ctx,e,state,v);}
      if(!state.clinical)throw new DomainError("PRECONDITION","Record external Doctor approval before discharge coordination");
      if(v.action==="checklist")return event(tx,ctx,e,state,v);
      if(!state.checklist&&!(v.action==="deliver"&&v.kind==="CLINICAL"))throw new DomainError("PRECONDITION","Publish the current physical checklist first");
      if(v.action==="check") {
        if(v.check==="DIAGNOSTICS"&&v.status==="COMPLETE"&&(!v.confirmerName||!v.evidence||!v.sourceTime))throw new DomainError("VALIDATION","External diagnostic confirmation requires named confirmer, source time and evidence; Nurse records it without a clinical seal");
        if(v.sourceTime)actual(v.sourceTime,e.admittedAt??undefined);
        if(v.check==="INSURANCE"&&v.status==="COMPLETE"&&!state.financial.responsibility?.allocationComplete)throw new DomainError("PRECONDITION","Current externally verified responsibility is required");
        if(v.check==="PHARMACY"&&v.status==="COMPLETE"&&state.bill.charges.some(c=>c.category==="medicine"&&c.status==="PENDING"))throw new DomainError("PRECONDITION","Resolve pending patient medicine charges");
        return event(tx,ctx,e,state,v);
      }
      if(v.action==="n-a") {
        if(!(state.checklist?.payload.proposedNa as string[]|undefined)?.includes(v.check))throw new DomainError("PRECONDITION","Nurse must propose optional applicability before Admin confirmation");
        if(v.check==="INSURANCE"&&(e.paymentRoute!=="SELF_PAY"||state.financial.caseId))throw new DomainError("PRECONDITION","Existing insurance work or responsibility cannot be marked N/A");
        if(v.check==="PHARMACY"&&state.bill.charges.some(c=>c.category==="medicine"))throw new DomainError("PRECONDITION","Patient medicine work exists; Pharmacy must reconcile it");
        if(v.check==="DIAGNOSTICS"&&state.bill.charges.some(c=>["lab","radiology"].includes(c.category)))throw new DomainError("PRECONDITION","Diagnostic service charges exist; record the external department confirmation");
        if(state.checks.find(c=>c.check===v.check)?.event?.status==="PENDING")throw new DomainError("PRECONDITION","Relevant pending department work must be resolved before N/A");
        return event(tx,ctx,e,state,v);
      }
      if(v.action==="vacancy") {
        if(state.vacancy)throw new DomainError("CONFLICT","Bed vacancy already recorded; retain the original physical fact");
        const nursing=state.checks.find(c=>c.check==="NURSING");
        if(!nursing?.current)throw new DomainError("PRECONDITION","Nursing readiness must be current");
        const {actual:T}=await shiftForCare(tx,staff,v.shiftId,e.id,v.vacatedAt);
        const [stay]=await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId,e.id),isNull(effectiveRoomStays.endedAt)));
        if(!stay||T<=stay.startedAt||(stay.lastReconciledAt&&T<stay.lastReconciledAt))throw new DomainError("CONFLICT","Vacancy predates actual room-use history");
        await tx.select().from(beds).where(eq(beds.id,stay.bedId)).for("update");
        await reconcileRoomChargesInTransaction(tx,{admissionId:e.id,cutoff:T,actorContext:ctx});
        await tx.update(roomStays).set({endedAt:T}).where(eq(roomStays.id,stay.id));
        const [row]=await tx.insert(roomVacations).values({admissionId:e.id,stayId:stay.id,mvpReadinessId:nursing.event!.id,shiftId:v.shiftId,vacatedAt:T,waitingLocation:v.waitingLocation,handover:v.handover,signedBy:staff.id,signedAt:new Date()}).returning();
        await appendAudit(tx,ctx,{event:"mvp.vacancy",entityType:"room-vacation",entityId:row.id,reason:v.handover});return {id:row.id};
      }
      if(v.action==="finance") {
        if(state.blockers.length)throw new DomainError("PRECONDITION",state.blockers.join(" "));
        return event(tx,ctx,e,state,v,{bill:state.bill,financial:state.financial,checks:state.checks.map(c=>({check:c.check,eventId:c.event?.id,status:c.status})),vacancyId:state.vacancy?.id});
      }
      if(v.action==="deliver") {
        if(v.kind==="FINAL"&&!state.finance)throw new DomainError("PRECONDITION","Current final financial authority required for final papers");
        const doc=await (await import("../documents/mvp")).assertMvpDelivery(tx,e,preparedDocumentId!,v.kind,state);
        actual(v.deliveredAt,doc.createdAt);
        const row=await event(tx,ctx,e,state,v,{documentId:doc.id,documentVersion:doc.version,documentHash:doc.hash,financeId:state.finance?.id??null});return {...row,documentId:doc.id};
      }
      if(!state.finance||!state.vacancy)throw new DomainError("PRECONDITION","Current finance and physical vacancy required");
      const delivery=state.deliveries.find(d=>d.payload.kind==="FINAL"&&d.payload.financeId===state.finance!.id);
      if(!delivery)throw new DomainError("PRECONDITION","Deliver the current authorized final papers before actual exit");
      const {actual:T}=await shiftForCare(tx,staff,v.shiftId,e.id,v.departedAt);
      if(T<new Date(String(delivery.payload.deliveredAt))||T<state.finance.recordedAt||T<state.vacancy.vacatedAt)throw new DomainError("VALIDATION","Actual exit must follow vacancy, financial authorization and paper delivery");
      await tx.select().from(beds).where(eq(beds.id,e.bedId)).for("update");
      const [row]=await tx.insert(departures).values({admissionId:e.id,stayId:state.vacancy.stayId,mvpFinanceId:state.finance.id,billVersion:e.billRevision,departedAt:T,signedBy:staff.id,signedAt:new Date()}).returning();
      await tx.update(admissions).set({status:"DISCHARGED",version:sql`${admissions.version}+1`}).where(eq(admissions.id,e.id));
      await tx.delete(bedHolds).where(eq(bedHolds.admissionId,e.id));
      const [turnover]=await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId,state.vacancy.stayId));
      if(!turnover)await tx.insert(bedTurnovers).values({bedId:e.bedId,stayId:state.vacancy.stayId,admissionId:e.id,vacatedAt:state.vacancy.vacatedAt,reason:"Actual MVP exit; authorized turnover required",signedBy:staff.id,signedAt:new Date()});
      await appendAudit(tx,ctx,{event:"mvp.exit",entityType:"departure",entityId:row.id,reason:"Assigned Nurse confirmed actual exit after current approvals and document delivery"});return {id:row.id};
    });
  });
}

export async function recordPatientMedicineCharge(ctx:CommandContext,input:unknown) {
  const v=z.strictObject({admissionId:z.uuid(),itemId:z.string().trim().min(1),quantity:z.string(),unit:z.string().trim().min(1),expectedTariffVersionId:z.uuid(),sourceReference:note,evidence:note,requestId:z.uuid()}).parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  return withTransaction(async tx=>{const {staff,e}=await own(tx,ctx,v.admissionId,["PHARMACY"]);return billingRequest(tx,ctx,"mvp.medicine-charge",v,async()=>{
    if(e.status!=="ADMITTED")throw new DomainError("PRECONDITION","Patient medicine charge requires an active episode");
    const [old]=await tx.select().from(mvpMedicineSources).where(and(eq(mvpMedicineSources.admissionId,e.id),eq(mvpMedicineSources.kind,"CHARGE"),eq(mvpMedicineSources.reference,v.sourceReference)));
    if(old)throw new DomainError("CONFLICT","Medicine source already exists; use its original request key");
    const id=randomUUID(),rate=await resolveBillableRate(tx,{itemId:v.itemId,eventKind:"medicine",unit:v.unit,quantity:v.quantity});
    const charge=await postChargeInTransaction(tx,ctx,{admissionId:e.id,sourceEventId:id,category:"medicine",itemId:v.itemId,quantity:v.quantity,unit:v.unit,tariffVersionId:v.expectedTariffVersionId,status:"FINAL"},rate);
    await tx.insert(mvpMedicineSources).values({id,admissionId:e.id,kind:"CHARGE",chargeId:charge.id,quantity:v.quantity,quantityScale:rate.policy.quantityScale,evidence:v.evidence,reference:v.sourceReference,recordedBy:staff.id});
    return {id};
  });});
}
export async function acceptPatientMedicineReturn(ctx:CommandContext,input:unknown) {
  const v=z.strictObject({admissionId:z.uuid(),originalChargeId:z.uuid(),quantity:z.string(),reason:note,evidence:note,expectedBillVersion:z.number().int().positive(),requestId:z.uuid()}).parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  return withTransaction(async tx=>{const {staff,e}=await own(tx,ctx,v.admissionId,["PHARMACY"]);return billingRequest(tx,ctx,"mvp.medicine-return",v,async()=>{
    if(e.status!=="ADMITTED"||e.billRevision!==v.expectedBillVersion)throw new DomainError("CONFLICT","Review the current active patient medicine bill");
    const [source]=await tx.select().from(mvpMedicineSources).where(and(eq(mvpMedicineSources.chargeId,v.originalChargeId),eq(mvpMedicineSources.kind,"CHARGE"),eq(mvpMedicineSources.admissionId,e.id)));
    const [charge]=await tx.select().from(charges).where(eq(charges.id,v.originalChargeId));
    if(!source||!charge)throw new DomainError("FORBIDDEN","Original patient medicine charge required");
    const prior=await tx.select().from(mvpMedicineSources).where(eq(mvpMedicineSources.originalId,source.id));
    const scale=source.quantityScale,units=(q:string)=>quantityAmount(10n**BigInt(scale),q,scale);
    const quantity=units(v.quantity),already=prior.reduce((n,r)=>n+units(r.quantity),0n);
    if(already+quantity>units(source.quantity))throw new DomainError("PRECONDITION","Accepted return exceeds the original patient quantity");
    const reversals=await tx.select().from(chargeReversals).where(eq(chargeReversals.chargeId,charge.id));
    const returned=prior.reduce((n,r)=>n+(reversals.find(x=>x.id===r.reversalId)?.amountPaise??0n),0n);
    const q=(already+quantity).toString().padStart(scale+1,"0"),cumulativeQuantity=scale?`${q.slice(0,-scale)}.${q.slice(-scale)}`:q;
    const cumulative=quantityAmount(charge.ratePaise,cumulativeQuantity,scale),amount=(cumulative>charge.amountPaise?charge.amountPaise:cumulative)-returned;
    if(amount<0n||reversals.reduce((n,r)=>n+r.amountPaise,0n)+amount>charge.amountPaise)throw new DomainError("CONFLICT","Existing credits require Billing review");
    const [reversal]=amount>0n?await tx.insert(chargeReversals).values({chargeId:charge.id,amountPaise:amount,reason:v.reason,...actorColumns(ctx)}).returning():[];
    const id=randomUUID();await tx.insert(mvpMedicineSources).values({id,admissionId:e.id,kind:"RETURN",originalId:source.id,chargeId:charge.id,reversalId:reversal?.id,quantity:v.quantity,quantityScale:scale,evidence:v.evidence,reference:ctx.requestId,recordedBy:staff.id});
    await bumpBillRevision(tx,e.id);await appendAudit(tx,ctx,{event:"mvp.medicine-return",entityType:"mvp-medicine-source",entityId:id,reason:v.reason});return {id};
  });});
}
export async function recordInsurerReceivableReceipt(ctx:CommandContext,input:unknown) {
  const v=receiptInput.parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  if(v.party!=="INSURER"||v.kind!=="PAYMENT"||!v.evidenceId)throw new DomainError("VALIDATION","Actual insurer payment and receipt evidence required");
  return withTransaction(async tx=>{const {staff,e}=await own(tx,ctx,v.admissionId,["ADMIN","BILLING"]);
    if(e.status!=="DISCHARGED")throw new DomainError("PRECONDITION","This path settles an accepted insurer receivable after actual exit");
    return billingRequest(tx,ctx,"mvp.receivable-receipt",v,async()=>{
      const state=await mvpState(tx,e),financeId=state.departure?.mvpFinanceId;
      const [finance]=financeId?await tx.select().from(mvpEvents).where(eq(mvpEvents.id,financeId)):[];
      if(!finance)throw new DomainError("PRECONDITION","Original accepted financial authority required");
      const pinned=finance.payload.financial as {responsibility?:{insurerPaise?:string}};
      const current=state.financial.responsibility;
      if(!current?.allocationComplete)throw new DomainError("PRECONDITION","Review the current complete party allocation before collecting an original receivable");
      const original=BigInt(pinned?.responsibility?.insurerPaise??"0"),accepted=original<current.insurerPaise?original:current.insurerPaise;
      if(paise(v.amountPaise)>accepted-state.bill.insurerCashPaise)throw new DomainError("PRECONDITION","Receipt exceeds the remaining accepted insurer receivable");
      const receiptCtx={...ctx,requestId:randomUUID()};
      const receipt=await recordReceiptInTransaction(tx,receiptCtx,{...v,requestId:receiptCtx.requestId},undefined,true);
      const [row]=await tx.insert(mvpReceivableReceipts).values({admissionId:e.id,financeId:finance.id,receiptId:receipt.id,recordedBy:staff.id}).returning();return {id:row.id};
    });
  });
}
/** Collect only the retained, already attributed party obligation; never reopen or rewrite exit. */
export async function recordExceptionalReceivableReceipt(ctx:CommandContext,input:unknown){
  const v=receiptInput.parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  if(v.kind!=="PAYMENT"||!v.evidenceId)throw new DomainError("VALIDATION","Actual payment and receipt evidence required");
  return withTransaction(async tx=>{const {staff,e}=await own(tx,ctx,v.admissionId,["ADMIN","BILLING"]);
    if(e.status!=="DISCHARGED")throw new DomainError("PRECONDITION","Exceptional receivable collection requires recorded actual exit");
    return billingRequest(tx,ctx,"mvp.exceptional-receivable-receipt",v,async()=>{
      const state=await mvpState(tx,e),collection=await exceptionalCollectionAuthority(tx,e,state);
      if(!collection?.eligible)throw new DomainError("PRECONDITION",collection?.reason??"Original exceptional departure authority required");
      if(paise(v.amountPaise)>(v.party==="PATIENT"?collection.patientRemainingPaise:collection.insurerRemainingPaise))throw new DomainError("PRECONDITION","Payment exceeds this party's remaining authorized exception receivable");
      const receiptCtx={...ctx,requestId:randomUUID()},receipt=await recordReceiptInTransaction(tx,receiptCtx,{...v,requestId:receiptCtx.requestId},undefined,true);
      const [row]=await tx.insert(mvpReceivableReceipts).values({admissionId:e.id,exceptionAuthorityId:collection.exceptionAuthorityId,allocationAmendmentId:collection.allocationAmendmentId,receiptId:receipt.id,recordedBy:staff.id}).returning();
      await appendAudit(tx,ctx,{event:"mvp.exception-receivable-received",entityType:"mvp-receivable-receipt",entityId:row.id,reason:"Actual party payment settles an original retained exception obligation without rewriting departure"});return {id:row.id};
    });
  });
}
export {own as ownMvpEpisode};
