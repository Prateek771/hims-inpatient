import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { verifyDocument } from "@/server/documents/commands";
import { DomainError } from "@/server/contracts";
export default async function VerifyPage({ params }: { params: Promise<{ documentId: string }> }) {
  let doc; try { doc = await verifyDocument(staffContext(await requireStaff(), "final-document-verification"), (await params).documentId); } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") notFound(); throw e; }
  return <><h1>Document verification</h1><p className="page-description">Authenticated document integrity and version status.</p><section className="card document-verify"><dl><dt>Reference</dt><dd data-testid="verification-reference">{doc.documentId}</dd><dt>Revision</dt><dd>{doc.version}</dd><dt>Status</dt><dd>{doc.status}</dd><dt>Canonical snapshot SHA-256</dt><dd>{doc.hash}</dd><dt>Stored PDF bytes SHA-256</dt><dd>{doc.pdfHash}</dd></dl><p>Human audit records and source integrity do not assert a certified digital signature.</p></section></>;
}
