"use client";
import { useState } from "react";
import { CareField, CareForm, type CareAction } from "./care-forms";
import { HospitalTimestamp } from "./hospital-timestamp";

type Source = { id: string; kind: string; label: string };
type Evidence = { id: string; kind: string; sourceId: string | null; actualAt: Date };
type Authority = { id: string; type: string; sourceId: string | null };
const label = (text: string) => text.toLowerCase().replaceAll("_", " ");
const choices: Record<string, string[]> = {
  URGENT_ADMISSION: ["ACTIVATE"], INSURANCE_DELAY: ["FOLLOW_UP", "EXCEPTIONAL_EXIT"], INSURANCE_DENIAL: ["FOLLOW_UP", "EXCEPTIONAL_EXIT"], CREDIT: ["FOLLOW_UP", "EXCEPTIONAL_EXIT"], UNAVAILABLE_APPROVER: ["FOLLOW_UP", "CLOSE_ATTENDANCE"], EARLY_EXIT: ["EXCEPTIONAL_EXIT"], AGAINST_ADVICE: ["EXCEPTIONAL_EXIT"], EXTERNAL_TRANSFER: ["EXCEPTIONAL_EXIT"], DEATH: ["EXCEPTIONAL_EXIT"], CANCELLED_DEPOSIT: ["RETURN_DEPOSIT"], POST_DISCHARGE_CORRECTION: ["AMEND"], DELAYED_TRANSFER: ["TRANSFER"], ROOM_CUTOFF_CORRECTION: ["AMEND"], RETURN_TO_BED: ["RETURN_TO_BED"],
};
const corrections: Record<string, string[]> = {
  REVERSE_CHARGE: ["CHARGE"], CARE_BILLING: ["CARE_BILLING"],
  RECEIPT: ["DEPARTURE"], REFUND: ["RECEIPT"], ALLOCATE: ["RECEIPT"], CANCEL_ALLOCATION: ["ALLOCATION"], INSURANCE_DECISION: ["INSURANCE_CASE"], DISPOSITION_REVIEW: ["DEPARTURE"], CLINICAL_ADDENDUM: ["CLINICAL_NOTE"], NURSING_ADDENDUM: ["SHIFT", "MAR", "OBSERVATION", "CONSUMABLE"], LAB_ADDENDUM: ["LAB_REPORT"], LAB_REPORT: ["LAB_ORDER"], LAB_BILLING: ["LAB_ORDER"], SELF_PAY_REVIEW: ["CONVERSION"],
};
export function SourceSelect({ name, title, options, required = true }: { name: string; title: string; options: { id: string; label: string }[]; required?: boolean }) {
  return <label>{title}<select name={name} required={required} defaultValue=""><option value="">{required ? "Select an option" : "No source required"}</option>{options.map(o => <option value={o.id} key={o.id}>{o.label}</option>)}</select></label>;
}
export function AuthorityForm({ action, sources, evidence, staff, status }: { action: CareAction; sources: Source[]; evidence: Evidence[]; staff: { id: string; name: string; role: string }[]; status: string }) {
  const availableTypes = Object.keys(choices).filter(type => status === "PENDING" ? type === "URGENT_ADMISSION" : status === "CANCELLED" ? type === "CANCELLED_DEPOSIT" : status === "DISCHARGED" ? ["POST_DISCHARGE_CORRECTION", "ROOM_CUTOFF_CORRECTION", "UNAVAILABLE_APPROVER"].includes(type) : !["URGENT_ADMISSION", "CANCELLED_DEPOSIT", "POST_DISCHARGE_CORRECTION"].includes(type));
  const dispositions = (type: string) => status === "DISCHARGED" && type === "UNAVAILABLE_APPROVER" ? ["CLOSE_ATTENDANCE"] : choices[type];
  const initial = status === "PENDING" ? "URGENT_ADMISSION" : status === "CANCELLED" ? "CANCELLED_DEPOSIT" : status === "DISCHARGED" ? "POST_DISCHARGE_CORRECTION" : "EARLY_EXIT";
  const [type, setType] = useState(initial), [disposition, setDisposition] = useState(choices[initial][0]), [correction, setCorrection] = useState("RECEIPT");
  const sourceKinds = type === "POST_DISCHARGE_CORRECTION" ? corrections[correction] : type === "CANCELLED_DEPOSIT" ? ["RECEIPT"] : type === "ROOM_CUTOFF_CORRECTION" ? ["STAY"] : type.startsWith("INSURANCE_") ? ["INSURANCE_CASE"] : disposition === "CLOSE_ATTENDANCE" ? ["SHIFT"] : [];
  return <CareForm action={action} button="Record administrator authority" testId="exception-authorize">
    <label>Situation<select name="type" value={type} onChange={e => { setType(e.target.value); setDisposition(dispositions(e.target.value)[0]); }}>{availableTypes.map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>
    <label>Permitted action<select name="disposition" value={disposition} onChange={e => setDisposition(e.target.value)}>{dispositions(type).map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>
    {type === "POST_DISCHARGE_CORRECTION" && <label>Specific later correction<select name="correctionKind" value={correction} onChange={e => setCorrection(e.target.value)}>{Object.keys(corrections).map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>}
    {sourceKinds.length > 0 && <SourceSelect name="sourceId" title="Original source" options={sources.filter(s => sourceKinds.includes(s.kind))} />}
    <fieldset className="exception-evidence"><legend>Signed professional evidence</legend>{evidence.length ? evidence.map(p => <label key={p.id}><input type="checkbox" name="evidenceIds" value={p.id} />{label(p.kind)} · <HospitalTimestamp value={p.actualAt.toISOString()} /></label>) : <p className="caption">No professional evidence recorded. The responsible Doctor or assigned Nurse records it from their own account.</p>}</fieldset>
    <CareField label="Decision authority / responsible position" name="authority" />
    <label>Reason<textarea name="reason" required minLength={3} maxLength={1000} /></label>
    <label>Operational evidence and reference<textarea name="evidence" required minLength={3} maxLength={1000} /></label>
    <SourceSelect name="followUpOwnerId" title="Accountable follow-up owner" options={staff.map(s => ({ id: s.id, label: `${s.name} · ${s.role}` }))} />
    <p className="caption">This records authority for the selected action. Professional signatures and actual payments are recorded separately.</p>
  </CareForm>;
}
export function ProfessionalEvidenceForm({ action, role, sources, authorities, status }: { action: CareAction; role: "DOCTOR" | "NURSE"; sources: Source[]; authorities: Authority[]; status: string }) {
  const kinds = role === "DOCTOR" ? ["PLANNED_EXIT", "EARLY_EXIT", "AGAINST_ADVICE", "EXTERNAL_TRANSFER", "DEATH", "RETURN_TO_BED", "RETURN_CANCELLED"] : status === "DISCHARGED" ? ["ROOM_CUTOFF"] : ["PHYSICAL_EXIT", "TRANSFER_HANDOVER", "RETURN_HANDOVER", "ROOM_CUTOFF"];
  const [kind, setKind] = useState(kinds[0]), [authorityId, setAuthorityId] = useState("");
  const cutoff = authorities.find(a => a.id === authorityId);
  return <CareForm action={action} button={`Sign actual ${role === "DOCTOR" ? "Doctor" : "Nurse"} evidence`} testId="exception-evidence">
    <label>Professional record<select name="kind" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(k => <option value={k} key={k}>{label(k)}</option>)}</select></label>
    {kind === "ROOM_CUTOFF" ? <><label>Original correction authority<select name="exceptionId" value={authorityId} onChange={e => setAuthorityId(e.target.value)} required><option value="">Choose current authority</option>{authorities.filter(a => a.type === "ROOM_CUTOFF_CORRECTION").map(a => <option key={a.id} value={a.id}>{sources.find(s => s.id === a.sourceId)?.label ?? "Retained final stay"}</option>)}</select></label><input type="hidden" name="sourceId" value={cutoff?.sourceId ?? ""} /></> : ["RETURN_TO_BED", "RETURN_CANCELLED", "RETURN_HANDOVER", "TRANSFER_HANDOVER"].includes(kind) && <SourceSelect name="sourceId" title="Original professional source" options={sources.filter(s => s.kind === (kind === "TRANSFER_HANDOVER" ? "TRANSFER_ORDER" : kind === "RETURN_CANCELLED" ? "RETURN_INSTRUCTION" : "VACATION"))} />}
    {kind === "RETURN_CANCELLED" && <p className="notice">Sign your revised clinical decision that this specific return is no longer required. A witnessed actual return must be recorded; it cannot be cancelled here. Discharge still requires renewed sequential human reviews.</p>}
    {role === "NURSE" && <SourceSelect name="shiftId" title="My actual witnessing shift" options={sources.filter(s => s.kind === "SHIFT")} />}
    <CareField label={kind === "PHYSICAL_EXIT" ? "Actual hospital exit (UTC)" : "Actual event time (UTC)"} name="actualAt" type="datetime-local" />
    {kind === "PHYSICAL_EXIT" && <CareField label="Actual bed vacancy (UTC)" name="vacatedAt" type="datetime-local" />}
    <label>Actual professional findings / witnessed facts<textarea name="notes" required minLength={3} maxLength={1000} /></label>
    <p className="caption">Your name and current role are recorded by the server. Against-advice, external-transfer and death dispositions require the responsible Doctor.</p>
  </CareForm>;
}
export function ActualCashFields({ refund = false, receipt = false }: { refund?: boolean; receipt?: boolean }) {
  return <>
    {receipt && <><label>Money received from<select name="party"><option value="PATIENT">Patient</option><option value="INSURER">Insurer</option></select></label><label>Receipt purpose<select name="receiptKind"><option value="PAYMENT">Bill payment</option><option value="TOP_UP">Patient deposit top-up</option></select></label></>}
    <CareField label="Actual amount (₹)" name="amount" type="number" step="0.01" />
    <label>Actual payment channel<select name="mode"><option>CASH</option><option>UPI</option><option>CARD</option><option>BANK</option></select></label>
    <CareField label="Cash book / bank / channel name" name="channel" />
    <CareField label="Unique actual transaction reference" name="sourceReference" />
    {refund ? <><CareField label="Actual return time (UTC)" name="refundedAt" type="datetime-local" /><CareField label="Receipt evidence for money returned" name="evidence" /><CareField label="Reason for actual return" name="reason" /></> : <CareField label="Receipt evidence / description" name="reference" />}
  </>;
}
