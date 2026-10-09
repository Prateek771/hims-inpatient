import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext, type StaffRole } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, effectivePatients as patients } from "../admissions/schema";
import { transferInsuranceTasks } from "../admissions/transfer-schema";
import { user } from "../schema/auth";
import { settingVersions } from "../schema/core";
import { billingRequest, insuranceMoneyInTransaction, lockBillingAdmission, financialResponsibilityInTransaction } from "../billing/commands";
import { paise } from "../billing/money";
import { appendAudit } from "../audit";
import { computeResponsibilities } from "./responsibility";
import { insuranceCases, insuranceConversions, insuranceDecisions, insuranceDocuments, insuranceEvents, insuranceTransferResolutions } from "./schema";
export { computeResponsibilities } from "./responsibility";
const text=z.string().trim().min(1).max(250),reason=z.string().trim().min(3).max(1000);
const money=z.string().regex(/^\d{1,19}$/).refine(v=>BigInt(v)<=9223372036854775807n,"Amount out of range");
const provenance={verifiedBy:text,verifiedAt:z.iso.datetime(),reference:text};
export const caseInput={caseId:z.uuid(),expectedCaseVersion:z.number().int().positive(),requestId:z.uuid()};
const documents=z.array(z.uuid()).max(100).refine(v=>new Set(v).size===v.length,"Repeated document");
const allocationInput=z.strictObject({billRevision:z.number().int().positive(),netBillPaise:money,eligibleBillPaise:money,nonPayablePaise:money,verifiedPatientLiabilityPaise:money.optional(),sourceReference:text});
export async function insuranceOperator(tx:Transaction,ctx:CommandContext,roles:readonly StaffRole[]=["ADMIN","BILLING","INSURANCE"]){
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);return admissionOperator(ctx,roles,tx);
}
export async function requestLock(tx:Transaction,ctx:CommandContext,requestId:string){
  if(ctx.actor.type!=="staff"||ctx.requestId!==requestId)throw new DomainError("VALIDATION","Request keys disagree");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${ctx.actor.staffId}:${requestId}`},0))`);
}
/** Current staff and assignment are rechecked under the owning episode lock, including old retries. */
export async function insuranceCaseSource(tx:Transaction,ctx:CommandContext,caseId:string){
  const staff=await insuranceOperator(tx,ctx);
  const [locator]=await tx.select({admissionId:insuranceCases.admissionId}).from(insuranceCases).where(eq(insuranceCases.id,z.uuid().parse(caseId)));
  if(!locator)throw new DomainError("FORBIDDEN","Insurance case access denied");
  const episode=await lockBillingAdmission(tx,locator.admissionId);
  const [record]=await tx.select().from(insuranceCases).where(eq(insuranceCases.id,caseId));
  if(!record||(staff.role==="INSURANCE"&&record.assignedStaffId!==staff.id))throw new DomainError("FORBIDDEN","Current insurance case assignment required");
  return {record,episode,staff};
}
export async function insuranceCommand(tx:Transaction,ctx:CommandContext,action:string,v:{caseId:string;requestId:string;expectedCaseVersion:number},apply:(s:Awaited<ReturnType<typeof insuranceCaseSource>>)=>Promise<{id:string}>,roles:readonly StaffRole[]=["ADMIN","BILLING","INSURANCE"],exceptionId?:string){
  await insuranceOperator(tx,ctx,roles);await requestLock(tx,ctx,v.requestId);const s=await insuranceCaseSource(tx,ctx,v.caseId);
  return billingRequest(tx,ctx,`insurance.${action}`,v,async()=>{
    if(s.record.version!==v.expectedCaseVersion)throw new DomainError("CONFLICT","Insurance case changed; reload the current version");
    if(!["PENDING","ADMITTED"].includes(s.episode.status)){
      if(!exceptionId||action!=="decision")throw new DomainError("PRECONDITION","Closed episode requires attributable exception review");
      const {requireCorrectionAuthority}=await import("../discharge/exceptions");
      await requireCorrectionAuthority(tx,s.episode,exceptionId,"INSURANCE_DECISION",s.record.id);
    }
    return apply(s);
  });
}
export async function bumpInsuranceCase(tx:Transaction,caseId:string,review=false,document=false){
  return (await tx.update(insuranceCases).set({version:sql`${insuranceCases.version}+1`,...(review?{reviewRevision:sql`${insuranceCases.reviewRevision}+1`}:{}),...(document?{documentSetRevision:sql`${insuranceCases.documentSetRevision}+1`}:{})}).where(eq(insuranceCases.id,caseId)).returning())[0];
}
export async function insuranceAudit(tx:Transaction,ctx:CommandContext,event:string,caseId:string,why:string,version?:number){await appendAudit(tx,ctx,{event:`insurance.${event}`,entityType:"insurance-case",entityId:caseId,reason:why,...(version?{afterVersion:version}:{})});}
function verifiedAt(value:string){const at=new Date(value);if(at>new Date())throw new DomainError("VALIDATION","External verification cannot be in the future");return at;}
async function assignee(tx:Transaction,id:string|null){if(id){const [s]=await tx.select().from(user).where(eq(user.id,id));if(!s||s.banned||s.role!=="INSURANCE")throw new DomainError("VALIDATION","Assign an active Insurance staff account");}}
export async function createInsuranceCase(ctx:CommandContext,input:unknown){
  const v=z.strictObject({admissionId:z.uuid(),assignedStaffId:text.nullable(),reason,requestId:z.uuid()}).parse(input);
  return withTransaction(async tx=>{const staff=await insuranceOperator(tx,ctx,["ADMIN","ADMISSION","BILLING"]);await requestLock(tx,ctx,v.requestId);
    return billingRequest(tx,ctx,"insurance.create",v,async()=>{const e=await lockBillingAdmission(tx,v.admissionId);if(e.paymentRoute!=="INSURED"||!["PENDING","ADMITTED"].includes(e.status))throw new DomainError("PRECONDITION","Create a case for an open insured admission");await assignee(tx,v.assignedStaffId);
      const [old]=await tx.select().from(insuranceCases).where(eq(insuranceCases.admissionId,e.id));if(old)throw new DomainError("CONFLICT","Admission already has an insurance case");
      const [c]=await tx.insert(insuranceCases).values({admissionId:e.id,assignedStaffId:v.assignedStaffId,recordedBy:staff.id,recordedAt:new Date()}).returning();
      await tx.insert(insuranceEvents).values({caseId:c.id,caseVersion:1,kind:"ASSIGNMENT",reason:v.reason,payload:{assignedStaffId:v.assignedStaffId},recordedBy:staff.id,recordedAt:new Date()});await insuranceAudit(tx,ctx,"case-created",c.id,v.reason,1);return {id:c.id};
    });
  });
}
export async function assignInsuranceCase(ctx:CommandContext,input:unknown){
  const v=z.strictObject({...caseInput,assignedStaffId:text.nullable(),reason}).parse(input);
  return withTransaction(tx=>insuranceCommand(tx,ctx,"assignment",v,async s=>{await assignee(tx,v.assignedStaffId);await tx.update(insuranceCases).set({assignedStaffId:v.assignedStaffId}).where(eq(insuranceCases.id,s.record.id));const c=await bumpInsuranceCase(tx,s.record.id);const [event]=await tx.insert(insuranceEvents).values({caseId:c.id,caseVersion:c.version,kind:"ASSIGNMENT",reason:v.reason,payload:{assignedStaffId:v.assignedStaffId},recordedBy:s.staff.id,recordedAt:new Date()}).returning();await insuranceAudit(tx,ctx,"assignment-changed",c.id,v.reason,c.version);return {id:event.id};},["ADMIN","BILLING"]));
}
export async function validateCaseDocuments(tx:Transaction,caseId:string,ids:string[]){
  if(!ids.length)return;
  const rows=await tx.select().from(insuranceDocuments).where(and(eq(insuranceDocuments.caseId,caseId),inArray(insuranceDocuments.id,ids)));
  if(rows.length!==ids.length)throw new DomainError("FORBIDDEN","Evidence requires documents attached to this case");
  const {readStoredDocument}=await import("./documents");for(const row of rows)await readStoredDocument(row);
}
export async function recordPolicyVerification(ctx:CommandContext,input:unknown){
  const date=z.iso.date();const v=z.strictObject({...caseInput,insurer:text,tpa:z.string().trim().max(250),policyNumber:text,memberNumber:text,validFrom:date,validTo:date,...provenance,documentIds:documents}).parse(input);const at=verifiedAt(v.verifiedAt);if(v.validTo<v.validFrom)throw new DomainError("VALIDATION","Policy validity dates are reversed");
  return withTransaction(tx=>insuranceCommand(tx,ctx,"policy",v,async s=>{if(s.episode.paymentRoute!=="INSURED")throw new DomainError("PRECONDITION","Case was converted to self-pay");await validateCaseDocuments(tx,v.caseId,v.documentIds);const c=await bumpInsuranceCase(tx,v.caseId,true);const [event]=await tx.insert(insuranceEvents).values({caseId:c.id,caseVersion:c.version,kind:"POLICY",reason:`External policy verification: ${v.reference}`,payload:{insurer:v.insurer,tpa:v.tpa,policyNumber:v.policyNumber,memberNumber:v.memberNumber,validFrom:v.validFrom,validTo:v.validTo,verifiedBy:v.verifiedBy,verifiedAt:at.toISOString(),reference:v.reference,documentIds:v.documentIds},recordedBy:s.staff.id,recordedAt:new Date()}).returning();await insuranceAudit(tx,ctx,"policy-recorded",c.id,event.reason,c.version);return {id:event.id};}));
}
export async function recordPayerDecision(ctx:CommandContext,input:unknown){return withTransaction(tx=>recordPayerDecisionInTransaction(tx,ctx,input));}
export async function recordPayerDecisionInTransaction(tx:Transaction,ctx:CommandContext,input:unknown,exceptionId?:string){
  const v=z.strictObject({...caseInput,...provenance,status:z.enum(["PENDING","APPROVED","PARTIAL","REJECTED"]),kind:z.enum(["PREAUTH","ENHANCEMENT","APPEAL"]),reason,approvedPaise:money,coPayBps:z.number().int().min(0).max(10000),allocation:allocationInput,documentIds:documents}).parse(input);const at=verifiedAt(v.verifiedAt);
  return insuranceCommand(tx,ctx,"decision",v,async s=>{
    if(s.episode.paymentRoute!=="INSURED")throw new DomainError("PRECONDITION","Converted self-pay case cannot accept a new payer decision");
    if(["PENDING","REJECTED"].includes(v.status)&&v.approvedPaise!=="0")throw new DomainError("VALIDATION","Pending or rejected decision cannot authorize money");
    const [policy]=await tx.select().from(insuranceEvents).where(and(eq(insuranceEvents.caseId,v.caseId),eq(insuranceEvents.kind,"POLICY"))).orderBy(desc(insuranceEvents.caseVersion)).limit(1);if(!policy)throw new DomainError("PRECONDITION","Record externally verified policy provenance first");
    const bill=await insuranceMoneyInTransaction(tx,s.episode);if(v.allocation.billRevision!==bill.revision||paise(v.allocation.netBillPaise)!==bill.netPaise)throw new DomainError("CONFLICT","Allocation must identify the current posted bill revision and amount");
    const r=computeResponsibilities({netBillPaise:bill.netPaise,eligibleBillPaise:paise(v.allocation.eligibleBillPaise),coPayBps:v.coPayBps,insurerAuthorizedPaise:paise(v.approvedPaise),...(v.allocation.verifiedPatientLiabilityPaise===undefined?{}:{verifiedPatientLiabilityPaise:paise(v.allocation.verifiedPatientLiabilityPaise)})});if(r.nonPayablePaise!==paise(v.allocation.nonPayablePaise))throw new DomainError("VALIDATION","Eligible plus non-payable amounts must match the bill");
    await validateCaseDocuments(tx,v.caseId,v.documentIds);const c=await bumpInsuranceCase(tx,v.caseId,true);
    const [d]=await tx.insert(insuranceDecisions).values({caseId:c.id,caseVersion:c.version,policyEventId:policy.id,status:v.status,kind:v.kind,verifiedBy:v.verifiedBy,verifiedAt:at,reference:v.reference,reason:v.reason,approvedPaise:paise(v.approvedPaise),coPayBps:v.coPayBps,allocation:{...v.allocation,billBasis:bill.allocationBasis},documentIds:v.documentIds,recordedBy:s.staff.id,recordedAt:new Date()}).returning();await insuranceAudit(tx,ctx,"decision-recorded",c.id,v.reason,c.version);return {id:d.id};
  },["ADMIN","BILLING","INSURANCE"],exceptionId);
}
export async function recordInsuranceFollowup(ctx:CommandContext,input:unknown){
  const v=z.strictObject({...caseInput,workId:z.uuid(),kind:z.enum(["PREAUTH","ENHANCEMENT","APPEAL"]),status:z.enum(["OPEN","COMPLETED"]),reference:text,reason}).parse(input);
  return withTransaction(tx=>insuranceCommand(tx,ctx,"followup",v,async s=>{
    const prior=await tx.select().from(insuranceEvents).where(and(eq(insuranceEvents.caseId,v.caseId),eq(insuranceEvents.kind,"FOLLOWUP"))).orderBy(desc(insuranceEvents.caseVersion));
    const old=prior.find(e=>e.payload.workId===v.workId);
    if((v.status==="COMPLETED"&&(!old||old.payload.status!=="OPEN"))||(old&&old.payload.kind!==v.kind))throw new DomainError("PRECONDITION","Complete only this case's current open follow-up with its original request type");
    if(v.status==="OPEN"&&old)throw new DomainError("CONFLICT","Use a new work item for a new staff follow-up; prior history remains");
    const c=await bumpInsuranceCase(tx,v.caseId);const [e]=await tx.insert(insuranceEvents).values({caseId:c.id,caseVersion:c.version,kind:"FOLLOWUP",reason:v.reason,payload:{workId:v.workId,kind:v.kind,status:v.status,reference:v.reference},recordedBy:s.staff.id,recordedAt:new Date()}).returning();await insuranceAudit(tx,ctx,"followup-recorded",c.id,v.reason,c.version);return {id:e.id};}));
}
export async function resolveTransferInsuranceTask(ctx:CommandContext,input:unknown){
  const v=z.strictObject({...caseInput,...provenance,taskId:z.uuid(),decisionId:z.uuid(),reason}).parse(input);const at=verifiedAt(v.verifiedAt);
  return withTransaction(tx=>insuranceCommand(tx,ctx,"transfer-resolved",v,async s=>{
    const [task]=await tx.select().from(transferInsuranceTasks).where(and(eq(transferInsuranceTasks.id,v.taskId),eq(transferInsuranceTasks.admissionId,s.episode.id)));
    const [d]=await tx.select().from(insuranceDecisions).where(and(eq(insuranceDecisions.id,v.decisionId),eq(insuranceDecisions.caseId,v.caseId)));
    if(!task||!d)throw new DomainError("FORBIDDEN","Resolution requires this case's transfer and decision");
    const [latest]=await tx.select().from(insuranceDecisions).where(eq(insuranceDecisions.caseId,v.caseId)).orderBy(desc(insuranceDecisions.caseVersion)).limit(1);
    if(d.id!==latest.id||d.status==="PENDING"||d.recordedAt<task.createdAt)throw new DomainError("PRECONDITION","Record a current external decision after the transfer");
    const c=await bumpInsuranceCase(tx,v.caseId);const [r]=await tx.insert(insuranceTransferResolutions).values({caseId:c.id,taskId:task.id,decisionId:d.id,verifiedBy:v.verifiedBy,verifiedAt:at,reference:v.reference,reason:v.reason,recordedBy:s.staff.id,recordedAt:new Date()}).returning();await insuranceAudit(tx,ctx,"transfer-resolved",c.id,v.reason,c.version);return {id:r.id};
  }));
}
export async function convertToSelfPay(ctx:CommandContext,input:unknown){return withTransaction(tx=>convertToSelfPayInTransaction(tx,ctx,input));}
export async function convertToSelfPayInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=z.strictObject({...caseInput,reason,decisionReference:text,verifiedBy:text,verifiedAt:z.iso.datetime(),allocation:z.strictObject({billRevision:z.number().int().positive(),netBillPaise:money,verifiedPatientLiabilityPaise:money,retainedInsurerLiabilityPaise:money,sourceReference:text})}).parse(input);const at=verifiedAt(v.verifiedAt);
  return insuranceCommand(tx,ctx,"self-pay",v,async s=>{
    if(s.episode.paymentRoute!=="INSURED")throw new DomainError("CONFLICT","Episode was already converted");
    const bill=await insuranceMoneyInTransaction(tx,s.episode),a=v.allocation;
    if(a.billRevision!==bill.revision||paise(a.netBillPaise)!==bill.netPaise)throw new DomainError("CONFLICT","Conversion must resolve the current posted bill");
    if(paise(a.retainedInsurerLiabilityPaise)!==bill.insurerCashPaise||paise(a.verifiedPatientLiabilityPaise)+paise(a.retainedInsurerLiabilityPaise)!==bill.netPaise)throw new DomainError("PRECONDITION","Explicit verified responsibility must resolve the whole bill and retain insurer cash; no insurer debt may disappear by changing route");
    const c=await bumpInsuranceCase(tx,v.caseId,true);const [conversion]=await tx.insert(insuranceConversions).values({caseId:c.id,caseVersion:c.version,reason:v.reason,decisionReference:v.decisionReference,verifiedBy:v.verifiedBy,verifiedAt:at,allocation:{...a,billBasis:bill.allocationBasis},recordedBy:s.staff.id,recordedAt:new Date()}).returning();
    await tx.update(admissions).set({paymentRoute:"SELF_PAY",version:sql`${admissions.version}+1`}).where(eq(admissions.id,s.episode.id));
    const pending=await pendingTransferTasks(tx,s.episode.id);for(const t of pending)await tx.insert(insuranceTransferResolutions).values({caseId:c.id,taskId:t.id,conversionId:conversion.id,verifiedBy:v.verifiedBy,verifiedAt:at,reference:v.decisionReference,reason:v.reason,recordedBy:s.staff.id,recordedAt:new Date()});
    await insuranceAudit(tx,ctx,"converted-to-self-pay",c.id,v.reason,c.version);return {id:conversion.id};
  },["ADMIN","BILLING"]);
}
async function pendingTransferTasks(tx:Transaction,admissionId:string){return tx.select({id:transferInsuranceTasks.id,reason:transferInsuranceTasks.reason,createdAt:transferInsuranceTasks.createdAt}).from(transferInsuranceTasks).leftJoin(insuranceTransferResolutions,eq(insuranceTransferResolutions.taskId,transferInsuranceTasks.id)).where(and(eq(transferInsuranceTasks.admissionId,admissionId),isNull(insuranceTransferResolutions.id)));}
export async function insuranceReviewInTransaction(tx:Transaction,ctx:CommandContext,caseId:string){
  const s=await insuranceCaseSource(tx,ctx,caseId),money=await insuranceMoneyInTransaction(tx,s.episode);
  const events=await tx.select().from(insuranceEvents).where(eq(insuranceEvents.caseId,caseId)).orderBy(desc(insuranceEvents.caseVersion));
  const decisions=await tx.select().from(insuranceDecisions).where(eq(insuranceDecisions.caseId,caseId)).orderBy(desc(insuranceDecisions.caseVersion));
  const docs=await tx.select().from(insuranceDocuments).where(eq(insuranceDocuments.caseId,caseId)).orderBy(desc(insuranceDocuments.setRevision));
  const [conversion]=await tx.select().from(insuranceConversions).where(eq(insuranceConversions.caseId,caseId));const d=decisions[0],policy=events.find(e=>e.kind==="POLICY");
  const actorIds=[...new Set([...events,...decisions,...docs,...(conversion?[conversion]:[])].map(row=>row.recordedBy))];
  const actors=actorIds.length?await tx.select({id:user.id,name:user.name}).from(user).where(inArray(user.id,actorIds)):[];
  const {responsibility}=await financialResponsibilityInTransaction(tx,s.episode);
  const stale=responsibility?.stale??false;
  const [identity]=await tx.select({name:patients.name,uhid:patients.uhid,bedLabel:beds.label}).from(patients).innerJoin(beds,eq(beds.id,s.episode.bedId)).where(eq(patients.id,s.episode.patientId));
  const settings=await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId,s.episode.hospitalId),eq(settingVersions.kind,"rule"))).orderBy(desc(settingVersions.version));
  const thresholds=(basis:string)=>{const v=settings.find(r=>r.payload.type==="alert"&&r.payload.basis===basis);return {percent:v?Number(v.payload.percent):80,configured:!!v};};
  const insurerThreshold=thresholds("insurer-limit"),depositThreshold=thresholds("patient-deposit");
  const alerts:string[]=[];
  if(!d||d.status==="PENDING")alerts.push("Pre-authorization awaiting external decision; staff follow-up required.");
  if(d?.status==="PARTIAL"||d?.status==="REJECTED")alerts.push(`${d.status=== "PARTIAL"?"Partial approval":"Rejected request"}: record the staff appeal, enhancement or financial allocation.`);
  // Denominator is the verified authorized limit; no or zero approval has no utilization ratio.
  if(!conversion&&d&&d.approvedPaise>0n&&money.netPaise*100n>=d.approvedPaise*BigInt(insurerThreshold.percent))alerts.push(`Posted bill has reached ${insurerThreshold.percent}% of recorded insurer authorization (${insurerThreshold.configured?"configured threshold":"source default; not configured"}); review enhancement with staff.`);
  if(responsibility&&!stale&&money.depositCashPaise>0n&&responsibility.patientPaise*100n>=money.depositCashPaise*BigInt(depositThreshold.percent))alerts.push(`Verified patient responsibility has reached ${depositThreshold.percent}% of patient deposit cash (${depositThreshold.configured?"configured threshold":"source default; not configured"}); staff review top-up.`);
  if(stale)alerts.push("Bill or policy changed: recorded allocation needs renewed staff review.");
  return {case:s.record,episode:{id:s.episode.id,ipCode:s.episode.ipCode,status:s.episode.status,paymentRoute:s.episode.paymentRoute,...identity},actors:Object.fromEntries(actors.map(a=>[a.id,a.name])),money,policy,events,decisions,documents:docs.map(({storageKey: _key,...doc})=>{void _key;return doc;}),conversion,responsibility,alerts,pendingTransfers:await pendingTransferTasks(tx,s.episode.id)};
}
export async function getInsuranceCase(ctx:CommandContext,caseId:string){return withTransaction(tx=>insuranceReviewInTransaction(tx,ctx,z.uuid().parse(caseId)));}
export async function insuranceWorkspace(ctx:CommandContext){return withTransaction(async tx=>{
  const staff=await insuranceOperator(tx,ctx,["ADMIN","BILLING","ADMISSION","INSURANCE"]);
  const rows=await tx.select({id:insuranceCases.id,version:insuranceCases.version,admissionId:admissions.id,ipCode:admissions.ipCode,name:patients.name,bedLabel:beds.label,paymentRoute:admissions.paymentRoute,assignedStaffId:insuranceCases.assignedStaffId}).from(insuranceCases).innerJoin(admissions,eq(admissions.id,insuranceCases.admissionId)).innerJoin(patients,eq(patients.id,admissions.patientId)).innerJoin(beds,eq(beds.id,admissions.bedId)).where(staff.role==="INSURANCE"?eq(insuranceCases.assignedStaffId,staff.id):undefined).orderBy(asc(admissions.registeredAt));
  const unassigned=staff.role==="INSURANCE"?[]:await tx.select({id:admissions.id,ipCode:admissions.ipCode,name:patients.name}).from(admissions).innerJoin(patients,eq(patients.id,admissions.patientId)).leftJoin(insuranceCases,eq(insuranceCases.admissionId,admissions.id)).where(and(eq(admissions.paymentRoute,"INSURED"),inArray(admissions.status,["PENDING","ADMITTED"]),isNull(insuranceCases.id)));
  const staffList=staff.role==="INSURANCE"?[]:await tx.select({id:user.id,name:user.name}).from(user).where(and(eq(user.role,"INSURANCE"),sql`coalesce(${user.banned},false)=false`));return {rows,unassigned,staffList};
});}
