import { requireStaff, staffContext } from "@/server/access";
import { apiError, sameOrigin } from "@/server/http";
import { insuranceCaseSource } from "@/server/insurance/commands";
import { withTransaction } from "@/server/db";
import { DomainError } from "@/server/contracts";
import { paperworkBody } from "@/server/insurance/paperwork-http";
import { getPaperworkRun, listPaperworkRuns, startPaperworkRun } from "@/server/insurance/paperwork-commands";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request,{params}:{params:Promise<{caseId:string}>}){
  try{
    sameOrigin(request);const staff=await requireStaff(request.headers),{caseId}=await params,ctx=staffContext(staff,"paperwork-start-http");
    await withTransaction(tx=>insuranceCaseSource(tx,ctx,caseId));
    const body=await paperworkBody(request),requestId=String(body.requestId??"");
    return Response.json(await startPaperworkRun({...ctx,requestId},{...body,caseId}),{status:201,headers});
  }catch(e){return apiError(e);}
}
export async function GET(request:Request,{params}:{params:Promise<{caseId:string}>}){
  try{
    const ctx=staffContext(await requireStaff(request.headers),"paperwork-read-http"),{caseId}=await params;
    await withTransaction(tx=>insuranceCaseSource(tx,ctx,caseId));
    const runId=new URL(request.url).searchParams.get("runId");
    if(!runId)return Response.json(await listPaperworkRuns(ctx,caseId),{headers});
    const run=await getPaperworkRun(ctx,runId);if(run.caseId!==caseId)throw new DomainError("FORBIDDEN","Paperwork belongs to another case");
    return Response.json(run,{headers});
  }catch(e){return apiError(e);}
}
