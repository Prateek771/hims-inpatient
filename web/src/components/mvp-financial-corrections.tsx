import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireStaff, staffContext } from "@/server/access";
import { exceptionWorkspace } from "@/server/discharge/exception-workspace";
import { correctionRoles, type CorrectionKind } from "@/server/discharge/exception-corrections";
import { postDischargeAmendments } from "@/server/discharge/exception-schema";
import { getInsuranceCase } from "@/server/insurance/commands";
import { db } from "@/server/db";
import { formatINR } from "@/server/billing/money";
import { exceptionAction, type ExceptionBinding } from "@/app/(staff)/exceptions/actions";
import { CareField, CareForm } from "./care-forms";
import { ActualCashFields, SourceSelect } from "./exception-forms";
import { HospitalTimestamp } from "./hospital-timestamp";

const supported = ["INSURANCE_DECISION", "REVERSE_CHARGE", "SELF_PAY_REVIEW", "REFUND", "ALLOCATE", "CANCEL_ALLOCATION"] as const;
type FinancialKind = typeof supported[number];
const financialKind = (kind: string | null): kind is FinancialKind => supported.some(candidate => candidate === kind);
const labels: Record<FinancialKind, string> = { INSURANCE_DECISION: "Externally verified insurance decision", REVERSE_CHARGE: "Original non-room charge reversal", SELF_PAY_REVIEW: "Retained self-pay conversion review", REFUND: "Actual linked refund", ALLOCATE: "Retained patient deposit allocation", CANCEL_ALLOCATION: "Original deposit allocation cancellation" };
const sourceKinds: Record<FinancialKind, string> = { INSURANCE_DECISION: "INSURANCE_CASE", REVERSE_CHARGE: "CHARGE", SELF_PAY_REVIEW: "CONVERSION", REFUND: "RECEIPT", ALLOCATE: "RECEIPT", CANCEL_ALLOCATION: "ALLOCATION" };

