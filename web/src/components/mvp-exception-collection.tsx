import Link from "next/link";
import type { MvpReview } from "@/server/mvp/workspace";
import { formatINR } from "@/server/billing/money";
import { CareField, CareForm, type CareAction } from "./care-forms";
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function MvpExceptionCollection({ review, action }: { review: MvpReview; action: CareAction }) {
  const departure = review.exceptionalDeparture;
  if (!departure || !review.bill || review.episode.status !== "DISCHARGED") return null;
  const authority = review.exceptions.find(event => event.id === departure.authorityId && event.action === "AUTHORITY");
  const original = fields(fields(authority?.payload.financial).responsibility);
  const collection = review.collectionAuthority;
  const current = review.financial?.responsibility;
  const laterAllocation = !!collection?.allocationAmendmentId;
  const patientAccepted = BigInt(String(laterAllocation ? current?.patientPaise ?? "0" : original.patientPaise ?? "0")), insurerAccepted = BigInt(String(laterAllocation ? current?.insurerPaise ?? "0" : original.insurerPaise ?? "0"));
  const patientDue = BigInt(collection?.patientRemainingPaise ?? "0"), insurerDue = BigInt(collection?.insurerRemainingPaise ?? "0");
  return <section className="card" aria-label="Original exceptional receivable collection">
    <h2>Collect a retained exception obligation</h2>
    <p>The original Admin authority and actual exit remain retained. Record only money already received through the hospital’s existing channel.</p>
    <p className="caption">Original authority: {authority ? `${String(authority.payload.authority)} · ${authority.type}` : "Retained authority needs review"}</p>
    {authority && collection?.eligible ? <>
      {laterAllocation && <p className="notice">The original insurance-delay exit retained unresolved responsibility. Collection now uses the later externally verified same-case allocation under linked Admin correction authority; the historical exit and its original papers stay unchanged. Amendment: {collection.allocationAmendmentId}.</p>}
      <dl className="mvp-money"><div><dt>{laterAllocation ? "Later verified patient responsibility" : "Original patient responsibility"}</dt><dd>{formatINR(patientAccepted)}</dd></div><div><dt>Patient cash currently retained</dt><dd>{formatINR(BigInt(review.bill.patientCashPaise))}</dd></div><div><dt>Patient obligation still due</dt><dd>{formatINR(patientDue)}</dd></div><div><dt>{laterAllocation ? "Later accepted insurer responsibility" : "Original accepted insurer responsibility"}</dt><dd>{formatINR(insurerAccepted)}</dd></div><div><dt>Insurer cash currently retained</dt><dd>{formatINR(BigInt(review.bill.insurerCashPaise))}</dd></div><div><dt>Insurer obligation still due</dt><dd>{formatINR(insurerDue)}</dd></div><div><dt>Total remaining authorized collection</dt><dd>{formatINR(BigInt(collection.totalRemainingPaise))}</dd></div></dl>
      {patientDue > 0n || insurerDue > 0n ? <details className="mvp-action"><summary>Record actual payment against original exception</summary><CareForm action={action} button="Record exceptional receivable receipt" testId="mvp-exception-receipt"><label>Party settling the original obligation<select name="party" required defaultValue={patientDue > 0n ? "PATIENT" : "INSURER"}>{patientDue > 0n && <option value="PATIENT">Patient · {formatINR(patientDue)} still due</option>}{insurerDue > 0n && <option value="INSURER">Insurer · {formatINR(insurerDue)} still due</option>}</select></label><CareField name="amount" label="Actual exceptional receipt amount (INR)" /><label>Actual exceptional receipt mode<select name="mode">{["BANK", "UPI", "CARD", "CASH"].map(mode => <option key={mode}>{mode}</option>)}</select></label><CareField name="channel" label="Exceptional receipt bank / channel account" /><CareField name="sourceReference" label="Exceptional receipt transaction / book reference" /><CareField name="reference" label="Exceptional receipt record reference" /><CareField name="evidenceId" label="Exceptional receipt evidence reference" /><p className="caption">The server rechecks the linked collection authority, current corrected responsibility and retained cash. Collection cannot exceed that party’s remaining authorized party and total obligation or rewrite the exit and saved papers.</p></CareForm></details> : <p className="mvp-success">The authorized patient and insurer obligations are settled.</p>}
    </> : <p className="notice">{collection?.reason ?? "A complete source-bound payer responsibility is required before collecting against this exception."}</p>}
    <p><Link href={`/mvp/${review.episode.id}?tab=money#financial-corrections`}>Review post-exit financial correction authority & verified allocation</Link></p>
    <Link href={`/mvp/${review.episode.id}?tab=exceptions`}>Review retained exception authority & follow-up</Link>
  </section>;
}
