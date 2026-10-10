import { HospitalTimestamp } from "@/components/hospital-timestamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { documentWorkspace, getDischargeDocumentReview } from "@/server/documents/commands";
import { DomainError } from "@/server/contracts";
import { CareForm } from "@/components/care-forms";
import { createDocumentAction } from "./actions";
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ admissionId?: string }> }) {
  const staff = await requireStaff(); if (!["ADMIN", "BILLING"].includes(staff.role)) notFound();
  const ctx = staffContext(staff, "final-document-workspace"), episodes = await documentWorkspace(ctx), { admissionId } = await searchParams;
  let review: Awaited<ReturnType<typeof getDischargeDocumentReview>> | undefined;
  if (admissionId) try { review = await getDischargeDocumentReview(ctx, admissionId); } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") notFound(); throw e; }
  return <><p className="eyebrow">05 · Final documents / used by Billing</p><h1>A complete discharge handover</h1><p className="page-description">One traceable package from the actual signed records, reviewed money and hospital departure.</p>
    <section className="card"><h2>Recorded hospital departures</h2>{episodes.length ? <ul className="worklist">{episodes.map(e => <li key={e.id}><Link href={`/documents?admissionId=${e.id}`}>{e.ipCode}</Link></li>)}</ul> : <p>No hospital departures are recorded.</p>}</section>
    {review && <section className="card"><h2>{review.name} · {review.ipCode}</h2><p>{review.departureKind === "EXCEPTIONAL" ? "Exceptional departure: actual approvals and remaining obligations are retained." : "Ordinary departure: the four actual human clearances are retained."}</p><p className="caption">Current bill version {review.input.billVersion}. Earlier copies stay available after a later attributable correction.</p>
      <CareForm action={createDocumentAction.bind(null, review.input)} button="Generate current discharge copy" testId="generate-document"><p>Create an immutable copy of the current recorded sources.</p></CareForm>
      {review.versions.length > 0 && <><h3>Saved document versions</h3><ul>{review.versions.map(v => <li key={v.id}><Link href={`/documents/${v.id}`}>Revision {v.version} · <HospitalTimestamp value={v.createdAt.toISOString()}/></Link></li>)}</ul></>}
    </section>}
  </>;
}
