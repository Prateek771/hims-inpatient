import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { documentWorkspace, getDischargeDocumentReview } from "@/server/documents/commands";
import { DomainError } from "@/server/contracts";
import { CareForm } from "@/components/care-forms";
import { WorkflowTabs } from "@/components/workflow-tabs";
import { createDocumentAction } from "./actions";
import { isMvpEpisode } from "@/server/mvp/workspace";
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ admissionId?: string }> }) {
  const staff = await requireStaff(); if (!["ADMIN", "BILLING"].includes(staff.role)) notFound();
  const { admissionId } = await searchParams;
  if (admissionId && await isMvpEpisode(admissionId)) redirect(`/mvp/${admissionId}?tab=exit`);
  const ctx = staffContext(staff, "final-document-workspace"), episodes = await documentWorkspace(ctx);
  const mvpEpisodes = new Set(episodes.filter(episode => episode.workflowVersion === 2).map(episode => episode.id));
  let review: Awaited<ReturnType<typeof getDischargeDocumentReview>> | undefined;
  if (admissionId) try { review = await getDischargeDocumentReview(ctx, admissionId); } catch (e) { if (e instanceof DomainError && e.code === "FORBIDDEN") notFound(); throw e; }
  return <><p className="eyebrow">Final documents · Admin / Billing</p><h1>Final documents</h1><p className="page-description">Immutable signed versions, verified PDF downloads, print copies and authenticated verification.</p>
    <details className="card discharge-worklist" open={!review}><summary>{review ? "Choose another recorded departure" : "Recorded hospital departures"}</summary>
      <p className="caption">Ordinary MVP exit requires authorized final papers delivered first. Exceptional departures retain any missing-paper obligations. Open the episode for exact retained versions; earlier workflows keep their original document review.</p>
      {episodes.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Recorded departures for documents"><table><thead><tr><th>Admission</th><th>Next work</th></tr></thead><tbody>{episodes.map(e => <tr key={e.id}><td>{e.ipCode}</td><td><Link href={mvpEpisodes.has(e.id) ? `/mvp/${e.id}?tab=exit` : `/documents?admissionId=${e.id}`}>{mvpEpisodes.has(e.id) ? "Open retained episode papers" : "Review sources and retained versions"}</Link></td></tr>)}</tbody></table></div> : <p>No hospital departures are recorded.</p>}
    </details>
    {review && <>
      <section className="care-patient-context"><div><h2>{review.name} · {review.ipCode}</h2><p className="caption">{review.departureKind === "EXCEPTIONAL" ? "Exceptional departure · actual approvals and remaining obligations retained" : "Ordinary departure · four actual historical human clearances retained"}</p></div><div><strong>Current bill version {review.input.billVersion}</strong><p className="caption">{review.versions.length} saved {review.versions.length === 1 ? "version" : "versions"}</p></div></section>
      <WorkflowTabs key={review.input.admissionId} id={`documents-${review.input.admissionId}`} items={[
        {id:"sources",label:"Current sources",children:<div className="exception-columns"><section className="card"><h2>Review the current recorded sources</h2><p>Earlier copies retain their original contents and signatures. A later source correction creates a new reviewed version.</p>
          <dl className="exception-facts"><dt>Bill version</dt><dd>{review.input.billVersion}</dd><dt>Departure</dt><dd>{review.departureKind}</dd><dt>Source hash</dt><dd className="source-hash">{review.input.expectedSourceHash}</dd>{Object.entries(review.input.clearanceVersions).map(([gate,id])=><Fragment key={gate}><dt>{gate} seal</dt><dd>{id ?? "No historical seal recorded"}</dd></Fragment>)}{review.input.exceptionId&&<><dt>Exception authority</dt><dd>{review.input.exceptionId}</dd></>}</dl>
          <CareForm action={createDocumentAction.bind(null, review.input)} button="Generate current discharge copy" testId="generate-document"><p>Create an immutable copy of the current recorded sources.</p></CareForm>
        </section><aside className="card document-actions"><h2>Retained versions</h2>{review.versions[0] ? <><span className="status">Latest saved revision {review.versions[0].version}</span><Link className="button secondary" href={`/documents/${review.versions[0].id}`}>Open latest saved copy</Link><p className="caption">Created <HospitalTimestamp value={review.versions[0].createdAt.toISOString()}/></p><p className="caption">{review.versions[0].sourceHash === review.input.expectedSourceHash ? "The latest saved copy matches the current sources." : "Current sources differ from the latest saved copy. Review and generate a new version."}</p></> : <p>No final copy has been generated for this departure.</p>}<Link href={`/discharge?admissionId=${review.input.admissionId}`}>Review retained discharge record</Link><Link href={`/exceptions?admissionId=${review.input.admissionId}`}>Review exceptions and obligations</Link><p className="caption">Verification and downloads require an authorized staff login.</p></aside></div>},
        {id:"versions",label:"Saved versions",children:<section className="card"><h2>Saved document versions</h2>{review.versions.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Immutable discharge document versions"><table><thead><tr><th>Revision / recorded time</th><th>Original source hash</th><th>Saved copy</th></tr></thead><tbody>{review.versions.map(v=><tr key={v.id}><td>Revision {v.version}<p className="caption"><HospitalTimestamp value={v.createdAt.toISOString()}/></p></td><td className="source-hash">{v.sourceHash}</td><td><Link href={`/documents/${v.id}`}>Open revision {v.version}</Link></td></tr>)}</tbody></table></div> : <p>No saved versions. Review the current sources before generating the first copy.</p>}<p className="caption">Original PDFs remain available when their verified protected files are present. An unavailable or changed file cannot be recreated under the same immutable identity.</p></section>},
      ]}/>
    </>}
  </>;
}
