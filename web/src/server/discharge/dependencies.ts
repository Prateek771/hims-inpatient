import "server-only";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Transaction } from "../db";
import { admissions } from "../admissions/schema";
import { transferAuthority } from "../admissions/transfer-authority";
import { clinicalSummaries } from "../clinical/schema";
import { pharmacyClearanceSourceInTransaction } from "../pharmacy/commands";
import { clearanceInvalidations, clearanceSeals, gates, type Gate } from "./schema";
import { effectiveRoomVacations as roomVacations } from "./schema";
import { billProjection, financialResponsibilityInTransaction } from "../billing/commands";
import { formatINR } from "../billing/money";

export const dependencyGate = { CLINICAL: "DOCTOR", PHARMACY: "PHARMACY", MAR: "PHARMACY", NURSING: "NURSING", MONEY: "BILLING", INSURANCE: "BILLING", ROOM: "BILLING" } as const;
export type ChangeKind = keyof typeof dependencyGate;
export function jsonSnapshot(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v));
}
export function reviewHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(jsonSnapshot(value))).digest("hex");
}
/** Caller holds the owning admission lock. Native source triggers use the same mapping. */
export async function invalidateAffectedClearances(tx: Transaction, input: { admissionId: string; changeKind: ChangeKind; changedRecordIds: string[] }) {
  await tx.execute(sql`select hims.invalidate_clearances(${input.admissionId}::uuid, ${dependencyGate[input.changeKind]}, ${input.changeKind}, ${JSON.stringify(input.changedRecordIds)}::jsonb)`);
}
async function rows(tx: Transaction, query: SQL) { return (await tx.execute(query)).rows; }
export async function clinicalClearanceInputs(tx: Transaction, id: string) {
  const [summary] = await tx.select().from(clinicalSummaries).where(eq(clinicalSummaries.admissionId, id)).orderBy(desc(clinicalSummaries.version)).limit(1);
  const rounds = await rows(tx, sql`select * from hims.clinical_rounds where admission_id=${id} order by id`);
  const addenda = await rows(tx, sql`select a.* from hims.clinical_addenda a join hims.clinical_rounds r on r.id=a.note_id where r.admission_id=${id} order by a.id`);
  const orders = await rows(tx, sql`select * from hims.clinical_orders where admission_id=${id} order by id`);
  const events = await rows(tx, sql`select e.* from hims.clinical_task_events e join hims.clinical_orders o on o.id=e.order_id where o.admission_id=${id} order by e.id`);
  const reports = await rows(tx, sql`select * from hims.lab_reports where admission_id=${id} order by id`);
  const reportAddenda = await rows(tx, sql`select a.* from hims.lab_report_addenda a join hims.lab_reports r on r.id=a.report_id where r.admission_id=${id} order by a.id`);
  const dispositions = await rows(tx, sql`select * from hims.lab_dispositions where admission_id=${id} order by id`);
  const transfers = await rows(tx, sql`select * from hims.admission_transfers where admission_id=${id} order by id`);
  const transferState = await transferAuthority(tx, id);
  const transferOrders = await rows(tx, sql`select * from hims.transfer_orders where admission_id=${id} order by version desc`);
  const exceptionInstructions = await rows(tx, sql`select * from hims.exception_evidence where admission_id=${id} and role='DOCTOR' order by id`);
  const returns = await rows(tx, sql`select * from hims.room_returns where admission_id=${id} order by id`);
  const blockers: string[] = [];
  if (!summary) blockers.push("Doctor must sign the clinical summary and explicit take-home prescription.");
  if (exceptionInstructions.some(p => p.kind === "RETURN_TO_BED" && !returns.some(r => r.doctor_evidence_id === p.id) && !exceptionInstructions.some(r => r.kind === "RETURN_CANCELLED" && r.source_id === p.id))) blockers.push("Current Doctor return instruction requires actual return or an explicit source-bound Doctor reconsideration before ordinary discharge.");
  for (const o of orders) {
    const completed = events.some(e => e.order_id === o.id && e.status === "COMPLETED");
    const stopped = events.some(e => e.order_id === o.id && e.status === "STOPPED");
    if (o.kind === "PROCEDURE" && !completed && !stopped) blockers.push(`${o.requested_item}: Doctor must complete or explicitly stop this procedure.`);
    if (["LAB", "RADIOLOGY"].includes(String(o.kind)) && !reports.some(r => r.order_id === o.id) && !dispositions.some(d => d.order_id === o.id)) blockers.push(`${o.requested_item}: diagnostic report or attributable unperformed disposition is missing.`);
    const details = o.details as { medicationPurpose?: string };
    if (o.kind === "MEDICINE" && !stopped && ["TAKE_HOME", "BOTH"].includes(details.medicationPurpose ?? "") && !summary?.prescription.some(p => p.orderId === o.id)) blockers.push(`${o.requested_item}: current take-home order is absent from the signed prescription.`);
  }
  if (transferState.orders[0] && (["PENDING", "WITNESSED"].includes(transferState.orders[0].status) || transferState.orders[0].pendingFactualMove)) blockers.push("Current Doctor transfer order or witnessed earlier move requires attributable review and factual recording.");
  return { inputs: jsonSnapshot({ summary: summary ?? null, rounds, addenda, orders, events, reports, reportAddenda, dispositions, transfers, transferOrders, ...(transferState.cancellations.length ? { transferCancellations: transferState.cancellations } : {}), exceptionInstructions, returns }), blockers };
}
export async function pharmacyClearanceInputs(tx: Transaction, episode: typeof admissions.$inferSelect) {
  const source = await pharmacyClearanceSourceInTransaction(tx, episode);
  const mar = await rows(tx, sql`select * from hims.medication_administrations where admission_id=${episode.id} order by id`);
  const corrections = await rows(tx, sql`select * from hims.nursing_addenda where admission_id=${episode.id} and record_type='MAR' order by id`);
  const medicineMoney = await rows(tx, sql`select c.id,c.source_event_id,c.amount_paise,c.tariff_version_id,r.id as reversal_id,r.amount_paise as reversed_paise from hims.charges c left join hims.charge_reversals r on r.charge_id=c.id where c.admission_id=${episode.id} and c.category='medicine' order by c.id,r.id`);
  return { inputs: jsonSnapshot({ orders: source.orders.toSorted((a,b)=>a.id.localeCompare(b.id)), prescription: source.prescription ?? null, preparations: source.preparations, issues: source.issues.toSorted((a,b)=>a.id.localeCompare(b.id)), medicineMoney, mar, corrections, safety: source.unresolved }), blockers: source.unresolved };
}
export async function nursingClearanceInputs(tx: Transaction, id: string) {
  const observations = await rows(tx, sql`select * from hims.nursing_observations where admission_id=${id} order by id`);
  const mar = await rows(tx, sql`select * from hims.medication_administrations where admission_id=${id} order by id`);
  const addenda = await rows(tx, sql`select * from hims.nursing_addenda where admission_id=${id} order by id`);
  const shifts = await rows(tx, sql`select s.*,e.id as end_id,e.ended_at,e.handover as end_handover,e.signed_by as end_signed_by,e.signed_at as end_signed_at,e.end_kind,e.operational_evidence from hims.nursing_shifts s left join hims.effective_shift_ends e on e.shift_id=s.id where s.admission_id=${id} order by s.id`);
  const consumables = await rows(tx, sql`select * from hims.nursing_consumables where admission_id=${id} order by id`);
  const consumableMoney = await rows(tx, sql`select c.id,c.source_event_id,c.amount_paise,r.id as reversal_id,r.amount_paise as reversed_paise from hims.charges c left join hims.charge_reversals r on r.charge_id=c.id where c.admission_id=${id} and c.category='consumable' order by c.id,r.id`);
  const transfers = await rows(tx, sql`select * from hims.admission_transfers where admission_id=${id} order by id`);
  const unresolved = await rows(tx, sql`select id from hims.care_billing_events where admission_id=${id} and category='consumable' and state<>'POSTED' order by id`);
  const exceptionFacts = await rows(tx, sql`select * from hims.exception_evidence where admission_id=${id} and role='NURSE' order by id`);
  // Ordinary first vacancy follows this seal. Only later amended witnesses reopen its review.
  const amendedVacancies = await rows(tx, sql`select * from hims.effective_vacation_facts where admission_id=${id} and amendment_id is not null order by id`);
  return { inputs: jsonSnapshot({ observations, mar, addenda, shifts, consumables, consumableMoney, transfers, exceptionFacts, amendedVacancies }), blockers: unresolved.map(() => "Nursing consumable charge requires source/price reconciliation.") };
}
export async function latestSeals(tx: Transaction, admissionId: string) {
  const all = await tx.select({ seal: clearanceSeals, invalidation: clearanceInvalidations }).from(clearanceSeals).leftJoin(clearanceInvalidations, eq(clearanceInvalidations.sealId, clearanceSeals.id)).where(eq(clearanceSeals.admissionId, admissionId)).orderBy(desc(clearanceSeals.signedAt), desc(clearanceSeals.id));
  return { all, currentCandidates: Object.fromEntries(gates.map(g => [g, all.find(r => r.seal.gate === g && !r.invalidation)?.seal])) as Record<Gate, typeof clearanceSeals.$inferSelect | undefined> };
}
export async function billingClearanceInputs(tx: Transaction, episode: typeof admissions.$inferSelect, reviewedBill?: Awaited<ReturnType<typeof billProjection>>) {
  const bill=reviewedBill??await billProjection(tx,episode,new Date()), financial=await financialResponsibilityInTransaction(tx,episode,bill);
  const [vacation]=await tx.select().from(roomVacations).where(eq(roomVacations.admissionId,episode.id));
  const unresolved=await rows(tx,sql`select b.id,b.category,b.state from hims.care_billing_events b
    left join hims.lab_dispositions d on d.order_id=b.order_id
    where b.admission_id=${episode.id} and b.state<>'POSTED' and d.id is null
    and not (b.category='procedure' and exists(select 1 from hims.clinical_task_events e where e.order_id=b.order_id and e.status='STOPPED') and not exists(select 1 from hims.clinical_task_events e where e.order_id=b.order_id and e.status='COMPLETED')) order by b.id`);
  const blockers:string[]=[];
  const pending=await rows(tx,sql`select c.id from hims.charges c
    left join hims.care_billing_events b on b.id::text=c.source_event_id
    left join hims.lab_dispositions d on d.order_id=b.order_id
    where c.admission_id=${episode.id} and c.initial_status='PENDING'
    and not exists(select 1 from hims.charge_finalizations f where f.charge_id=c.id)
    and d.id is null
    and not (c.amount_paise>0 and c.amount_paise<=(select coalesce(sum(r.amount_paise),0) from hims.charge_reversals r where r.charge_id=c.id))
    and not (coalesce(b.category,'')='procedure' and exists(select 1 from hims.clinical_task_events e where e.order_id=b.order_id and e.status='STOPPED') and not exists(select 1 from hims.clinical_task_events e where e.order_id=b.order_id and e.status='COMPLETED')) order by c.id`);
  if(!vacation)blockers.push("Nursing must record actual end of physical bed use; room charges continue while occupied.");
  if(pending.length||bill.pendingPaise>0n||unresolved.length)blockers.push("Department work has unresolved or pending financial sources.");
  if(bill.unpostedRoomPaise>0n)blockers.push("Reconcile actual room charges before final review.");
  const r=financial.responsibility;
  if(!r?.allocationComplete)blockers.push("Current complete payer responsibility requires staff review.");
  if(r?.insurerOutstandingPaise)blockers.push(`Actual insurer money still owed: ${formatINR(r.insurerOutstandingPaise)}.`);
  if(r?.patientOutstandingPaise)blockers.push(`Patient settlement still owed: ${formatINR(r.patientOutstandingPaise)}.`);
  if(r?.insurerExcessPaise||r?.patientExcessPaise||bill.unallocatedDepositPaise>0n||bill.overpaidPaise>0n)blockers.push("Excess money or unallocated deposit requires a recorded refund/allocation review.");
  if(financial.pendingTransfers.length)blockers.push("Insurance transfer follow-up still requires its recorded staff resolution.");
  const {asOf: _asOf, unpostedRoomPaise: _estimate,status:_status,...stableBill}=bill;void _asOf;void _estimate;void _status;
  const physicalUse=vacation?{id:vacation.id,stayId:vacation.stayId,nursingSealId:vacation.nursingSealId,shiftId:vacation.shiftId,vacatedAt:vacation.vacatedAt,waitingLocation:vacation.waitingLocation,signedBy:vacation.signedBy,signedAt:vacation.signedAt,amendmentId:vacation.amendmentId,evidenceId:vacation.evidenceId,originalVacatedAt:vacation.originalVacatedAt,originalShiftId:vacation.originalShiftId,originalSignedBy:vacation.originalSignedBy,originalSignedAt:vacation.originalSignedAt}:null;
  return {inputs:jsonSnapshot({bill:stableBill,financial,vacation:physicalUse,unresolved,pending}),blockers,bill,financial,vacation};
}
