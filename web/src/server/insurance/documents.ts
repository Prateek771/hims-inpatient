import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { insuranceDocuments } from "./schema";
import { bumpInsuranceCase, caseInput, insuranceAudit, insuranceCaseSource, insuranceCommand, insuranceOperator, requestLock } from "./commands";
export function documentSizeLimit(){
  const value=Number(process.env.HIMS_INSURANCE_MAX_BYTES??10485760);
  if(!Number.isSafeInteger(value)||value<1024||value>52428800)throw new DomainError("PRECONDITION","Document size configuration must be between 1 KiB and 50 MiB");return value;
}
export function insuranceStorageDirectory(){
  const project=existsSync(resolve(process.cwd(),"web/package.json"))?process.cwd():resolve(process.cwd(),"..");
  if(!existsSync(resolve(project,"web/package.json")))throw new DomainError("PRECONDITION","Protected storage requires the INS project folder");
  let synthetic=false;try{synthetic=/^hims_test(?:_ci_[a-z0-9]{8,40})?$/.test(decodeURIComponent(new URL(process.env.DATABASE_URL??"").pathname.slice(1)));}catch{throw new DomainError("PRECONDITION","Protected storage requires configured database identity");}
  if(synthetic!==(process.env.HIMS_INSURANCE_STORAGE==="synthetic"))throw new DomainError("PRECONDITION","Synthetic documents require explicitly isolated synthetic storage");
  if(process.env.HIMS_INSURANCE_STORAGE&&process.env.HIMS_INSURANCE_STORAGE!=="synthetic")throw new DomainError("PRECONDITION","Arbitrary protected storage paths are not supported");
  return resolve(project,synthetic?"tmp/insurance-test-storage":"private-uploads/insurance");
}
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function pathFor(key:string){return resolve(insuranceStorageDirectory(),`${z.uuid().parse(key)}.bin`);}
async function validateFile(file:File){
  if(!(file instanceof File)||file.size===0||file.size>documentSizeLimit())throw new DomainError("VALIDATION","Document size exceeds the configured limit or is empty");
  if(!file.name||file.name.length>180||/[\\/:\x00-\x1f\x7f]/.test(file.name)||file.name.startsWith(".")||file.name.endsWith(".")||file.name.endsWith(" "))throw new DomainError("VALIDATION","Use a plain document filename without paths");
  const bytes=Buffer.from(await file.arrayBuffer());
  const valid=file.type==="application/pdf"&&/\.pdf$/i.test(file.name)&&bytes.subarray(0,8).toString("ascii").match(/^%PDF-1\.[0-7]|^%PDF-2\.0/)&&bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
    ||file.type==="image/png"&&/\.png$/i.test(file.name)&&bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))&&bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082","hex"))
    ||file.type==="image/jpeg"&&/\.jpe?g$/i.test(file.name)&&bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(!valid)throw new DomainError("VALIDATION","Only matching PDF, JPEG and PNG signatures and file types are accepted");
  return {bytes,sha256:hash(bytes),sizeBytes:bytes.length,originalName:file.name,mime:file.type};
}
export async function readStoredDocument(row:typeof insuranceDocuments.$inferSelect){
  try{const p=pathFor(row.storageKey);const stat=await lstat(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.sizeBytes)throw Error();const bytes=await readFile(p);if(hash(bytes)!==row.sha256)throw Error();return bytes;}
  catch{throw new DomainError("PRECONDITION","Protected document is unavailable or changed; restore the verified file or attach a replacement");}
}
export async function attachCaseDocument(ctx:CommandContext,input:unknown){return withTransaction(tx=>attachCaseDocumentInTransaction(tx,ctx,input));}
export async function attachCaseDocumentInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=z.strictObject({...caseInput,file:z.instanceof(File),replacesDocumentId:z.uuid().optional()}).parse(input);
  // Do not read supplied file contents until current persisted access has been established.
  await insuranceOperator(tx,ctx);await requestLock(tx,ctx,v.requestId);await insuranceCaseSource(tx,ctx,v.caseId);
  const file=await validateFile(v.file);
  const bound={caseId:v.caseId,expectedCaseVersion:v.expectedCaseVersion,requestId:v.requestId,replacesDocumentId:v.replacesDocumentId,sha256:file.sha256,sizeBytes:file.sizeBytes,originalName:file.originalName,mime:file.mime};
  const result=await insuranceCommand(tx,ctx,"document-attached",bound,async s=>{
    if(v.replacesDocumentId){const [original]=await tx.select().from(insuranceDocuments).where(and(eq(insuranceDocuments.id,v.replacesDocumentId),eq(insuranceDocuments.caseId,v.caseId)));if(!original)throw new DomainError("FORBIDDEN","Replace only a document from this case");const [newer]=await tx.select().from(insuranceDocuments).where(eq(insuranceDocuments.replacesDocumentId,original.id));if(newer)throw new DomainError("CONFLICT","This document already has a replacement; replace its latest version");}
    const storageKey=randomUUID(),directory=insuranceStorageDirectory();await mkdir(directory,{recursive:true});
    const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new DomainError("PRECONDITION","Protected storage must be a regular project directory");
    const staging=resolve(directory,`${storageKey}.staging`);await writeFile(staging,file.bytes,{flag:"wx",mode:0o600});await rename(staging,pathFor(storageKey));
    // File exists before committed metadata. Transaction failures may leave an unreferenced
    // generated file; never delete on ambiguous COMMIT failure and break a committed record.
    const c=await bumpInsuranceCase(tx,v.caseId,false,true);
    const [doc]=await tx.insert(insuranceDocuments).values({caseId:c.id,setRevision:c.documentSetRevision,replacesDocumentId:v.replacesDocumentId,storageKey,sha256:file.sha256,sizeBytes:file.sizeBytes,originalName:file.originalName,mime:file.mime,recordedBy:s.staff.id,recordedAt:new Date()}).returning();
    await insuranceAudit(tx,ctx,"document-attached",c.id,v.replacesDocumentId?"Immutable replacement attached; original retained":"Staff-approved case material attached",c.version);return {id:doc.id};
  });
  const [doc]=await tx.select().from(insuranceDocuments).where(and(eq(insuranceDocuments.id,result.id),eq(insuranceDocuments.caseId,v.caseId)));
  if(!doc)throw new DomainError("CONFLICT","Document retry record is inconsistent");await readStoredDocument(doc);return result;
}
export async function downloadCaseDocument(ctx:CommandContext,caseId:string,documentId:string){return withTransaction(async tx=>{
  await insuranceCaseSource(tx,ctx,z.uuid().parse(caseId));
  const [doc]=await tx.select().from(insuranceDocuments).where(and(eq(insuranceDocuments.id,z.uuid().parse(documentId)),eq(insuranceDocuments.caseId,caseId)));
  if(!doc)throw new DomainError("FORBIDDEN","Document access denied");const bytes=await readStoredDocument(doc);
  await insuranceAudit(tx,ctx,"document-downloaded",caseId,`Protected case document ${doc.id}`);return {bytes,mime:doc.mime,name:doc.originalName};
});}
