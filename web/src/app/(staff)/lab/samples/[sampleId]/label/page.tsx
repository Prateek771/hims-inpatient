import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff,staffContext } from "@/server/access";
import { getSampleLabel } from "@/server/lab/commands";
import { DomainError } from "@/server/contracts";
import { PrintSample } from "@/components/print-sample";
import { HospitalTimestamp } from "@/components/hospital-timestamp";
export default async function LabelPage({params}:{params:Promise<{sampleId:string}>}){
  const {sampleId}=await params;let label:Awaited<ReturnType<typeof getSampleLabel>>;
  try{label=await getSampleLabel(staffContext(await requireStaff(),"sample-label"),sampleId);}catch(e){if(e instanceof DomainError&&e.code==="FORBIDDEN")notFound();throw e;}
  return <><h1 className="no-print">Patient sample label</h1><p className="page-description no-print">Check identity against the actual patient and ordered test before using the label.</p><section className="card sample-label" data-testid="print-sample-label"><h2>{label.patient.name}</h2><p>{label.patient.uhid} · {label.ipCode}</p><strong>{label.test}</strong><p className="caption">Order {label.orderId}</p>{/* Generated authenticated operational barcode; not a remote image asset. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/api/lab/samples/${sampleId}/barcode`} alt={`Sample barcode ${label.sample.barcode}`}/><p className="sample-code">{label.sample.barcode}</p><p className="caption">Collected <HospitalTimestamp value={label.sample.signedAt.toISOString()} /> · {label.signerName}</p></section><PrintSample/><Link className="button secondary no-print" href={`/lab?orderId=${label.orderId}`}>Return to this order</Link></>;
}
