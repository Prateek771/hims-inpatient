import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { getDischargeDocument } from "@/server/documents/commands";
import { verificationQR } from "@/server/documents/pdf";
import { DomainError } from "@/server/contracts";
import { DischargeCopy } from "@/components/discharge-copy";
import { PrintDischarge } from "@/components/print-discharge";
import { MvpPaper } from "@/components/mvp-paper";
export default async function PrintPage({ params }: { params: Promise<{ documentId: string }> }) {
  let doc; try { doc = await getDischargeDocument(staffContext(await requireStaff(), "final-document-print-view"), (await params).documentId); } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") notFound(); throw e; }
  if (doc.schemaVersion === 2) return <div className="document-print"><div className="document-no-print"><h1>Print authorized patient papers</h1><p>Version {doc.version} · {doc.status}. This prints the immutable saved source.</p><Link className="button secondary" href={`/api/documents/${doc.id}/pdf`}>Download verified PDF</Link></div><PrintDischarge /><MvpPaper snapshot={doc.snapshot} hash={doc.hash} /></div>;
  const qr = `data:image/png;base64,${(await verificationQR(doc.snapshot.verificationUrl)).toString("base64")}`;
  // Native page margin boxes repeat without Chrome's fragmented fixed-footer overlap.
  // The bounded SVG contains only our generated QR; all references are immutable.
  const printQR = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="83" height="83"><image width="83" height="83" href="${qr}"/></svg>`).toString("base64")}`;
  const reference = JSON.stringify(`Document verification — authenticated staff access\n${doc.snapshot.admission.ipCode} · Revision ${doc.version}\nReference: ${doc.id}\nCanonical snapshot SHA-256: ${doc.hash}`).replace(/\\n/g, "\\A ");
  return <div className="document-print"><style>{`@media print { @page discharge { @bottom-left { content:url("${printQR}"); width:25mm; vertical-align:middle; } @bottom-center { content:${reference}; white-space:pre-wrap; font:7pt "DocumentSans"; text-align:left; vertical-align:middle; } } }`}</style><div className="document-no-print"><h1>Print discharge copy</h1><p>Revision {doc.version} · {doc.status}. Native printing uses this immutable saved content.</p><p>For reliable extracted or copied Hindi text, use Download verified PDF.</p><Link className="button secondary" href={`/api/documents/${doc.id}/pdf`}>Download verified PDF</Link></div><PrintDischarge/><DischargeCopy snapshot={doc.snapshot} hash={doc.hash} qr={qr}/></div>;
}
