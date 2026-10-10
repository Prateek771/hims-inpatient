import { Annotation, Command, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ROOT, traceable } from "langsmith/traceable";
import { Client as TraceClient } from "langsmith/client";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { CHECKPOINT_SCHEMA } from "../../../scripts/paperwork-checkpointer";
import type { PaperworkPacket, PaperworkSource } from "./paperwork-schema";
export { CHECKPOINT_SCHEMA };
export const MAX_PAPERWORK_REVISIONS=3;
export const LOCAL_PAPERWORK_TRACE_URL="http://127.0.0.1:1";
export type PaperworkDecision={decision:"ACCEPT"|"REQUEST_CHANGES"|"REJECT";comment:string;reviewId:string};
const State=Annotation.Root({caseId:Annotation<string>(),source:Annotation<PaperworkSource>(),revision:Annotation<number>(),packet:Annotation<PaperworkPacket>(),review:Annotation<PaperworkDecision>()});
/** Manual assembly only: no model, OCR, tools, chart access or external sender. Source text is inert data. */
export function createPaperworkGraph(checkpointer:PostgresSaver){
  const graph=new StateGraph(State)
    .addNode("inventory_documents",s=>({source:s.source}))
    .addNode("extract_text",s=>({source:s.source}))
    .addNode("check_required_fields",s=>({packet:{mode:"MANUAL_TEXT" as const,caseId:s.caseId,ipCode:s.source.ipCode,revision:0,notice:"Manual transcription; no model/OCR provider configured. Local checks do not verify source truth, payer requirements, coverage or payment.",citations:s.source.documents,quotedSources:s.source.manualSources,missing:[...(!s.source.policyId?["Externally verified policy/member record"]:[]),...(!s.source.decisionId?["External payer decision record"]:[]),...(!s.source.documents.length?["Staff-attached case documents"]:[]),...s.source.documents.filter(d=>!s.source.manualSources.some(m=>m.documentId===d.id)).map(d=>`Manual text not supplied: ${d.name}`)],staffNextAction:"Insurance staff: check the quoted source and local gaps; obtain missing material from the responsible staff, then use the insurer’s existing email or portal if appropriate. Nothing has been sent.",reviewComment:""}}))
    .addNode("draft_packet",s=>{const revision=(s.revision??0)+1;if(revision>MAX_PAPERWORK_REVISIONS)throw new Error("Paperwork revision limit reached");return {revision,packet:{...s.packet,revision,reviewComment:s.review?.decision==="REQUEST_CHANGES"?s.review.comment:""}};})
    .addNode("human_review",s=>({review:interrupt<PaperworkPacket,PaperworkDecision>(s.packet)}))
    .addEdge(START,"inventory_documents").addEdge("inventory_documents","extract_text").addEdge("extract_text","check_required_fields").addEdge("check_required_fields","draft_packet").addEdge("draft_packet","human_review")
    .addConditionalEdges("human_review",s=>s.review.decision==="REQUEST_CHANGES"?"draft_packet":END,["draft_packet",END])
    .compile({checkpointer});
  // ROOT false detaches an enabled parent. The installed deferred stream drops that
  // false ALS placeholder; a fixed native callback client closes that second boundary.
  // Its supported transport is inert and redacts inputs/outputs, never making a request.
  // Construct the tracer INSIDE the false context so it cannot adopt a parent's client.
  const local=<T>(fn:(callbacks:LangChainTracer[])=>Promise<T>)=>{
    const client=new TraceClient({apiUrl:LOCAL_PAPERWORK_TRACE_URL,apiKey:"local-no-export",tracingMode:"langsmith",autoBatchTracing:false,hideInputs:true,hideOutputs:true,hideMetadata:true,omitTracedRuntimeInfo:true,debug:false,disablePromptCache:true,fetchImplementation:async()=>Response.json({})});
    return traceable(()=>fn([new LangChainTracer({client,replicas:[]})]),{name:"local-insurance-paperwork",tracingEnabled:false,client,replicas:[]})(ROOT);
  };
  return {
    invoke:(...args:Parameters<typeof graph.invoke>)=>local(callbacks=>graph.invoke(args[0],{...args[1],callbacks})),
    getState:(...args:Parameters<typeof graph.getState>)=>local(callbacks=>graph.getState({...args[0],callbacks},args[1])),
  };
}
export { Command };
