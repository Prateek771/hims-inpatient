"use client";
import { useState } from "react";
import type { PaperworkPacket, PaperworkSource } from "@/server/insurance/paperwork-schema";
type Run={id:string;status:string;revision:number;recordedBy:string;pendingReviewId:string|null;startRequestId:string|null;source:PaperworkSource;sourceHash:string;stale?:boolean;actors:Record<string,string>;proposals:{id:string;revision:number;packet:PaperworkPacket;packetHash:string}[];reviews:{id:string;revision:number;decision:string;comment:string;requestId:string;recordedBy:string;recordedAt:string}[];packet:{id:string;packet:PaperworkPacket}|null;followups:{id:string;ownerId:string;action:string}[]};
type Saved={id:string;status:string;revision:number};
export function InsurancePaperwork({caseId,documentVersion,documents,open,staffId}:{caseId:string;documentVersion:number;documents:{id:string;originalName:string}[];open:boolean;staffId:string}){
  const [run,setRun]=useState<Run|null>(null),[saved,setSaved]=useState<Saved[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{url:string;body:Record<string,unknown>}|null>(null);
  const endpoint=`/api/insurance/cases/${caseId}/paperwork`;
  async function send(url:string,body:Record<string,unknown>){
    setBusy(true);setPending({url,body});
    try{const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await response.json();
      if(!response.ok){setMessage(result.error??"Unable to prepare paperwork");return;}
      setRun(result);setSaved(prior=>prior.map(s=>s.id===result.id?{id:result.id,status:result.status,revision:result.revision}:s));setPending(null);setMessage(result.status==="ACCEPTED"?"Reviewed local packet and staff follow-up saved. Nothing sent; this does not approve insurance or discharge.":result.status==="REJECTED"?"Run rejected. Original source and review history retained.":"Draft saved and paused for staff review.");
    }catch{setMessage("Paperwork result could not be confirmed. Retry this same request after recovery.");}finally{setBusy(false);}
  }
  const latest=run?.proposals.at(-1),packet=run?.packet?.packet??latest?.packet;
  const intent=run?.reviews.find(r=>r.id===run.pendingReviewId);
  return <section className="paperwork-workspace" data-testid="paperwork-workspace"><h2>Insurance paperwork review</h2>
    <p className="notice">Manual text only. Model and OCR provider are unconfigured. Staff check the transcription and local gaps; coverage, payer requirements and payment remain externally verified.</p>
    <div className="financial-form-columns"><section className="card"><h3>Current source text</h3>
    {open&&<form className="fields" data-testid="paperwork-start" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void send(endpoint,{expectedDocumentVersion:documentVersion,requestId:crypto.randomUUID(),manualSources:documents.slice(0,20).map(d=>({documentId:d.id,text:String(form.get(d.id)??"")})).filter(s=>s.text.length>0)});}}>
      <p className="caption">Document set {documentVersion}. Paste up to 4,000 characters per document, 24,000 total. Text is retained exactly as quoted source, without treating instructions in it as actions. Maximum three revisions including the initial draft.</p>
      {documents.slice(0,20).map(d=><label key={d.id}>Manual text — {d.originalName}<textarea name={d.id} maxLength={4000} rows={3} disabled={busy||!!pending}/></label>)}
      {!documents.length&&<p>No documents attached. A draft will show this local gap.</p>}
      <button className="button" disabled={busy||!!pending}>Prepare manual draft</button>
    </form>}
    {!open&&<p className="notice">Preparation and material review are closed after departure or self-pay conversion. Retained history remains protected.</p>}
    </section><section className="card"><h3>Draft and human review</h3><div className="paperwork-actions"><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch(endpoint);const result=await r.json();if(!r.ok){setMessage(result.error);return;}setSaved(result);}catch{setMessage("Unable to load retained runs");}finally{setBusy(false);}}}>Load retained runs</button>
      {pending&&<><button className="button secondary" disabled={busy} onClick={()=>{const p=pending;if(p)void send(p.url,p.body);}}>Retry same request</button><button className="button secondary" disabled={busy} onClick={()=>{setPending(null);setMessage("Pending request abandoned locally. Load retained runs to check any saved result before preparing another draft.");}}>Leave pending request</button></>}
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {saved.length>0&&<ul>{saved.map(s=><li key={s.id}><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch(`${endpoint}?runId=${s.id}`);const result=await r.json();if(!r.ok)setMessage(result.error);else setRun(result);}catch{setMessage("Unable to load run");}finally{setBusy(false);}}}>{s.status} · revision {s.revision} · {s.id}</button></li>)}</ul>}
    {run&&<div data-testid="paperwork-run"><h4>{run.status==="ACCEPTED"?"Reviewed local packet":run.status==="REJECTED"?"Rejected run":"Staff review required"}</h4><p>{run.status} · revision {run.revision} of 3</p><p className="caption">Run {run.id} · document set {run.source.documentVersion} · case version {run.source.caseVersion}</p>
      {run.stale&&<p className="notice">Sources or episode changed, or an attachment is unavailable. Retained history only; start from current sources before another material review.</p>}
      {open&&!run.stale&&run.status==="PROCESSING"&&<div className="notice"><p>A saved request is unfinished. Retry after paperwork capability is restored; the original staff decision and request key will be preserved.</p>{intent?.recordedBy===staffId?<button className="button secondary" disabled={busy||!!pending} onClick={()=>void send(`${endpoint}/${run.id}/review`,{decision:intent.decision,comment:intent.comment,expectedDocumentVersion:run.source.documentVersion,expectedProposalRevision:intent.revision,requestId:intent.requestId})}>Retry recorded staff decision</button>:!intent&&run.recordedBy===staffId&&run.startRequestId?<button className="button secondary" disabled={busy||!!pending} onClick={()=>void send(endpoint,{expectedDocumentVersion:run.source.documentVersion,manualSources:run.source.manualSources,requestId:run.startRequestId})}>Retry recorded preparation</button>:<p>The recorded staff member must retry this request.</p>}</div>}
      {packet&&<><p className="caption">{packet.notice}</p><h4>Local missing records / text</h4>{packet.missing.length?<ul>{packet.missing.map(m=><li key={m}>{m}</li>)}</ul>:<p>No local gaps detected. This does not verify completeness against a payer’s requirements.</p>}
        <h4>Source citations and quoted manual text</h4>{packet.citations.map(c=><div className="care-entry paperwork-source" key={c.id}><strong>{c.name}</strong><p className="caption">Document {c.id} · SHA-256 {c.sha256}</p><blockquote>{packet.quotedSources.find(q=>q.documentId===c.id)?.text??"Manual text not supplied"}</blockquote></div>)}
        {packet.reviewComment&&<p>Requested adjustment retained for staff review: {packet.reviewComment}</p>}
        <p>{packet.staffNextAction}</p></>}
      {open&&!run.stale&&run.status==="AWAITING_REVIEW"&&<form className="fields" data-testid="paperwork-review" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void send(`${endpoint}/${run.id}/review`,{decision:String(form.get("decision")),comment:String(form.get("comment")??""),expectedDocumentVersion:run.source.documentVersion,expectedProposalRevision:run.revision,requestId:crypto.randomUUID()});}}>
        <label>Staff decision<select name="decision" disabled={busy||!!pending}><option value="ACCEPT">Accept local draft</option>{run.revision<3&&<option value="REQUEST_CHANGES">Request changes</option>}<option value="REJECT">Reject run</option></select></label>
        <label>Review comment<textarea name="comment" maxLength={1000} rows={3} disabled={busy||!!pending}/></label><p className="caption">Change requests retain original quotations and your adjustment for the next human review. Correct source text in a new run. {run.revision===3?"Revision limit reached; acceptance and rejection remain available.":"A reason is required for changes or rejection."}</p>
        <button className="button" disabled={busy||!!pending}>Save staff decision</button>
      </form>}
      {run.followups.map(f=><div className="notice" key={f.id}><strong>Local staff follow-up</strong><p>{f.action}</p><p className="caption">Owner {run.actors[f.ownerId]} · packet {run.packet?.id}</p></div>)}
      <details><summary>Retained proposal and human review history</summary>{run.proposals.map(p=><div className="care-entry" key={p.id}><strong>Draft revision {p.revision}</strong><p className="caption">SHA-256 {p.packetHash}</p>{p.packet.reviewComment&&<p>{p.packet.reviewComment}</p>}</div>)}{run.reviews.map(r=><div className="care-entry" key={r.id}><strong>{r.decision} · revision {r.revision}</strong><p>{r.comment}</p><p className="caption">Staff {run.actors[r.recordedBy]} · {r.recordedAt}</p></div>)}<p className="caption">Bound source snapshot SHA-256 {run.sourceHash}</p></details>
    </div>}</section></div>
  </section>;
}
