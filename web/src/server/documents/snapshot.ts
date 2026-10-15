import "server-only";
import { and, asc, desc, eq, getTableColumns, getViewSelectedFields, inArray, sql } from "drizzle-orm";
import type { Transaction } from "../db";
import { DomainError } from "../contracts";
import { admissions, beds, effectivePatients, effectiveRoomStays, roomStays as originalRoomStays } from "../admissions/schema";
import { user } from "../schema/auth";
import { settingVersions } from "../schema/core";
import { clinicalSummaries } from "../clinical/schema";
import { clearanceSeals, clearanceInvalidations, departures, gates, type Gate } from "../discharge/schema";
import { adminExceptions, exceptionalDepartures, exceptionFollowups } from "../discharge/exception-schema";
import { clinicalClearanceInputs, nursingClearanceInputs, jsonSnapshot } from "../discharge/dependencies";
import { billProjection, financialResponsibilityInTransaction } from "../billing/commands";
import { dischargeStatement } from "../billing/statement";

import { assertDocumentSourceSize } from "./content";
export { canonicalJSON, snapshotHash, assertDocumentSourceSize } from "./content";
type Json<T> = T extends Date ? string : T extends bigint ? string : T extends (infer V)[] ? Json<V>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
function json<T>(value: T): Json<T> { return jsonSnapshot(value) as Json<T>; }