export async function MvpFinancialCorrections({ admissionId, selectedAuthorityId }: { admissionId: string; selectedAuthorityId?: string }) {
  const staff = await requireStaff();
  if (!["ADMIN", "BILLING", "INSURANCE"].includes(staff.role)) return null;
  const ctx = staffContext(staff, "mvp-post-exit-financial-corrections");
  const workspace = await exceptionWorkspace(ctx, admissionId, selectedAuthorityId), selected = workspace.selected;
  if (!selected || selected.episode.status !== "DISCHARGED") return null;
  const authorities = selected.authorities.filter(authority => authority.type === "POST_DISCHARGE_CORRECTION" && financialKind(authority.correctionKind) && correctionRoles(authority.correctionKind).includes(staff.role));
  const authority = authorities.find(item => item.id === selectedAuthorityId) ?? authorities[0];
  const kind = authority?.correctionKind;
  const amendmentRows = await db.select({ exceptionId: postDischargeAmendments.exceptionId }).from(postDischargeAmendments).where(eq(postDischargeAmendments.admissionId, admissionId));
  const applied = new Set(amendmentRows.map(amendment => amendment.exceptionId));
  const payer = authority?.sourceId && kind === "INSURANCE_DECISION" ? await getInsuranceCase(ctx, authority.sourceId) : null;
  const allDocuments = payer?.documents ?? [];
  const documents = allDocuments.filter(document => !allDocuments.some(newer => newer.replacesDocumentId === document.id));
  const binding: ExceptionBinding = { admissionId, requestId: crypto.randomUUID(), version: selected.episode.version, billVersion: payer?.money.revision ?? selected.episode.billRevision, netPaise: payer?.money.netPaise.toString(), caseVersion: payer?.case.version, exceptionId: authority?.id, sourceId: authority?.sourceId ?? undefined, correctionKind: kind ?? undefined };
  const action = (operation: string) => exceptionAction.bind(null, operation, { ...binding, requestId: crypto.randomUUID() });
  return <section className="card" id="financial-corrections" aria-label="Post-exit financial corrections">
    <h2>Post-exit financial corrections</h2><p>Admin first authorizes the exact original financial source. The permitted staff member then records a linked correction with current verified evidence. The original exit, papers, receipts and source history remain retained.</p>
    {staff.role === "ADMIN" && supported.map(correction => {
      const sources = selected.sources.filter(source => {
        if (source.kind !== sourceKinds[correction]) return false;
        if (correction === "ALLOCATE") return !!selected.bill?.receipts.some(receipt => receipt.id === source.id && receipt.party === "PATIENT" && receipt.kind !== "PAYMENT");
        if (correction === "REFUND") {
          const receipt = selected.bill?.receipts.find(receipt => receipt.id === source.id);
          return !!receipt && receipt.amountPaise > (selected.bill?.refunds.filter(refund => refund.receiptId === receipt.id).reduce((sum, refund) => sum + refund.amountPaise, 0n) ?? 0n);
        }
        return true;
      });
      if (!sources.length) return null;
      return <details className="mvp-action" key={correction}><summary>Authorize {labels[correction].toLowerCase()}</summary><CareForm action={action("authorize")} button="Authorize source-bound financial correction" testId={`mvp-correction-authorize-${correction.toLowerCase()}`}><input type="hidden" name="type" value="POST_DISCHARGE_CORRECTION" /><input type="hidden" name="disposition" value="AMEND" /><input type="hidden" name="correctionKind" value={correction} /><SourceSelect name="sourceId" title="Exact original financial source" options={sources} /><CareField name="authority" label="Named financial correction authority / position" /><CareField name="reason" label="Financial correction authorization reason" /><CareField name="evidence" label="Financial correction authority evidence / reference" /><label>Accountable correction follow-up owner<select name="followUpOwnerId" required defaultValue=""><option value="">Choose responsible active staff</option>{workspace.staffOptions.filter(owner => !["DOCTOR", "LAB"].includes(owner.role)).map(owner => <option key={owner.id} value={owner.id}>{owner.name} · {owner.role}</option>)}</select></label><p className="caption">This grants only the selected correction against this source. It creates no new clinical approval and records no payment.</p></CareForm></details>;
    })}
    <h3>Retained financial correction authorities</h3>{authorities.length ? <ul className="section-list">{authorities.map(item => <li key={item.id}><div><Link href={`/mvp/${admissionId}?tab=money&correction=${item.id}#financial-corrections`}>{labels[item.correctionKind as FinancialKind]}</Link><p className="caption">{item.authority} · {item.reason} · <HospitalTimestamp value={item.signedAt.toISOString()} /></p></div><span className="caption">{applied.has(item.id) ? "Linked amendment recorded" : "Awaiting permitted staff application"}</span></li>)}</ul> : <p>No source-bound financial correction authority has been recorded for this episode.</p>}
    {authority && financialKind(kind ?? null) && correctionRoles(kind as CorrectionKind).includes(staff.role) && !applied.has(authority.id) && <details className="mvp-action" open><summary>Apply selected {labels[kind as FinancialKind].toLowerCase()}</summary><p className="caption">Admin authority: {authority.authority} · {authority.reason}. Source: {selected.sources.find(source => source.id === authority.sourceId)?.label ?? authority.sourceId}</p><CareForm action={action("amend")} button="Record linked financial amendment" testId="mvp-financial-amendment">
      {kind === "REVERSE_CHARGE" ? <><CareField name="amount" label="Original non-room charge amount to reverse (INR)" type="number" step="0.01" /><CareField name="reason" label="Linked original charge correction reason" /></> : kind === "SELF_PAY_REVIEW" ? <CareField name="reason" label="Verified original self-pay conversion review reason" /> : kind === "REFUND" ? <ActualCashFields refund /> : kind === "ALLOCATE" ? <><CareField name="amount" label="Retained patient deposit to allocate (INR)" type="number" step="0.01" /><CareField name="reason" label="Retained deposit allocation reason" /></> : kind === "CANCEL_ALLOCATION" ? <CareField name="reason" label="Original allocation cancellation reason" /> : payer ? <>
        <p className="notice">Current posted bill {formatINR(payer.money.netPaise)} · revision {payer.money.revision}. Externally accepted responsibility remains separate from actual cash.</p>
        <label>Externally verified decision<select name="status"><option value="APPROVED">Approved</option><option value="PARTIAL">Partial</option><option value="REJECTED">Rejected</option><option value="PENDING">Pending</option></select></label><label>External decision request type<select name="decisionKind"><option value="APPEAL">Appeal</option><option value="ENHANCEMENT">Enhancement</option><option value="PREAUTH">Pre-authorization</option></select></label>
        <CareField name="approved" label="Later externally accepted amount (INR)" type="number" step="0.01" /><CareField name="eligible" label="Later verified eligible bill (INR)" type="number" step="0.01" /><CareField name="nonPayable" label="Later verified non-payable bill (INR)" type="number" step="0.01" defaultValue="0" /><CareField name="coPayPercent" label="Later verified co-pay (%)" type="number" step="0.01" defaultValue="0" /><CareField name="patient" label="Later verified total patient liability (INR, if supplied)" type="number" step="0.01" required={false} />
        <CareField name="verifiedBy" label="External decision verifier" /><CareField name="verifiedAt" label="External decision verification time (UTC)" type="datetime-local" /><CareField name="reference" label="Later external decision reference" /><CareField name="sourceReference" label="Later allocation verification reference" /><CareField name="reason" label="Later verified decision / exclusions reason" />
        <fieldset><legend>Protected supporting case evidence</legend>{documents.length ? documents.map(document => <label key={document.id}><input type="checkbox" name="documentIds" value={document.id} />{document.originalName} · <Link href={`/api/insurance/cases/${payer.case.id}/documents?documentId=${document.id}`}>Review protected source</Link></label>) : <p className="caption">No current protected case document is attached. External verifier, source time and references are still required.</p>}</fieldset>
        <Link href={`/insurance?caseId=${payer.case.id}`}>Review retained verified policy, decisions & protected case files</Link>
      </> : <p>The current assigned insurance source must be available before recording this decision.</p>}
    </CareForm></details>}
    {selected.amendments.filter(amendment => financialKind(amendment.kind)).map(amendment => <p className="caption" key={amendment.id}>{labels[amendment.kind as FinancialKind]} · original source {amendment.sourceId} · linked result {amendment.resultId} · recorded <HospitalTimestamp value={amendment.signedAt.toISOString()} /></p>)}
  </section>;
}
