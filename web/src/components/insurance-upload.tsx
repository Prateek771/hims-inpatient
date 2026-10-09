"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function InsuranceUpload({caseId,version,maxBytes,documents}:{caseId:string;version:number;maxBytes:number;documents:{id:string;originalName:string}[]}){
  const router=useRouter(),[message,setMessage]=useState(""),[pending,setPending]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID());
  return <form className="fields" data-testid="insurance-upload" onSubmit={async e=>{e.preventDefault();setPending(true);const form=new FormData(e.currentTarget);form.set("requestId",requestId);form.set("expectedCaseVersion",String(version));try{const response=await fetch(`/api/insurance/cases/${caseId}/documents`,{method:"POST",body:form});const result=await response.json();if(!response.ok){setMessage(result.error??"Unable to attach document");return;}setMessage("Protected document attached. Original versions remain available.");setRequestId(crypto.randomUUID());router.refresh();}catch{setMessage("Upload could not be confirmed. Retry the same file to check its saved result.");}finally{setPending(false);}}}>
    <label>Case document<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required/></label><p className="caption">PDF, JPEG or PNG · maximum {Math.floor(maxBytes/1024)} KiB. Attach only staff-approved case materials.</p>
    <label>Replace document<select name="replacesDocumentId"><option value="">New document</option>{documents.map(d=><option key={d.id} value={d.id}>{d.originalName}</option>)}</select></label><p role="status">{message}</p><button className="button" disabled={pending}>Attach protected document</button>
  </form>;
}
