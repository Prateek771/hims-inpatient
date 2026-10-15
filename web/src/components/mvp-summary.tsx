import Link from "next/link";
import type { MvpReview, MvpQueueRow } from "@/server/mvp/workspace";
import { formatINR } from "@/server/billing/money";
import { HospitalTimestamp } from "./hospital-timestamp";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const money = (value: unknown) => typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? formatINR(BigInt(value)) : "Awaiting review";

export function MvpSummary({ identity, review, showMoney, actionLink = true }: { identity: MvpQueueRow; review: MvpReview; showMoney: boolean; actionLink?: boolean }) {
  const bill = record(review.bill), financial = record(review.financial), responsibility = record(financial.responsibility);
  const exited = !!review.departure || !!review.exceptionalDeparture;
  return <aside className="mvp-detail" aria-label="Selected patient episode">
    <section><h2>{identity.name}</h2><p className="caption">{identity.uhid} · {identity.ipCode}</p><p className="caption">{identity.bedLabel} · {identity.nurseName ?? "Nurse assignment needed"}</p><p><strong>{identity.action}</strong></p><p>{identity.detail}</p></section>
    <section><h3>{review.clinical ? "Doctor approval recorded" : "Doctor approval pending"}</h3>{review.clinical && <><p className="caption">{String(review.clinical.payload.authorizerName)} · source <HospitalTimestamp value={String(review.clinical.payload.sourceTime)} /></p><p className="caption">Recorded by {String(review.clinical.payload.recorderName ?? "responsible staff")} · <HospitalTimestamp value={String(review.clinical.recordedAt)} /></p></>}</section>
    <section><h3>Department checks · run in parallel</h3>{review.checks.map(check => <p className={`caption ${check.current ? "mvp-success" : "mvp-warning"}`} key={check.check}>{check.check === "NURSING" ? "Nursing" : check.check.toLowerCase()} · {check.current ? check.status === "NA" ? "N/A confirmed" : "Complete" : "Review pending"}{check.event?.payload.reason ? ` · ${String(check.event.payload.reason)}` : ""}</p>)}</section>
    {showMoney && review.bill && <section><dl className="mvp-money">{[["Gross charges", bill.grossPaise], ["Linked credits / reversals", bill.reversedPaise], ["Net bill", bill.netPaise], ["Patient responsibility", responsibility.patientPaise], ["Actual patient money received", bill.patientReceivedPaise], ["Actual refunds", bill.refundedPaise], ["Patient still due", responsibility.patientOutstandingPaise], ["Accepted insurer responsibility", responsibility.insurerPaise ?? financial.insurerAuthorizedPaise], ["Insurer receivable", responsibility.insurerOutstandingPaise], ["Insurer cash received", bill.insurerCashPaise]].map(([label, amount]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{money(amount)}</dd></div>)}</dl></section>}
    <section><h3>{exited ? "Actual exit recorded · bed release follows turnover" : review.vacancy ? "Bed vacant · held until exit & turnover" : "Bed use continues"}</h3>{review.vacancy && <p className="caption">Since <HospitalTimestamp value={String(review.vacancy.vacatedAt)} /> · {String(review.vacancy.waitingLocation)}</p>}<p className="caption">Clinical papers {review.clinical ? "available" : "await Doctor approval"} · final papers {review.finance ? "authorized" : "pending"}</p><p className={exited ? "caption mvp-success" : "caption mvp-warning"}>{exited ? "Actual hospital exit recorded" : "Actual hospital exit not yet recorded"}</p></section>
    {actionLink && <Link className="button" href={identity.status === "PENDING" ? `/patients/${identity.id}` : `/mvp/${identity.id}`}>{identity.action}</Link>}
  </aside>;
}