/** Caller owns settings/staff and the admission lock. Never refresh dynamic medicine safety at a later print date. */
export async function documentSourceInTransaction(tx: Transaction, e: typeof admissions.$inferSelect) {
  if (e.status !== "DISCHARGED") throw new DomainError("PRECONDITION", "Final copies require a recorded actual hospital departure");
  if(!e.admittingDoctorId)throw new DomainError("PRECONDITION","Legacy documents require the retained original Doctor identity");
  const [ordinary] = await tx.select().from(departures).where(eq(departures.admissionId, e.id));
  const [exceptional] = await tx.select().from(exceptionalDepartures).where(eq(exceptionalDepartures.admissionId, e.id));
  if (!!ordinary === !!exceptional) throw new DomainError("PRECONDITION", "One consistent recorded departure source is required");
  const actual = ordinary ?? exceptional;
  const { inputs: _inputsColumn, ...sealColumns } = getTableColumns(clearanceSeals); void _inputsColumn;
  const all = await tx.select({ seal: sealColumns, invalidation: clearanceInvalidations }).from(clearanceSeals).leftJoin(clearanceInvalidations, eq(clearanceInvalidations.sealId, clearanceSeals.id)).where(eq(clearanceSeals.admissionId, e.id)).orderBy(desc(clearanceSeals.signedAt), desc(clearanceSeals.id));
  const selected = new Map<Gate, typeof all[number]["seal"]>();
  if (ordinary) {
    let next: string | null = ordinary.billSealId;
    for (const gate of [...gates].reverse()) {
      const seal = all.find(r => r.seal.id === next)?.seal;
      // Original gate hashes used insertion-ordered JSON. JSONB reorders keys, so retain
      // that original hash; native immutable records and this exact predecessor chain bind it.
      if (!seal || seal.gate !== gate || (gate === "BILLING" && seal.billVersion !== ordinary.billVersion)) throw new DomainError("PRECONDITION", "Stored departure clearance sources are inconsistent");
      selected.set(gate, seal); next = seal.predecessorId;
    }
    if (next) throw new DomainError("PRECONDITION", "Doctor clearance must begin the departure chain");
  } else {
    const historical = exceptional.snapshot.seals as { seal?: { id?: string; gate?: string }; invalidation?: unknown }[] | undefined;
    for (const gate of gates) {
      const pinned = historical?.find(r => r.seal?.gate === gate && !r.invalidation);
      const seal = all.find(r => r.seal.id === pinned?.seal?.id)?.seal;
      if (seal) selected.set(gate, seal);
    }
  }
  // Identity versions are shared across this patient's episodes; own that source as well.
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`document-identity:${e.patientId}`},0))`);
  const [patient] = await tx.select().from(effectivePatients).where(eq(effectivePatients.id, e.patientId));
  const [hospital] = await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId, e.hospitalId), sql`${settingVersions.payload}->>'type'='hospital'`)).orderBy(desc(settingVersions.version)).limit(1);
  const [summary] = await tx.select().from(clinicalSummaries).where(eq(clinicalSummaries.admissionId, e.id)).orderBy(desc(clinicalSummaries.version)).limit(1);
  const clinical = await clinicalClearanceInputs(tx, e.id), nursing = await nursingClearanceInputs(tx, e.id);
  const physicalBeds = await tx.select({ bedId: effectiveRoomStays.bedId }).from(effectiveRoomStays).where(eq(effectiveRoomStays.admissionId, e.id));
  if (physicalBeds.length) await tx.select({ id: beds.id }).from(beds).where(inArray(beds.id, [...new Set(physicalBeds.map(s => s.bedId))])).orderBy(asc(beds.id)).for("share");
  // Bed identity is mutable; fetch it only AFTER the sorted physical-source locks.
  const stayRows = await tx.select({ stay: getViewSelectedFields(effectiveRoomStays), bedLabel: beds.label, category: beds.category, originalStartedAt: originalRoomStays.startedAt, originalTariff: settingVersions.payload }).from(effectiveRoomStays).innerJoin(beds, eq(beds.id, effectiveRoomStays.bedId)).innerJoin(originalRoomStays, eq(originalRoomStays.id, effectiveRoomStays.id)).innerJoin(settingVersions, eq(settingVersions.id, effectiveRoomStays.tariffVersionId)).where(eq(effectiveRoomStays.admissionId, e.id)).orderBy(asc(effectiveRoomStays.startedAt), asc(effectiveRoomStays.id));
  const stays = stayRows.map(r => ({ ...r.stay, bedLabel: r.bedLabel, category: r.category, originalStartedAt: r.originalStartedAt, originalTariff: r.originalTariff }));
  const transfers = (await tx.execute(sql`select t.*,b.label as target_bed_label from hims.admission_transfers t join hims.beds b on b.id=t.target_bed_id where t.admission_id=${e.id} order by t.transferred_at,t.id`)).rows;
  const amendments = (await tx.execute(sql`select * from hims.post_discharge_amendments where admission_id=${e.id} order by signed_at,id`)).rows;
  const identities = (await tx.execute(sql`select * from hims.patient_identifications where patient_id=${e.patientId} order by version`)).rows;
  const boundaries = (await tx.execute(sql`select * from hims.stay_boundary_amendments where admission_id=${e.id} order by stay_id,version`)).rows;
  const vacancy = (await tx.execute(sql`select * from hims.effective_vacation_facts where admission_id=${e.id} order by vacated_at,id`)).rows;
  const evidence = (await tx.execute(sql`select * from hims.exception_evidence where admission_id=${e.id} order by signed_at,id`)).rows;
  const authorities = (await tx.execute(sql`select * from hims.admin_exceptions where admission_id=${e.id} order by signed_at,id`)).rows;
  const followups = (await tx.execute(sql`select * from hims.exception_followups where admission_id=${e.id} order by signed_at,id`)).rows;
  const [authority] = exceptional ? await tx.select().from(adminExceptions).where(eq(adminExceptions.id, exceptional.exceptionId)) : [];
  // Match the existing accountable-owner command's latest signed follow-up rule.
  const [currentFollowup] = authority ? await tx.select().from(exceptionFollowups).where(eq(exceptionFollowups.exceptionId, authority.id)).orderBy(desc(exceptionFollowups.signedAt)).limit(1) : [];
  const names = await tx.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.id)).for("share");
  const name = (id: string) => names.find(n => n.id === id)?.name ?? id;
  const bill = await billProjection(tx, e, actual.departedAt), financial = await financialResponsibilityInTransaction(tx, e, bill);
  const { asOf: _asOf, ...billColumns } = bill; void _asOf;
  // Additive nullable provenance must not change old document source hashes.
  const stableBill = { ...billColumns,
    charges: billColumns.charges.map(({ correctionExceptionId, ...line }) => ({ ...line, ...(correctionExceptionId ? { correctionExceptionId } : {}) })),
    reversals: billColumns.reversals.map(({ correctionExceptionId, physicalAmendmentId, ...line }) => ({ ...line, ...(correctionExceptionId ? { correctionExceptionId } : {}), ...(physicalAmendmentId ? { physicalAmendmentId } : {}) })),
  };
  const totals = [
    { label: "Gross finalized charges", paise: bill.grossPaise.toString() }, { label: "Returns / linked adjustments", paise: bill.reversedPaise.toString() }, { label: "Net bill", paise: bill.netPaise.toString() },
    { label: "Insurer authorization (not money received)", paise: e.paymentRoute === "INSURED" && !financial.decisionId ? null : financial.insurerAuthorizedPaise.toString() }, { label: "Actual insurer payment received", paise: bill.insurerReceivedPaise.toString() },
    { label: "Actual patient deposits / payments received", paise: bill.patientReceivedPaise.toString() }, { label: "Deposit allocated (existing cash, not another receipt)", paise: bill.depositAllocatedPaise.toString() },
    { label: "Actual refunds paid", paise: bill.refundedPaise.toString() }, { label: "Actual money retained after refunds", paise: bill.retainedPaise.toString() },
    { label: "Outstanding posted bill", paise: bill.outstandingPaise.toString() }, { label: "Unallocated deposit", paise: bill.unallocatedDepositPaise.toString() }, { label: "Pending charges", paise: bill.pendingPaise.toString() },
    { label: "Patient amount remaining", paise: financial.responsibility?.allocationComplete ? financial.responsibility.patientOutstandingPaise.toString() : null },
    { label: "Insurer amount remaining", paise: financial.responsibility?.allocationComplete ? financial.responsibility.insurerOutstandingPaise.toString() : null },
    { label: "Patient excess requiring disposition", paise: financial.responsibility?.allocationComplete ? financial.responsibility.patientExcessPaise.toString() : null },
    { label: "Insurer excess requiring disposition", paise: financial.responsibility?.allocationComplete ? financial.responsibility.insurerExcessPaise.toString() : null },
  ];
  const seals = gates.map(gate => {
    const seal = selected.get(gate), invalidation = all.find(r => r.seal.id === seal?.id)?.invalidation ?? null;
    return { gate, seal: seal ? { ...seal, signerName: name(seal.signedBy) } : null, invalidation };
  });
  const pharmacySeal = selected.get("PHARMACY"), [pharmacySource] = pharmacySeal ? await tx.select({ inputs: clearanceSeals.inputs }).from(clearanceSeals).where(eq(clearanceSeals.id, pharmacySeal.id)) : [];
  const {mvpFinanceId:_mvpFinanceId,...legacyOrdinary}=ordinary??{};void _mvpFinanceId;
  const departureRecord = exceptional ? { ...exceptional, snapshot: { ...exceptional.snapshot, seals: (exceptional.snapshot.seals as { seal?: Record<string, unknown>; invalidation?: unknown }[] | undefined)?.map(r => {
    if (!r.seal) return r; const { inputs: _originalInputs, ...record } = r.seal; void _originalInputs; return { ...r, seal: record };
  }) } } : legacyOrdinary as Omit<NonNullable<typeof ordinary>,"mvpFinanceId">;
  const source = json({
    hospital: hospital ? { id: hospital.id, version: hospital.version, payload: hospital.payload } : null,
    patient: patient ?? null,
    admission: { id: e.id, ipCode: e.ipCode, hospitalId: e.hospitalId, admittedAt: e.admittedAt, paymentRoute: e.paymentRoute, doctorId: e.admittingDoctorId, doctorName: name(e.admittingDoctorId) },
    departure: { kind: ordinary ? "ORDINARY" as const : "EXCEPTIONAL" as const, record: departureRecord, exception: authority ? { ...authority, signerName: name(authority.signedBy), followUpOwnerName: name(authority.followUpOwnerId), currentFollowUpOwnerId: currentFollowup?.ownerId ?? authority.followUpOwnerId, currentFollowUpOwnerName: name(currentFollowup?.ownerId ?? authority.followUpOwnerId), currentFollowupId: currentFollowup?.id ?? null } : null, clinicalStatus: exceptional?.snapshot.clinicalStatus ?? "FOUR_HUMAN_CLEARANCES_AT_DEPARTURE" },
    clinical: { summary: summary ? { ...summary, signerName: name(summary.signedBy) } : null, rounds: clinical.inputs.rounds as Record<string, unknown>[], addenda: clinical.inputs.addenda as Record<string, unknown>[], orders: clinical.inputs.orders as Record<string, unknown>[], events: clinical.inputs.events as Record<string, unknown>[], reports: clinical.inputs.reports as Record<string, unknown>[], reportAddenda: clinical.inputs.reportAddenda as Record<string, unknown>[] },
    money: { bill: stableBill, statement: dischargeStatement(bill, stays, boundaries), financial, totals }, seals, stays, transfers,
    provenance: { amendments, identities, boundaries, vacancy, evidence, authorities, followups: followups.map(r => ({ ...r, ownerName: name(String(r.owner_id)), signerName: name(String(r.signed_by)) })), nursing: nursing.inputs, pharmacyAtDeparture: pharmacySource?.inputs ?? null },
  });
  assertDocumentSourceSize(source);
  return source;
}
export type DocumentSource = Awaited<ReturnType<typeof documentSourceInTransaction>>;
export type DischargeSnapshot = DocumentSource & { documentId: string; version: number; createdAt: string; verificationUrl: string; sourceHash: string };
