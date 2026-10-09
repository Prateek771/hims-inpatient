import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, effectivePatients as patients } from "../admissions/schema";
import { user } from "../schema/auth";
import { careBillingEvents, careTasks, clinicalOrders, clinicalTaskEvents } from "../clinical/schema";
import { requestKey } from "../clinical/commands";
import { actorColumns, billingRequest, bumpBillRevision, lockBillingAdmission, postChargeInTransaction, resolveBillableRate } from "../billing/commands";
import { chargeFinalizations, chargeReversals, charges } from "../billing/schema";
import { appendAudit } from "../audit";
import { labDispositions, labProcessing, labReportAddenda, labReports, labSamples } from "./schema";
const barcode=z.string().trim().regex(/^SMP-[A-F0-9]{32}$/,"Scan an actual sample label");
const base={orderId:z.uuid(),requestId:z.uuid()};
const scanInput=z.strictObject({...base,barcode:barcode.optional()});
const reportInput=z.strictObject({...base,barcode:barcode.optional(),result:z.string().trim().min(1).max(5000),reportDocumentId:z.uuid().optional()});
const reason=z.string().trim().min(3).max(500);
async function operator(tx:Transaction,ctx:CommandContext) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
  return admissionOperator(ctx,["LAB"],tx);
}
async function orderSource(tx:Transaction,orderId:string,active=false) {
  const [locator]=await tx.select({admissionId:clinicalOrders.admissionId}).from(clinicalOrders).where(eq(clinicalOrders.id,orderId));
  if(!locator)throw new DomainError("FORBIDDEN","Diagnostic order access denied");
  const e=await lockBillingAdmission(tx,locator.admissionId);
  const [o]=await tx.select().from(clinicalOrders).where(eq(clinicalOrders.id,orderId));
  const [task]=await tx.select().from(careTasks).where(and(eq(careTasks.orderId,o.id),eq(careTasks.admissionId,e.id),eq(careTasks.ownerRole,"LAB")));
  if(!["LAB","RADIOLOGY"].includes(o.kind)||!task)throw new DomainError("FORBIDDEN","Access requires this persisted diagnostic task");
  if(active&&e.status!=="ADMITTED")throw new DomainError("PRECONDITION","New diagnostic work requires an active admission");
  const [sample]=await tx.select().from(labSamples).where(eq(labSamples.orderId,o.id));
  const [processing]=await tx.select().from(labProcessing).where(eq(labProcessing.orderId,o.id));
  const [report]=await tx.select().from(labReports).where(eq(labReports.orderId,o.id));
  const [disposition]=await tx.select().from(labDispositions).where(eq(labDispositions.orderId,o.id));
  const [stop]=await tx.select().from(clinicalTaskEvents).where(and(eq(clinicalTaskEvents.orderId,o.id),eq(clinicalTaskEvents.status,"STOPPED")));
  return {e,o,sample,processing,report,disposition,stop};
}
type Source=Awaited<ReturnType<typeof orderSource>>;
function bindScan(s:Source,scanned?:string) {
  if(s.o.kind==="RADIOLOGY") {if(scanned)throw new DomainError("VALIDATION","Radiology work has no specimen barcode");return;}
  if(!s.sample||scanned!==s.sample.barcode||s.sample.orderId!==s.o.id||s.sample.admissionId!==s.e.id||s.sample.patientId!==s.e.patientId)throw new DomainError("VALIDATION","Scanned sample does not match this order, patient and admission");
}
async function audit(tx:Transaction,ctx:CommandContext,event:string,id:string,why:string){await appendAudit(tx,ctx,{event:`lab.${event}`,entityType:"diagnostic-work",entityId:id,reason:why});}
// Global shared lock -> current staff -> actor/request -> admission. The admission
// serializes these one-order sources with Doctor stop/resolution and bill changes.
async function command(tx:Transaction,ctx:CommandContext,action:string,value:{orderId:string;requestId:string},apply:(s:Source,staffId:string)=>Promise<{id:string}>) {
  requestKey(ctx,value.requestId);const staff=await operator(tx,ctx);
  // Revalidate persisted purpose access even when billingRequest returns a cached response.
  const [locator]=await tx.select().from(clinicalOrders).innerJoin(careTasks,and(eq(careTasks.orderId,clinicalOrders.id),eq(careTasks.admissionId,clinicalOrders.admissionId),eq(careTasks.ownerRole,"LAB"))).where(and(eq(clinicalOrders.id,value.orderId),inArray(clinicalOrders.kind,["LAB","RADIOLOGY"])));
  if(!locator)throw new DomainError("FORBIDDEN","Diagnostic order access denied");
  return billingRequest(tx,ctx,action,value,async()=>apply(await orderSource(tx,value.orderId),staff.id));
}
export async function collectSample(ctx:CommandContext,input:unknown){return withTransaction(tx=>collectSampleInTransaction(tx,ctx,input));}
export async function collectSampleInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=z.strictObject(base).parse(input);
  const result=await command(tx,ctx,"lab.collect",v,async(s,id)=>{
    if(s.o.kind!=="LAB")throw new DomainError("VALIDATION","Radiology does not require a specimen");
    if(s.sample)return {id:s.sample.id};
    if(s.e.status!=="ADMITTED"||s.stop||s.disposition)throw new DomainError("PRECONDITION","Cannot collect a new sample for stopped or inactive work");
    const sampleId=crypto.randomUUID();
    const [sample]=await tx.insert(labSamples).values({id:sampleId,orderId:s.o.id,admissionId:s.e.id,patientId:s.e.patientId,barcode:`SMP-${sampleId.replaceAll("-","").toUpperCase()}`,signedBy:id,signedAt:new Date()}).returning();
    await audit(tx,ctx,"sample-collected",sample.id,"Human collection; persisted patient, episode and order binding");return {id:sample.id};
  });
  return (await tx.select({id:labSamples.id,barcode:labSamples.barcode}).from(labSamples).where(eq(labSamples.id,result.id)))[0];
}
export async function startLabProcessing(ctx:CommandContext,input:unknown){return withTransaction(tx=>startLabProcessingInTransaction(tx,ctx,input));}
export async function startLabProcessingInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=scanInput.parse(input);return command(tx,ctx,"lab.processing",v,async(s,id)=>{
    bindScan(s,v.barcode);if(s.processing)return {id:s.processing.id};
    if(s.e.status!=="ADMITTED"||s.disposition||s.stop)throw new DomainError("PRECONDITION","Doctor-stopped work cannot begin new processing; retained collected material needs staff review");
    const [p]=await tx.insert(labProcessing).values({orderId:s.o.id,admissionId:s.e.id,sampleId:s.sample?.id,signedBy:id,signedAt:new Date()}).returning();await audit(tx,ctx,"processing-started",p.id,"Human confirmed diagnostic processing");return {id:p.id};
  });
}
async function finalizeSource(tx:Transaction,ctx:CommandContext,s:Source,resolve=false,why?:string,exceptionId?:string) {
  const [source]=await tx.select().from(careBillingEvents).where(eq(careBillingEvents.orderId,s.o.id)).for("update");
  if(!source||source.admissionId!==s.e.id||source.category!==s.o.kind.toLowerCase())throw new DomainError("CONFLICT","Diagnostic economic source linkage is inconsistent");
  if(s.disposition)throw new DomainError("PRECONDITION","Unperformed work has an attributable disposition");
  if(!source.tariffVersionId&&!resolve)return;
  let rate:Awaited<ReturnType<typeof resolveBillableRate>>;
  try{rate=await resolveBillableRate(tx,{itemId:source.itemId,eventKind:source.category,unit:source.unit,quantity:source.quantity,...(source.tariffVersionId?{pinnedVersionId:source.tariffVersionId}:{})});}
  catch(error){if(!(error instanceof DomainError))throw error;await tx.update(careBillingEvents).set({resolutionReason:error.message}).where(eq(careBillingEvents.id,source.id));if(resolve)throw error;return;}
  const chargeInput={admissionId:s.e.id,sourceEventId:source.id,category:source.category,itemId:source.itemId,quantity:source.quantity,unit:source.unit,tariffVersionId:rate.version.id};
  await postChargeInTransaction(tx,ctx,{...chargeInput,status:"PENDING"},rate,exceptionId);
  await postChargeInTransaction(tx,ctx,{...chargeInput,status:"FINAL"},rate,exceptionId);
  await tx.update(careBillingEvents).set({state:"POSTED",tariffVersionId:rate.version.id,...(why?{resolutionReason:why}:{})}).where(eq(careBillingEvents.id,source.id));
}
export async function recordLabReport(ctx:CommandContext,input:unknown){return withTransaction(tx=>recordLabReportInTransaction(tx,ctx,input));}
export async function recordLabReportInTransaction(tx:Transaction,ctx:CommandContext,input:unknown,exceptionId?:string){
  const v=reportInput.parse(input);
  return command(tx,ctx,"lab.report",v,async(s,id)=>{
    if(v.reportDocumentId)throw new DomainError("PRECONDITION","Protected report-file storage is not available; record the human text report. An arbitrary document UUID cannot be verified.");
    bindScan(s,v.barcode);
    if(s.report){if(s.report.result!==v.result)throw new DomainError("CONFLICT","Original report is immutable; append a reasoned addendum");return {id:s.report.id};}
    if(!s.processing||s.disposition)throw new DomainError("PRECONDITION","Confirm actual diagnostic processing before recording its human report");
    if(s.e.status!=="ADMITTED") {
      if(!exceptionId)throw new DomainError("PRECONDITION","Historical report requires attributable source-bound authority");
      const {requireCorrectionAuthority,actualEpisodeDeparture}=await import("../discharge/exceptions");
      await requireCorrectionAuthority(tx,s.e,exceptionId,"LAB_REPORT",s.o.id);
      const departure=await actualEpisodeDeparture(tx,s.e.id);
      if(!departure||s.processing.signedAt>departure)throw new DomainError("PRECONDITION","Only diagnostic work actually processed before departure may be reported later");
    }
    const signedAt=new Date();
    const [r]=await tx.insert(labReports).values({orderId:s.o.id,admissionId:s.e.id,sampleId:s.sample?.id,result:v.result,signedBy:id,signedAt}).returning();
    await tx.insert(clinicalTaskEvents).values({orderId:s.o.id,status:"COMPLETED",reason:"Human diagnostic report recorded; billing state is separate",signedBy:id,signedAt}).onConflictDoNothing();
    await finalizeSource(tx,ctx,s,false,undefined,exceptionId);await audit(tx,ctx,"report-signed",r.id,"Human immutable result; no clinical interpretation by software");return {id:r.id};
  });
}
export async function addLabReportAddendum(ctx:CommandContext,input:unknown){
  const v=z.strictObject({...base,reportId:z.uuid(),text:z.string().trim().min(1).max(5000),reason}).parse(input);
  return withTransaction(tx=>command(tx,ctx,"lab.addendum",v,async(s,id)=>{
    if(s.e.status!=="ADMITTED")throw new DomainError("PRECONDITION","A new closed report addendum requires specific administrator routing");
    if(!s.report||s.report.id!==v.reportId)throw new DomainError("FORBIDDEN","Addendum requires this order's actual report");
    const [a]=await tx.insert(labReportAddenda).values({reportId:s.report.id,text:v.text,reason:v.reason,signedBy:id,signedAt:new Date()}).returning();await audit(tx,ctx,"report-addendum",a.id,v.reason);return {id:a.id};
  }));
}
export async function resolveLabBilling(ctx:CommandContext,input:unknown){return withTransaction(tx=>resolveLabBillingInTransaction(tx,ctx,input));}
export async function resolveLabBillingInTransaction(tx:Transaction,ctx:CommandContext,input:unknown,exceptionId?:string){
  const v=z.strictObject({...base,reason}).parse(input);
  return command(tx,ctx,"lab.billing-resolved",v,async(s)=>{
    if(!s.report)throw new DomainError("PRECONDITION","Diagnostic fee reconciliation requires the actual human report");
    if(s.e.status!=="ADMITTED") {
      if(!exceptionId)throw new DomainError("PRECONDITION","Closed diagnostic price reconciliation requires specific source authority");
      const {requireCorrectionAuthority,actualEpisodeDeparture}=await import("../discharge/exceptions");
      await requireCorrectionAuthority(tx,s.e,exceptionId,"LAB_BILLING",s.o.id);
      const departure=await actualEpisodeDeparture(tx,s.e.id);
      if(!departure||!s.processing||s.processing.signedAt>departure)throw new DomainError("PRECONDITION","Only diagnostic work performed before departure can be reconciled later");
    }
    await finalizeSource(tx,ctx,s,true,v.reason,exceptionId);return {id:s.report.id};
  });
}
export async function disposeUnperformedLabOrder(ctx:CommandContext,input:unknown){return withTransaction(tx=>disposeUnperformedLabOrderInTransaction(tx,ctx,input));}
export async function disposeUnperformedLabOrderInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=z.strictObject({...base,reason}).parse(input);return command(tx,ctx,"lab.unperformed",v,async(s,id)=>{
    if(s.disposition)return {id:s.disposition.id};
    if(!s.stop||s.sample||s.processing||s.report||s.e.status!=="ADMITTED")throw new DomainError("PRECONDITION","Unperformed disposition requires Doctor-stopped work with no collection, processing or report");
    const [source]=await tx.select().from(careBillingEvents).where(eq(careBillingEvents.orderId,s.o.id)).for("update");
    if(!source||source.admissionId!==s.e.id||source.category!==s.o.kind.toLowerCase())throw new DomainError("CONFLICT","Original diagnostic source is inconsistent");
    const [charge]=await tx.select().from(charges).where(and(eq(charges.sourceEventId,source.id),eq(charges.admissionId,s.e.id)));
    let reversalId:string|undefined;
    if(charge){
      const finalized=await tx.select().from(chargeFinalizations).where(eq(chargeFinalizations.chargeId,charge.id));const prior=await tx.select().from(chargeReversals).where(eq(chargeReversals.chargeId,charge.id));
      if(charge.initialStatus!=="PENDING"||finalized.length||prior.length)throw new DomainError("PRECONDITION","Performed/finalized or adjusted charges require later financial review");
      if(charge.amountPaise>0n)reversalId=(await tx.insert(chargeReversals).values({chargeId:charge.id,amountPaise:charge.amountPaise,reason:v.reason,...actorColumns(ctx)}).returning())[0].id;
      await bumpBillRevision(tx,s.e.id);
    }
    const [d]=await tx.insert(labDispositions).values({orderId:s.o.id,admissionId:s.e.id,stopEventId:s.stop.id,reversalId,reason:v.reason,signedBy:id,signedAt:new Date()}).returning();await audit(tx,ctx,"unperformed-disposition",d.id,v.reason);return {id:d.id};
  });
}
export async function getLabOrder(ctx:CommandContext,orderId:string){
  return withTransaction(async tx=>{await operator(tx,ctx);const s=await orderSource(tx,z.uuid().parse(orderId));
    const [identity]=await tx.select({name:patients.name,uhid:patients.uhid,sex:patients.sex,bedLabel:beds.label}).from(patients).innerJoin(beds,eq(beds.id,s.e.bedId)).where(eq(patients.id,s.e.patientId));
    const addenda=s.report?await tx.select().from(labReportAddenda).where(eq(labReportAddenda.reportId,s.report.id)).orderBy(asc(labReportAddenda.signedAt)):[];
    const [source]=await tx.select().from(careBillingEvents).where(eq(careBillingEvents.orderId,s.o.id));
    const [charge]=source?await tx.select().from(charges).where(eq(charges.sourceEventId,source.id)):[];
    const [finalized]=charge?await tx.select().from(chargeFinalizations).where(eq(chargeFinalizations.chargeId,charge.id)):[];
    const signers=[...new Set([s.sample,s.processing,s.report,s.disposition,...addenda].filter(Boolean).map(r=>r!.signedBy))];
    const names=signers.length?await tx.select({id:user.id,name:user.name}).from(user).where(inArray(user.id,signers)):[];
    return {order:s.o,episode:{id:s.e.id,ipCode:s.e.ipCode,status:s.e.status,...identity},actors:Object.fromEntries(names.map(n=>[n.id,n.name])),sample:s.sample,processing:s.processing,report:s.report,addenda,stop:s.stop,disposition:s.disposition,billingState:s.disposition?"UNPERFORMED":!charge?"UNRESOLVED":charge.initialStatus==="FINAL"||finalized?"FINAL":"PENDING",billingIssue:source?.resolutionReason};
  });
}
export async function getSampleLabel(ctx:CommandContext,sampleId:string){
  return withTransaction(async tx=>{await operator(tx,ctx);const [sample]=await tx.select().from(labSamples).where(eq(labSamples.id,z.uuid().parse(sampleId)));if(!sample)throw new DomainError("FORBIDDEN","Sample access denied");const s=await orderSource(tx,sample.orderId);if(s.sample?.id!==sample.id||sample.patientId!==s.e.patientId)throw new DomainError("FORBIDDEN","Sample source mismatch");
    const [p]=await tx.select({name:patients.name,uhid:patients.uhid}).from(patients).where(eq(patients.id,s.e.patientId));const [signer]=await tx.select({name:user.name}).from(user).where(eq(user.id,sample.signedBy));return {sample,patient:p,signerName:signer.name,ipCode:s.e.ipCode,test:s.o.requestedItem,orderId:s.o.id};
  });
}
export async function lookupSample(ctx:CommandContext,input:unknown){const v=z.strictObject({orderId:z.uuid(),barcode:z.string().trim().min(1).max(100)}).parse(input);return withTransaction(async tx=>{await operator(tx,ctx);const s=await orderSource(tx,v.orderId);bindScan(s,v.barcode);if(!s.sample)throw new DomainError("VALIDATION","No specimen for this order");return {id:s.sample.id,orderId:s.o.id,ipCode:s.e.ipCode};});}
export async function labWorkspace(ctx:CommandContext){return withTransaction(async tx=>{await operator(tx,ctx);return tx.select({id:clinicalOrders.id,requestedItem:clinicalOrders.requestedItem,kind:clinicalOrders.kind,signedAt:clinicalOrders.signedAt,admissionId:admissions.id,ipCode:admissions.ipCode,name:patients.name,bedLabel:beds.label,sampleId:labSamples.id,processingId:labProcessing.id,reportId:labReports.id,dispositionId:labDispositions.id,stopId:clinicalTaskEvents.id}).from(clinicalOrders).innerJoin(careTasks,and(eq(careTasks.orderId,clinicalOrders.id),eq(careTasks.ownerRole,"LAB"))).innerJoin(admissions,eq(admissions.id,clinicalOrders.admissionId)).innerJoin(patients,eq(patients.id,admissions.patientId)).innerJoin(beds,eq(beds.id,admissions.bedId)).leftJoin(labSamples,eq(labSamples.orderId,clinicalOrders.id)).leftJoin(labProcessing,eq(labProcessing.orderId,clinicalOrders.id)).leftJoin(labReports,eq(labReports.orderId,clinicalOrders.id)).leftJoin(labDispositions,eq(labDispositions.orderId,clinicalOrders.id)).leftJoin(clinicalTaskEvents,and(eq(clinicalTaskEvents.orderId,clinicalOrders.id),eq(clinicalTaskEvents.status,"STOPPED"))).where(and(inArray(clinicalOrders.kind,["LAB","RADIOLOGY"]),eq(admissions.status,"ADMITTED"))).orderBy(desc(clinicalOrders.signedAt));});}
