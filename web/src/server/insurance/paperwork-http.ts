import { DomainError } from "../contracts";
/** Bound both declared and streamed JSON before parsing manual transcription. */
export async function paperworkBody(request:Request){
  const limit=131072;
  if(!request.headers.get("content-type")?.startsWith("application/json"))throw new DomainError("VALIDATION","Paperwork requires JSON");
  if(Number(request.headers.get("content-length")??0)>limit)throw new DomainError("VALIDATION","Paperwork text exceeds the request limit");
  const reader=request.body?.getReader();if(!reader)throw new DomainError("VALIDATION","Paperwork body required");
  const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new DomainError("VALIDATION","Paperwork text exceeds the request limit");}chunks.push(value);}}finally{reader.releaseLock();}
  const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!body||typeof body!=="object"||Array.isArray(body))throw new DomainError("VALIDATION","Paperwork fields required");
  return body as Record<string,unknown>;
}
