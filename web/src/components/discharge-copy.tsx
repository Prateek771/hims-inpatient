import Image from "next/image";
import { documentSections } from "@/server/documents/model";
import { documentFontFamily, documentTextParts } from "@/server/documents/content";
import type { DischargeSnapshot } from "@/server/documents/snapshot";
function Words({ value }: { value: string }) { return <>{documentTextParts(value).map((v, i) => <span key={i} style={{ fontFamily: documentFontFamily(v) }}>{v}</span>)}</>; }
export function DischargeCopy({ snapshot, hash, qr }: { snapshot: DischargeSnapshot; hash: string; qr: string }) {
  const footer = <footer className="document-verification-footer" data-testid="document-verification-footer">
    <Image src={qr} unoptimized width={108} height={108} alt="QR to authenticated document verification" data-testid="document-qr" />
    <div><strong>Document verification</strong><p>{snapshot.admission.ipCode} · Revision {snapshot.version}</p><p>Reference: {snapshot.documentId}</p><p>Canonical snapshot SHA-256: {hash}</p><p>Authenticated staff verification. Original versions remain attributable.</p></div>
  </footer>;
  return <article className="card final-copy" data-testid="final-copy">
    <h2>Final discharge copy</h2>
    {documentSections(snapshot).map(section => <section key={section.title} className="document-section">
      <h3><Words value={section.title}/></h3>
      {section.paragraphs.map((p, i) => <p key={i}><Words value={p}/></p>)}
      {section.rows.length > 0 && <table><thead><tr><th scope="col">Record / item</th><th scope="col">Details / amount</th></tr></thead><tbody>{section.rows.map(([label, value], i) => <tr key={i}><td><Words value={label}/></td><td><Words value={value}/></td></tr>)}</tbody></table>}
    </section>)}
    {footer}
  </article>;
}
