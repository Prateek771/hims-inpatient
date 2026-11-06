import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, effectivePatients } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { lockBillingAdmission } from "../billing/commands";
import { mvpState } from "../mvp/dependencies";
import { mvpEvents } from "../mvp/schema";
import { appendAudit } from "../audit";
import { jsonSnapshot } from "../discharge/dependencies";
import { getFile, putFile } from "../file-store";
import { dischargeDocuments } from "./schema";
import { snapshotHash, assertDocumentSourceSize } from "./content";
import { renderDischargePDF } from "./pdf";
import { acquireTxLock } from "../locks";
import { rowsOf } from "../sql";
const byteHash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function authority(tx:Transaction,ctx:CommandContext,id:string) {
  const staff=await admissionOperator(ctx,["NURSE","ADMIN","BILLING"],tx),e=await lockBillingAdmission(tx,id);
  if(e.workflowVersion!==2)throw new DomainError("PRECONDITION","MVP document workflow required");
  if(staff.role==="NURSE"&&!rowsOf(await tx.execute(sql`select 1 from nurse_assignments a where a.admission_id=${e.id} and a.nurse_id=${staff.id} and not exists(select 1 from nurse_assignment_revocations r where r.assignment_id=a.id)`)).length)throw new DomainError("FORBIDDEN","Current assigned Nurse required");
  return {staff,e};
}
export async function mvpDocumentSource(tx:Transaction,e:typeof admissions.$inferSelect,kind:"CLINICAL"|"FINAL") {
  const state=await mvpState(tx,e);
  const latestExternal=state.exceptions.find(x=>x.action==="CLINICAL");
  const exception=state.exceptionalDeparture?state.exceptions.find(x=>x.id===state.exceptionalDeparture!.authorityId)??null:state.finance?null:state.exceptions.find(x=>x.action==="AUTHORITY"&&x.type!=="RETURN_TO_BED"&&x.billVersion===e.billRevision&&x.sourceId===latestExternal?.id)??null;
  const finance=e.status==="DISCHARGED"&&state.departure?.mvpFinanceId?(await tx.select().from(mvpEvents).where(eq(mvpEvents.id,state.departure.mvpFinanceId)))[0]:state.finance;
  const clinical=exception?state.exceptions.find(x=>x.id===exception.sourceId)??null:e.status==="DISCHARGED"&&finance?.clinicalId?(await tx.select().from(mvpEvents).where(eq(mvpEvents.id,finance.clinicalId)))[0]:state.clinical;
  if(!clinical||(kind==="FINAL"&&!finance&&!exception))throw new DomainError("PRECONDITION","Current clinical authority and, for final papers, final finances or explicit accountable exception are required");
  await acquireTxLock(tx, `document-identity:${e.patientId}`, "shared");
  const [patient]=await tx.select().from(effectivePatients).where(eq(effectivePatients.id,e.patientId));
  const [hospital]=await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId,e.hospitalId),sql`JSON_VALUE(${settingVersions.payload},'$.type')='hospital'`)).orderBy(desc(settingVersions.version)).limit(1);
  const money=kind==="FINAL"?z.object({bill:z.object({charges:z.array(z.unknown())}).passthrough()}).passthrough().parse(exception?.payload??finance!.payload):{bill:{charges:[]}};
  const source={schemaVersion:2 as const,kind,hospital:hospital?{id:hospital.id,version:hospital.version,payload:hospital.payload}:null,patient:patient??null,admission:{id:e.id,ipCode:e.ipCode,admittedAt:e.admittedAt},clinical,finance:kind==="FINAL"?finance:null,exception,money,status:exception?"ACCOUNTABLE_EXCEPTION_WITH_RETAINED_OBLIGATIONS":"AUTHORIZED_BEFORE_ACTUAL_EXIT"};
  assertDocumentSourceSize(source);
  return jsonSnapshot(source) as unknown as typeof source;
}
export type MvpSnapshot=Awaited<ReturnType<typeof mvpDocumentSource>>&{documentId:string;version:number;createdAt:string;verificationUrl:string;sourceHash:string};
export async function createMvpDocument(ctx:CommandContext,input:unknown) {
  const v=z.strictObject({admissionId:z.uuid(),kind:z.enum(["CLINICAL","FINAL"]),expectedReviewHash:z.string().length(64)}).parse(input);
  const prepared=await withTransaction(async tx=>{
    const {e}=await authority(tx,ctx,v.admissionId),state=await mvpState(tx,e);
    if(state.reviewHash!==v.expectedReviewHash)throw new DomainError("CONFLICT","Document sources changed; review again");
    const source=await mvpDocumentSource(tx,e,v.kind),sourceHash=snapshotHash(source);
    const [previous]=await tx.select().from(dischargeDocuments).where(eq(dischargeDocuments.admissionId,e.id)).orderBy(desc(dischargeDocuments.version)).limit(1);
    const documentId=randomUUID(),version=(previous?.version??0)+1,createdAt=new Date().toISOString();
    const base=new URL(process.env.BETTER_AUTH_URL??"");if(!["http:","https:"].includes(base.protocol)||base.username||base.password)throw new DomainError("PRECONDITION","Configured authenticated document origin required");
    const snapshot:MvpSnapshot={...source,documentId,version,createdAt,verificationUrl:new URL(`/documents/${documentId}/verify`,base).href,sourceHash};
    return {snapshot,hash:snapshotHash(snapshot),previous:previous?.id??null};
  });
  const bytes=await renderDischargePDF(prepared.snapshot,prepared.hash);
  return withTransaction(async tx=>{
    const {staff,e}=await authority(tx,ctx,v.admissionId),source=await mvpDocumentSource(tx,e,v.kind);
    if(snapshotHash(source)!==prepared.snapshot.sourceHash)throw new DomainError("CONFLICT","Document source changed during preparation");
    const [previous]=await tx.select().from(dischargeDocuments).where(eq(dischargeDocuments.admissionId,e.id)).orderBy(desc(dischargeDocuments.version)).limit(1);
    if((previous?.id??null)!==prepared.previous)throw new DomainError("CONFLICT","Another immutable document version was published; refresh");
    const storageKey=randomUUID(),pdfHash=byteHash(bytes);
    const {documentId,version,sourceHash,createdAt}=prepared.snapshot;
    await putFile(tx,"discharge",`${storageKey}.manifest.json`,Buffer.from(JSON.stringify({storageKey,documentId,admissionId:e.id,version,sourceHash,hash:prepared.hash,pdfHash,sizeBytes:bytes.length,createdAt})));
    await putFile(tx,"discharge",`${storageKey}.pdf`,bytes);
    await tx.insert(dischargeDocuments).values({id:documentId,admissionId:e.id,version,schemaVersion:2,kind:v.kind,replacesDocumentId:prepared.previous,sourceHash,hash:prepared.hash,snapshot:jsonSnapshot(prepared.snapshot),storageKey,pdfHash,sizeBytes:bytes.length,createdBy:staff.id,createdAt:new Date(createdAt)});
    await appendAudit(tx,ctx,{event:"mvp.document-created",entityType:"discharge-document",entityId:documentId,reason:`Immutable ${v.kind.toLowerCase()} papers authorized before actual exit`});return {documentId,version,hash:prepared.hash};
  });
}
export async function assertMvpDelivery(tx:Transaction,e:typeof admissions.$inferSelect,id:string,kind:"CLINICAL"|"FINAL",state:Awaited<ReturnType<typeof mvpState>>,exception=false) {
  const [row]=await tx.select().from(dischargeDocuments).where(and(eq(dischargeDocuments.id,id),eq(dischargeDocuments.admissionId,e.id)));
  if(!row||row.schemaVersion!==2||row.kind!==kind||row.sourceHash!==snapshotHash(await mvpDocumentSource(tx,e,kind))||row.hash!==snapshotHash(row.snapshot))throw new DomainError("CONFLICT","Deliver the exact current authorized document version");
  if(kind==="FINAL"&&!state.finance&&!exception)throw new DomainError("PRECONDITION","Current final finances required");
  try{const bytes=await getFile("discharge",`${row.storageKey}.pdf`,tx);
    if(!bytes||bytes.length!==row.sizeBytes||byteHash(bytes)!==row.pdfHash)throw Error();
  }catch{throw new DomainError("PRECONDITION","Original protected document must be intact before delivery");}
  return row;
}
