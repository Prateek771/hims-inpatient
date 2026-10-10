import "server-only";
import { createHash } from "node:crypto";
import { Client, Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { user } from "../schema/auth";
import { billingRequest } from "../billing/commands";
import { billingRequests } from "../billing/schema";
import { insuranceAudit, insuranceCaseSource, insuranceOperator, requestLock } from "./commands";
import { insuranceDecisions, insuranceDocuments, insuranceEvents } from "./schema";
import { readStoredDocument } from "./documents";
import { CHECKPOINT_SCHEMA, Command, createPaperworkGraph, MAX_PAPERWORK_REVISIONS, type PaperworkDecision } from "./paperwork-graph";
import { paperworkFollowups, paperworkPackets, paperworkProposals, paperworkReviews, paperworkRuns, type ManualSource, type PaperworkSource } from "./paperwork-schema";
const manualSource=z.strictObject({documentId:z.uuid(),text:z.string().min(1).max(4000).refine(v=>v.trim().length>0,"Manual text must contain words")});
const startInput=z.strictObject({caseId:z.uuid(),expectedDocumentVersion:z.number().int().nonnegative(),requestId:z.uuid(),manualSources:z.array(manualSource).max(20).default([])}).refine(v=>v.manualSources.reduce((n,s)=>n+s.text.length,0)<=24000&&new Set(v.manualSources.map(s=>s.documentId)).size===v.manualSources.length,"Manual text must be bounded and cite each document once");
const reviewInput=z.strictObject({runId:z.uuid().transform(id=>id.toLowerCase()),decision:z.enum(["ACCEPT","REQUEST_CHANGES","REJECT"]),comment:z.string().max(1000),expectedDocumentVersion:z.number().int().nonnegative(),expectedProposalRevision:z.number().int().min(1).max(3),requestId:z.uuid()}).refine(v=>v.decision==="ACCEPT"||v.comment.trim().length>=3,"Describe the requested change or rejection");
function canonical(v:unknown):unknown{return Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;}
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
async function source(tx:Transaction,ctx:CommandContext,caseId:string,manualSources:ManualSource[]):Promise<PaperworkSource>{
  const s=await insuranceCaseSource(tx,ctx,caseId);
  if(s.episode.paymentRoute!=="INSURED"||!["PENDING","ADMITTED"].includes(s.episode.status))throw new DomainError("PRECONDITION","Prepare and review paperwork only before departure for an open insured admission");
  const all=await tx.select().from(insuranceDocuments).where(eq(insuranceDocuments.caseId,caseId)).orderBy(asc(insuranceDocuments.id));
  const docs=all.filter(d=>!all.some(n=>n.replacesDocumentId===d.id));
  if(docs.length>100||docs.reduce((n,d)=>n+d.sizeBytes,0)>52428800)throw new DomainError("PRECONDITION","This bounded packet supports at most 100 current documents totaling 50 MiB");
  if(manualSources.some(m=>!docs.some(d=>d.id===m.documentId)))throw new DomainError("CONFLICT","Manual text must cite current documents of this case");
  const [policy]=await tx.select({id:insuranceEvents.id}).from(insuranceEvents).where(and(eq(insuranceEvents.caseId,caseId),eq(insuranceEvents.kind,"POLICY"))).orderBy(desc(insuranceEvents.caseVersion)).limit(1);
  const [decision]=await tx.select({id:insuranceDecisions.id}).from(insuranceDecisions).where(eq(insuranceDecisions.caseId,caseId)).orderBy(desc(insuranceDecisions.caseVersion)).limit(1);
  return {caseVersion:s.record.version,documentVersion:s.record.documentSetRevision,reviewRevision:s.record.reviewRevision,episodeVersion:s.episode.version,ipCode:s.episode.ipCode,policyId:policy?.id??null,decisionId:decision?.id??null,documents:docs.map(d=>({id:d.id,name:d.originalName,sha256:d.sha256})),manualSources};
}
/** Snapshot current purpose/metadata under the episode lock, then verify protected bytes outside it. */
async function checkFiles(ctx:CommandContext,caseId:string,manualSources:ManualSource[],expectedHash?:string){
  const checked=await withTransaction(async tx=>{
    const current=await source(tx,ctx,caseId,manualSources);
    if(expectedHash&&hash(current)!==expectedHash)throw new DomainError("CONFLICT","Case sources changed; start a new paperwork run");
    const docs=await tx.select().from(insuranceDocuments).where(eq(insuranceDocuments.caseId,caseId));
    return {current,docs:docs.filter(d=>current.documents.some(c=>c.id===d.id))};
  });
  for(const d of checked.docs)await readStoredDocument(d);
  return checked.current;
}
async function accessibleRun(tx:Transaction,ctx:CommandContext,runId:string){
  await insuranceOperator(tx,ctx);
  const [locator]=await tx.select({caseId:paperworkRuns.caseId}).from(paperworkRuns).where(eq(paperworkRuns.id,runId));
  if(!locator)throw new DomainError("FORBIDDEN","Paperwork run access denied");
  // A locator grants no authority. Mutable run state follows current purpose and episode lock.
  await insuranceCaseSource(tx,ctx,locator.caseId);
  const [run]=await tx.select().from(paperworkRuns).where(eq(paperworkRuns.id,runId)).for("update");
  if(!run)throw new DomainError("FORBIDDEN","Paperwork run access denied");return run;
}
async function fresh(tx:Transaction,ctx:CommandContext,run:typeof paperworkRuns.$inferSelect){
  const current=await source(tx,ctx,run.caseId,run.source.manualSources);
  if(hash(current)!==run.sourceHash)throw new DomainError("CONFLICT","Case, policy, admission or documents changed; start a new paperwork run from current sources");
}
async function projection(tx:Transaction,run:typeof paperworkRuns.$inferSelect){
  const proposals=await tx.select().from(paperworkProposals).where(eq(paperworkProposals.runId,run.id)).orderBy(asc(paperworkProposals.revision));
  const reviews=await tx.select().from(paperworkReviews).where(eq(paperworkReviews.runId,run.id)).orderBy(asc(paperworkReviews.revision));
  const [packet]=await tx.select().from(paperworkPackets).where(eq(paperworkPackets.runId,run.id));
  const followups=await tx.select().from(paperworkFollowups).where(eq(paperworkFollowups.runId,run.id));
  const ids=[...new Set([run.recordedBy,...proposals.map(p=>p.recordedBy),...reviews.map(r=>r.recordedBy),...followups.map(f=>f.ownerId)])];
  const actors=await tx.select({id:user.id,name:user.name}).from(user).where(inArray(user.id,ids));
  const [start]=await tx.select({requestId:billingRequests.requestId}).from(billingRequests).where(and(eq(billingRequests.actorId,run.recordedBy),eq(billingRequests.action,"paperwork.start"),eq(billingRequests.result,{id:run.id}))).limit(1);
  return {...run,proposals,reviews,packet:packet??null,followups,actors:Object.fromEntries(actors.map(a=>[a.id,a.name])),startRequestId:start?.requestId??null};
}
/** Dedicated lock connection and saver pool cannot consume the five-connection domain pool. */
async function serializeRun<T>(runId:string,fn:(saver:PostgresSaver,assertSession:()=>Promise<void>)=>Promise<T>){
  const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new DomainError("PRECONDITION","Paperwork database is unavailable");
  const client=new Client({connectionString,connectionTimeoutMillis:3000,statement_timeout:15000});
  const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:3000,statement_timeout:5000});
  pool.on("error",()=>console.error("Paperwork checkpoint connection unavailable"));
  let locked=false,lost=false;
  client.on("error",()=>{lost=true;});
  const assertSession=async()=>{
    if(lost||!locked)throw new DomainError("PRECONDITION","Paperwork session was lost; retry this same request after recovery");
    await client.query("select 1");
    if(lost)throw new DomainError("PRECONDITION","Paperwork session was lost; retry this same request after recovery");
  };
  try{
    await client.connect();await client.query("select pg_advisory_lock(hashtextextended($1,0))",[`paperwork:${runId}`]);locked=true;
    const {rows:[r]}=await client.query(`select array_agg(v order by v) versions from ${CHECKPOINT_SCHEMA}.checkpoint_migrations`);
    if(JSON.stringify(r.versions)!=="[0,1,2,3,4]")throw new DomainError("PRECONDITION","Paperwork checkpoint migrations need explicit owner setup");
    return await fn(new PostgresSaver(pool,undefined,{schema:CHECKPOINT_SCHEMA}),assertSession);
  }catch(e){if(e instanceof DomainError||e instanceof z.ZodError)throw e;throw new DomainError("PRECONDITION","Paperwork is unavailable; check explicit checkpoint setup and database access. Retry this same request after recovery; hospital work remains available.");}
  finally{if(locked)await client.query("select pg_advisory_unlock(hashtextextended($1,0))",[`paperwork:${runId}`]).catch(()=>{});await client.end();await pool.end();}
}
async function advance(ctx:CommandContext,runId:string,saver:PostgresSaver,assertSession:()=>Promise<void>){
  const initial=await withTransaction(async tx=>{const run=await accessibleRun(tx,ctx,runId);if(!["ACCEPTED","REJECTED"].includes(run.status))await fresh(tx,ctx,run);const [review]=run.pendingReviewId?await tx.select().from(paperworkReviews).where(eq(paperworkReviews.id,run.pendingReviewId)):[];return {run,review};});
  if(["ACCEPTED","REJECTED"].includes(initial.run.status))return getPaperworkRun(ctx,runId);
  await checkFiles(ctx,initial.run.caseId,initial.run.source.manualSources,initial.run.sourceHash);
  const graph=createPaperworkGraph(saver),config={configurable:{thread_id:runId},recursionLimit:30,callbacks:[]};
  let state=await graph.getState(config);
  if(!state.values.source){await graph.invoke({caseId:initial.run.caseId,source:initial.run.source,revision:0},config);state=await graph.getState(config);}
  else if(state.next.length&&!state.tasks.some(t=>t.interrupts?.length)){await graph.invoke(null,config);state=await graph.getState(config);}
  if(initial.review&&state.values.review?.reviewId!==initial.review.id){
    if(!state.tasks.some(t=>t.interrupts?.length)||state.values.revision!==initial.review.revision)throw new DomainError("CONFLICT","Checkpoint does not match the pending staff review");
    const checkpointId=state.config.configurable?.checkpoint_id;
    if(typeof checkpointId!=="string"||!checkpointId)throw new DomainError("CONFLICT","Pending review checkpoint identity is unavailable");
    // A predecessor can advance the head after lock loss; resume only the checked interrupt.
    await graph.invoke(new Command({resume:{decision:initial.review.decision,comment:initial.review.comment,reviewId:initial.review.id} as PaperworkDecision}),{...config,configurable:{thread_id:runId,checkpoint_ns:"",checkpoint_id:checkpointId}});state=await graph.getState(config);
  }
  const values=state.values as {source:PaperworkSource;revision:number;packet:typeof paperworkProposals.$inferSelect.packet;review?:PaperworkDecision};
  await checkFiles(ctx,initial.run.caseId,initial.run.source.manualSources,initial.run.sourceHash);
  await assertSession();
  return withTransaction(async tx=>{
    const run=await accessibleRun(tx,ctx,runId);await fresh(tx,ctx,run);
    await assertSession();
    if(hash(values.source)!==run.sourceHash)throw new DomainError("CONFLICT","Checkpoint source does not match this run");
    const [prior]=await tx.select().from(paperworkProposals).where(and(eq(paperworkProposals.runId,runId),eq(paperworkProposals.revision,values.revision)));
    if(prior&&prior.packetHash!==hash(values.packet))throw new DomainError("CONFLICT","Saved proposal differs from checkpoint");
    let proposal=prior;
    if(!proposal){[proposal]=await tx.insert(paperworkProposals).values({runId,revision:values.revision,packet:values.packet,packetHash:hash(values.packet),recordedBy:run.recordedBy}).returning();}
    const intent=initial.review;
    if(intent){
      if(run.pendingReviewId!==intent.id||values.review?.reviewId!==intent.id)throw new DomainError("CONFLICT","Pending staff decision changed");
      if(ctx.actor.type!=="staff"||ctx.actor.staffId!==intent.recordedBy)throw new DomainError("FORBIDDEN","Only the recorded reviewer may retry this pending decision");
      if(intent.decision==="ACCEPT"){
        if(values.revision!==intent.revision||state.next.length)throw new DomainError("CONFLICT","Accepted graph has not completed this reviewed revision");
        const [packet]=await tx.insert(paperworkPackets).values({runId,proposalId:proposal.id,reviewId:intent.id,packet:proposal.packet,recordedBy:intent.recordedBy}).returning();
        await tx.insert(paperworkFollowups).values({runId,packetId:packet.id,ownerId:intent.recordedBy,action:proposal.packet.staffNextAction,recordedBy:intent.recordedBy});
      }else if(intent.decision==="REQUEST_CHANGES"&&(values.revision!==intent.revision+1||!state.tasks.some(t=>t.interrupts?.length)))throw new DomainError("CONFLICT","Revised draft must pause for another human review");
      await insuranceAudit(tx,ctx,`paperwork-${intent.decision.toLowerCase()}`,run.caseId,intent.comment||"Human accepted local paperwork; nothing sent");
    }
    const status=intent?.decision==="ACCEPT"?"ACCEPTED":intent?.decision==="REJECT"?"REJECTED":"AWAITING_REVIEW";
    const [updated]=await tx.update(paperworkRuns).set({status,revision:values.revision,pendingReviewId:null}).where(eq(paperworkRuns.id,runId)).returning();
    await assertSession();
    return projection(tx,updated);
  });
}
export async function startPaperworkRun(ctx:CommandContext,input:unknown){
  const v=startInput.parse(input);
  const checked=await checkFiles(ctx,v.caseId,v.manualSources);
  const created=await withTransaction(async tx=>{
    await insuranceOperator(tx,ctx);await requestLock(tx,ctx,v.requestId);await insuranceCaseSource(tx,ctx,v.caseId);
    return billingRequest(tx,ctx,"paperwork.start",v,async()=>{
      const current=await source(tx,ctx,v.caseId,v.manualSources);
      if(hash(current)!==hash(checked))throw new DomainError("CONFLICT","Case sources changed during preparation; reload");
      if(current.documentVersion!==v.expectedDocumentVersion)throw new DomainError("CONFLICT","Current document set changed; reload the case");
      if(ctx.actor.type!=="staff")throw new DomainError("FORBIDDEN","Staff required");
      const [run]=await tx.insert(paperworkRuns).values({caseId:v.caseId,source:current,sourceHash:hash(current),recordedBy:ctx.actor.staffId}).returning();
      await insuranceAudit(tx,ctx,"paperwork-started",v.caseId,"Manual source text; no model or OCR provider configured");return {id:run.id};
    });
  });
  return serializeRun(created.id,(saver,assertSession)=>advance(ctx,created.id,saver,assertSession));
}
export async function getPaperworkRun(ctx:CommandContext,runId:string){const result=await withTransaction(async tx=>{
  const run=await accessibleRun(tx,ctx,z.uuid().parse(runId));let stale=false;
  try{await fresh(tx,ctx,run);}catch(e){if(e instanceof DomainError&&["CONFLICT","PRECONDITION"].includes(e.code))stale=true;else throw e;}
  return {...await projection(tx,run),stale};
});
  if(!result.stale)try{await checkFiles(ctx,result.caseId,result.source.manualSources,result.sourceHash);}catch(e){if(e instanceof DomainError&&["CONFLICT","PRECONDITION"].includes(e.code))result.stale=true;else throw e;}
  return result;
}
export async function listPaperworkRuns(ctx:CommandContext,caseId:string){return withTransaction(async tx=>{
  await insuranceCaseSource(tx,ctx,z.uuid().parse(caseId));
  return tx.select({id:paperworkRuns.id,status:paperworkRuns.status,revision:paperworkRuns.revision,recordedAt:paperworkRuns.recordedAt}).from(paperworkRuns).where(eq(paperworkRuns.caseId,caseId)).orderBy(desc(paperworkRuns.recordedAt)).limit(20);
});}
export async function reviewPaperworkRun(ctx:CommandContext,input:unknown){
  const v=reviewInput.parse(input);
  await withTransaction(tx=>accessibleRun(tx,ctx,v.runId));
  return serializeRun(v.runId,async(saver,assertSession)=>{
    const checked=await withTransaction(tx=>accessibleRun(tx,ctx,v.runId));
    if(!["ACCEPTED","REJECTED"].includes(checked.status))await checkFiles(ctx,checked.caseId,checked.source.manualSources,checked.sourceHash);
    await withTransaction(async tx=>{
      await insuranceOperator(tx,ctx);await requestLock(tx,ctx,v.requestId);const run=await accessibleRun(tx,ctx,v.runId);
      return billingRequest(tx,ctx,"paperwork.review",v,async()=>{
        if(run.status!=="AWAITING_REVIEW"||run.pendingReviewId)throw new DomainError("CONFLICT","Run is processing or already reviewed; reload its current result");
        await fresh(tx,ctx,run);
        if(run.source.documentVersion!==v.expectedDocumentVersion||run.revision!==v.expectedProposalRevision)throw new DomainError("CONFLICT","Review must bind the current document set and proposal revision");
        if(v.decision==="REQUEST_CHANGES"&&run.revision>=MAX_PAPERWORK_REVISIONS)throw new DomainError("PRECONDITION","Maximum three draft revisions reached; accept, reject or start a new run");
        if(ctx.actor.type!=="staff")throw new DomainError("FORBIDDEN","Staff required");
        const [review]=await tx.insert(paperworkReviews).values({runId:run.id,revision:run.revision,decision:v.decision,comment:v.comment,requestId:v.requestId,recordedBy:ctx.actor.staffId}).returning();
        await tx.update(paperworkRuns).set({status:"PROCESSING",pendingReviewId:review.id}).where(eq(paperworkRuns.id,run.id));return {id:review.id};
      });
    });
    return advance(ctx,v.runId,saver,assertSession);
  });
}
