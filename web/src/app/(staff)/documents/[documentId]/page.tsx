import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { getDischargeDocument } from "@/server/documents/commands";
import { verificationQR } from "@/server/documents/pdf";
import { DomainError } from "@/server/contracts";
import { DischargeCopy } from "@/components/discharge-copy";
export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  let doc; try { doc = await getDischargeDocument(staffContext(await requireStaff(), "final-document-view"), (await params).documentId); } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") notFound(); throw e; }
  const qr = `data:image/png;base64,${(await verificationQR(doc.snapshot.verificationUrl)).toString("base64")}`;
  return <><p className="eyebrow">05 · Final documents / used by Billing</p><h1>A complete discharge handover</h1><p className="page-description">One signed package for the patient and one traceable hospital record.</p>
    <section className="card discharge-identity"><div><h2>{doc.snapshot.patient?.name}</h2><p>{doc.snapshot.admission.ipCode} · Revision {doc.version}</p></div><span className="status">{doc.snapshot.departure.kind} departure</span><span className="status" data-testid="document-status">{doc.status}</span></section>
    {doc.status !== "CURRENT" && <div className="notice"><p>This saved historical copy is {doc.status.toLowerCase().replaceAll("_", " ")}. Its original content remains immutable. <Link href={`/documents?admissionId=${doc.admissionId}`}>Review current sources and saved versions</Link>.</p></div>}
    <div className="document-columns"><DischargeCopy snapshot={doc.snapshot} hash={doc.hash} qr={qr}/><aside className="card document-actions"><h2>Release &amp; documents</h2><p>Actual hospital departure: {doc.snapshot.departure.record.departedAt}</p><p>{doc.snapshot.seals.filter(s => s.seal).length} / 4 actual historical clearance records.</p><Link className="button secondary" href={`/documents/${doc.id}/print`}>Print / save discharge copy</Link><Link className="button secondary" href={`/api/documents/${doc.id}/pdf`}>Download verified PDF</Link><Link className="button secondary" href={`/documents/${doc.id}/verify`}>Verify version and integrity</Link><Link href={`/documents?admissionId=${doc.admissionId}`}>Saved document versions</Link><Link href={`/discharge?admissionId=${doc.admissionId}`}>Back to discharge review</Link><p className="caption document-no-print">For reliable extracted or copied Hindi text, use Download verified PDF.</p><p className="caption">Scroll through the entire copy to review reconciliation, actual signatures and verification.</p></aside></div>
  </>;
}
