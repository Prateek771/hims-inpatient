import { requireStaff, staffContext } from "@/server/access";
import { apiError, sameOrigin } from "@/server/http";
import { DomainError } from "@/server/contracts";
import { paperworkBody } from "@/server/insurance/paperwork-http";
import { getPaperworkRun, reviewPaperworkRun } from "@/server/insurance/paperwork-commands";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{caseId:string;runId:string}>}){
  try{
    sameOrigin(request);const ctx=staffContext(await requireStaff(request.headers),"paperwork-review-http"),{caseId,runId}=await params;
    const run=await getPaperworkRun(ctx,runId);if(run.caseId!==caseId)throw new DomainError("FORBIDDEN","Paperwork belongs to another case");
    const body=await paperworkBody(request),requestId=String(body.requestId??"");
    return Response.json(await reviewPaperworkRun({...ctx,requestId},{...body,runId}),{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(e){return apiError(e);}
}
