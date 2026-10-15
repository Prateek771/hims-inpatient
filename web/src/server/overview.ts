import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { assertHumanActor, DomainError, type CommandContext, type StaffRole } from "./contracts";
import { staffRoles } from "./auth";
import { user, hospitalSettings, settingVersions } from "./schema";
import { admissions, beds, bedHolds, effectivePatients as patients } from "./admissions/schema";
import { clinicalOrders, clinicalSummaries, careOccurrences, clinicalTaskEvents } from "./clinical/schema";
import { nursingObservations, medicationAdministrations } from "./nursing/schema";
import { pharmacyBatches } from "./pharmacy/schema";
import { pharmacyClearanceSourceInTransaction, stockUnits, stockQuantity, hospitalDate } from "./pharmacy/commands";
import { billProjection, financialResponsibilityInTransaction } from "./billing/commands";
import { clearanceStateInTransaction } from "./discharge/commands";
import { insuranceCases, insuranceDocuments, insuranceEvents, insuranceDecisions } from "./insurance/schema";
import { paperworkRuns } from "./insurance/paperwork-schema";
import { transferAuthority } from "./admissions/transfer-authority";

export type StaffAlert = {
  id: string; kind: string; ownerRole: StaffRole; ownerName?: string;
  admissionId?: string; caseId?: string; name?: string; ipCode?: string; bedLabel?: string;
  action: string; detail: string; href: string; dueAt?: string; amountPaise?: string;
};
export type WorkEpisode = { id: string; name: string; ipCode: string; bedLabel: string; bedCategory: string; status: string; href: string; action: string };
const clockInput = z.strictObject({ asOf: z.date().optional(), bedCategory: z.string().trim().regex(/^[A-Z0-9_-]{2,32}$/).optional() });
const paths: Record<StaffRole, string> = { ADMIN: "/billing", ADMISSION: "/admissions", DOCTOR: "/clinical", NURSE: "/nursing", PHARMACY: "/pharmacy", LAB: "/lab", INSURANCE: "/insurance", BILLING: "/billing" };
const names: Record<StaffRole, string> = { ADMIN: "Hospital administrator", ADMISSION: "Admission desk", DOCTOR: "Admitting Doctor", NURSE: "Assigned nursing team", PHARMACY: "Pharmacy", LAB: "Lab / radiology", INSURANCE: "Insurance desk", BILLING: "Billing desk" };

async function authorize(tx: Transaction, ctx: CommandContext, adminOnly = false) {
  const actor = assertHumanActor(ctx);
  z.uuid().parse(ctx.requestId);
  if (!ctx.source.trim()) throw new DomainError("VALIDATION", "Source is required");
  // A read snapshot does not take patient/staff write locks or produce audit/task rows.
  const [staff] = await tx.select({ id: user.id, role: user.role, name: user.name, banned: user.banned }).from(user).where(eq(user.id, actor.staffId));
  if (!staff || staff.banned || !staffRoles.includes(staff.role as StaffRole) || (adminOnly && staff.role !== "ADMIN"))
    throw new DomainError("FORBIDDEN", "Staff workspace access denied");
  return { ...staff, role: staff.role as StaffRole };
}

async function projection(tx: Transaction, ctx: CommandContext, input: z.infer<typeof clockInput>, adminOnly = false) {
  const staff = await authorize(tx, ctx, adminOnly), asOf = input.asOf ?? new Date();
  const [hospital] = await tx.select().from(hospitalSettings).limit(1);
  const timezone = hospital?.timezone ?? "Asia/Kolkata";
  const versions = hospital ? await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, hospital.id)).orderBy(desc(settingVersions.version)) : [];
  const categories = [...new Map(versions.filter(v => v.payload.type === "bed-category").map(v => [String(v.payload.code), { code: String(v.payload.code), name: String(v.payload.name) }] as const).reverse()).values()];
  if (input.bedCategory && !categories.some(c => c.code === input.bedCategory)) throw new DomainError("VALIDATION", "Choose a configured bed category");
  const categoryScope = input.bedCategory ? eq(beds.category, input.bedCategory) : undefined;
  const scopes: Partial<Record<StaffRole, SQL>> = {
    DOCTOR: eq(admissions.admittingDoctorId, staff.id),
    NURSE: sql`exists(select 1 from hims.nurse_assignments a where a.admission_id=${admissions.id} and a.nurse_id=${staff.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=a.id))`,
    INSURANCE: eq(insuranceCases.assignedStaffId, staff.id),
    PHARMACY: sql`(exists(select 1 from hims.clinical_orders o where o.admission_id=${admissions.id} and o.kind='MEDICINE') or exists(select 1 from hims.clinical_summaries s where s.admission_id=${admissions.id}))`,
    LAB: sql`exists(select 1 from hims.care_tasks t where t.admission_id=${admissions.id} and t.owner_role='LAB')`,
  };
  const currentScope = and(scopes[staff.role], categoryScope);
  const closed = ["ADMIN", "BILLING", "ADMISSION", "DOCTOR", "INSURANCE"].includes(staff.role)
    ? tx.select({ id: admissions.id }).from(admissions).innerJoin(beds, eq(beds.id, admissions.bedId)).leftJoin(insuranceCases, eq(insuranceCases.admissionId, admissions.id))
      .where(and(currentScope, inArray(admissions.status, ["CANCELLED", "DISCHARGED"]))).orderBy(desc(admissions.registeredAt), desc(admissions.id)).limit(50) : null;
  const rows = await tx.select({ episode: admissions, name: patients.name, bedLabel: beds.label, bedCategory: beds.category, case: insuranceCases })
    .from(admissions).innerJoin(patients, eq(patients.id, admissions.patientId)).innerJoin(beds, eq(beds.id, admissions.bedId))
    .leftJoin(insuranceCases, eq(insuranceCases.admissionId, admissions.id))
    .where(and(currentScope, sql`(${admissions.status} in ('PENDING','ADMITTED') ${closed ? sql`or ${admissions.id} in (${closed})` : sql``})`))
    .orderBy(desc(admissions.registeredAt), desc(admissions.id));
  const active = rows.filter(r => r.episode.status === "ADMITTED"), ids = rows.map(r => r.episode.id);
  const alerts: StaffAlert[] = [], episodes: WorkEpisode[] = [];
  const financial: { admissionId: string; netPaise: string; patientCashPaise: string; insurerCashPaise: string; heldDepositPaise: string; patientDuePaise: string | null; insurerDuePaise: string | null; allocationCurrent: boolean; authorizedPaise: string | null }[] = [];
  const discharge: { admissionId: string; name: string; ipCode: string; bedLabel: string; ownerRole: StaffRole | null; stage: string; href: string }[] = [];
  const add = (row: typeof rows[number] | null, kind: string, sourceId: string, ownerRole: StaffRole, action: string, detail: string, href?: string, extra: Partial<StaffAlert> = {}) => {
    if (staff.role !== "ADMIN" && ownerRole !== staff.role && !(staff.role === "BILLING" && ownerRole === "INSURANCE")) return;
    alerts.push({ id: `${kind}:${sourceId}`, kind, ownerRole, ownerName: names[ownerRole], ...(row ? { admissionId: row.episode.id, caseId: row.case?.id, name: row.name, ipCode: row.episode.ipCode, bedLabel: row.bedLabel } : {}), action, detail,
      href: staff.role === "ADMIN" && ["DOCTOR", "NURSE", "LAB"].includes(ownerRole) ? (kind === "PENDING_SEAL" ? `/discharge?admissionId=${row?.episode.id}` : "/admin/care") : href ?? `${paths[ownerRole]}?${ownerRole === "INSURANCE" && row?.case ? `caseId=${row.case.id}` : `admissionId=${row?.episode.id ?? ""}`}`, ...extra });
  };
  const orders = ids.length ? await tx.select({ id: clinicalOrders.id, admissionId: clinicalOrders.admissionId, kind: clinicalOrders.kind, requestedItem: clinicalOrders.requestedItem }).from(clinicalOrders).where(inArray(clinicalOrders.admissionId, ids)) : [];
  const summaries = ids.length ? await tx.select({ id: clinicalSummaries.id, admissionId: clinicalSummaries.admissionId }).from(clinicalSummaries).where(inArray(clinicalSummaries.admissionId, ids)) : [];
  const events = orders.length ? await tx.select({ orderId: clinicalTaskEvents.orderId, status: clinicalTaskEvents.status }).from(clinicalTaskEvents).where(inArray(clinicalTaskEvents.orderId, orders.map(o => o.id))) : [];
  const stopped = new Set(events.filter(e => e.status === "STOPPED").map(e => e.orderId)), completed = new Set(events.filter(e => e.status === "COMPLETED").map(e => e.orderId));
  if (["NURSE", "ADMIN"].includes(staff.role) && active.length) {
    const due = await tx.select({ id: careOccurrences.id, admissionId: careOccurrences.admissionId, orderId: careOccurrences.orderId, scheduledAt: careOccurrences.scheduledAt, kind: clinicalOrders.kind })
      .from(careOccurrences).innerJoin(clinicalOrders, eq(clinicalOrders.id, careOccurrences.orderId))
      .leftJoin(nursingObservations, eq(nursingObservations.occurrenceId, careOccurrences.id)).leftJoin(medicationAdministrations, eq(medicationAdministrations.occurrenceId, careOccurrences.id))
      .where(and(inArray(careOccurrences.admissionId, active.map(r => r.episode.id)), sql`${careOccurrences.scheduledAt}<${asOf}`, isNull(nursingObservations.id), isNull(medicationAdministrations.id))).orderBy(asc(careOccurrences.scheduledAt));
    for (const o of due.filter(o => !stopped.has(o.orderId))) add(active.find(r => r.episode.id === o.admissionId)!, o.kind === "MEDICINE" ? "OVERDUE_MAR" : "OVERDUE_OBSERVATION", o.id, "NURSE", o.kind === "MEDICINE" ? "Record prescribed medicine outcome" : "Record prescribed observation", "Prescribed occurrence remains unrecorded across shift handover.", undefined, { dueAt: o.scheduledAt.toISOString() });
    const handovers = (await tx.execute(sql`select e.id,s.admission_id,e.ended_at from hims.nursing_shifts s join hims.effective_shift_ends e on e.shift_id=s.id where s.admission_id in (${sql.join(active.map(r => sql`${r.episode.id}::uuid`), sql`,`)}) and e.end_kind='NURSE' and not exists(select 1 from hims.nursing_shifts n where n.admission_id=s.admission_id and n.started_at>=e.ended_at)`)).rows;
    for (const h of handovers) add(active.find(r => r.episode.id === h.admission_id)!, "HANDOVER", String(h.id), "NURSE", "Start shift and record incoming handover", "The last signed shift ended; incoming care attendance has not been recorded.", undefined, { dueAt: new Date(String(h.ended_at)).toISOString() });
  }
  const labRows = ["LAB", "DOCTOR", "ADMIN"].includes(staff.role) && active.length ? (await tx.execute(sql`select o.id,o.admission_id,o.requested_item,s.id as sample_id,p.id as processing_id,r.id as report_id,d.id as disposition_id,b.state as billing_state from hims.clinical_orders o join hims.care_tasks t on t.order_id=o.id and t.owner_role='LAB' left join hims.lab_samples s on s.order_id=o.id left join hims.lab_processing p on p.order_id=o.id left join hims.lab_reports r on r.order_id=o.id left join hims.lab_dispositions d on d.order_id=o.id left join hims.care_billing_events b on b.order_id=o.id where o.admission_id in (${sql.join(active.map(r => sql`${r.episode.id}::uuid`), sql`,`)}) and o.kind in ('LAB','RADIOLOGY')`)).rows : [];
  for (const o of labRows) {
    const row = active.find(r => r.episode.id === o.admission_id)!;
    if (staff.role === "DOCTOR" && !o.report_id && !o.disposition_id) add(row, "PENDING_DIAGNOSTIC", String(o.id), "DOCTOR", "Review pending diagnostic work", `${String(o.requested_item)}: Lab / radiology owns the report or attributable unperformed disposition.`, `/clinical?admissionId=${row.episode.id}`);
    if (stopped.has(String(o.id)) && !o.report_id && !o.disposition_id) add(row, "DIAGNOSTIC_DISPOSITION", String(o.id), "LAB", o.processing_id ? "Complete already-started diagnostic report" : "Review stopped diagnostic order", o.processing_id ? "Processing actually began; retain its human report despite the later stop." : "Stopped unperformed work requires actual disposition; collected samples do not imply completion.", `/lab?orderId=${o.id}`);
    else if (!o.report_id && !o.disposition_id) add(row, "DIAGNOSTIC_WORK", String(o.id), "LAB", o.processing_id ? "Sign diagnostic report" : o.sample_id ? "Record diagnostic processing" : "Collect sample / start radiology", String(o.requested_item), `/lab?orderId=${o.id}`);
    else if (o.report_id && o.billing_state !== "POSTED") add(row, "DIAGNOSTIC_FEE", String(o.id), "LAB", "Reconcile original diagnostic fee", "Human report is signed; its financial source still requires reconciliation.", `/lab?orderId=${o.id}`);
  }
  const threshold = (basis: string) => { const v = versions.find(v => v.payload.type === "alert" && v.payload.basis === basis); return { percent: v ? Number(v.payload.percent) : 80, configured: !!v, versionId: v?.id ?? null }; };
  const insurerThreshold = threshold("insurer-limit"), depositThreshold = threshold("patient-deposit");
  for (const row of rows) {
    const e = row.episode, open = e.status === "PENDING" || e.status === "ADMITTED";
    const href = staff.role === "ADMISSION" ? `/patients/${e.id}` : staff.role === "INSURANCE" ? `/insurance?caseId=${row.case!.id}` : staff.role === "LAB" ? `/lab?orderId=${orders.find(o => o.admissionId === e.id && ["LAB", "RADIOLOGY"].includes(o.kind))?.id ?? ""}` : staff.role === "PHARMACY" && !orders.some(o => o.admissionId === e.id && o.kind === "MEDICINE") ? `/discharge?admissionId=${e.id}` : `${paths[staff.role]}?admissionId=${e.id}`;
    episodes.push({ id: e.id, name: row.name, ipCode: e.ipCode, bedLabel: row.bedLabel, bedCategory: row.bedCategory, status: e.status, href, action: e.status === "PENDING" ? "Review pending admission" : open ? "Open current work" : "Review retained history" });
    if (staff.role === "ADMISSION" && e.status === "PENDING") add(row, "PENDING_ADMISSION", e.id, "ADMISSION", "Review deposit and actual arrival", "Reservation remains pending; activate only after the configured deposit and real arrival are recorded.", `/patients/${e.id}`);
    if (["DOCTOR", "ADMIN"].includes(staff.role) && e.status === "ADMITTED") {
      const transfer = (await transferAuthority(tx, e.id)).orders[0];
      if (transfer && (["PENDING", "WITNESSED"].includes(transfer.status) || transfer.pendingFactualMove)) add(row, "TRANSFER_REVIEW", transfer.id, "DOCTOR", "Review current transfer authority", transfer.pendingFactualMove ? "Actual handover is retained; record the factual transfer through the authorized route." : "Carry out the current transfer or sign an attributable withdrawal after review.");
      for (const o of orders.filter(o => o.admissionId === e.id && o.kind === "PROCEDURE" && !stopped.has(o.id) && !completed.has(o.id))) add(row, "PROCEDURE", o.id, "DOCTOR", "Record procedure completion or review", o.requestedItem);
    }
    if (["PHARMACY", "ADMIN"].includes(staff.role) && e.status === "ADMITTED" && (orders.some(o => o.admissionId === e.id && o.kind === "MEDICINE") || summaries.some(s => s.admissionId === e.id))) {
      const pharmacy = await pharmacyClearanceSourceInTransaction(tx, e);
      if (pharmacy.unresolved.length) add(row, "PHARMACY_RECONCILIATION", e.id, "PHARMACY", "Review medicine fulfillment and returns", `${pharmacy.unresolved.length} source checks require review. Actual ward issues, home preparation and stock returns remain separate.`);
    }
    if (["ADMIN", "BILLING", "INSURANCE"].includes(staff.role)) {
      const bill = await billProjection(tx, e, asOf), source = await financialResponsibilityInTransaction(tx, e, bill), r = source.responsibility;
      financial.push({ admissionId: e.id, netPaise: bill.netPaise.toString(), patientCashPaise: bill.patientCashPaise.toString(), insurerCashPaise: bill.insurerCashPaise.toString(), heldDepositPaise: bill.unallocatedDepositPaise.toString(), patientDuePaise: r?.allocationComplete ? r.patientOutstandingPaise.toString() : null, insurerDuePaise: r?.allocationComplete ? r.insurerOutstandingPaise.toString() : null, allocationCurrent: !!r?.allocationComplete, authorizedPaise: source.decisionId ? source.insurerAuthorizedPaise.toString() : null });
      if (open && !r?.allocationComplete) add(row, "RESPONSIBILITY", row.case?.id ?? e.id, e.paymentRoute === "INSURED" ? "INSURANCE" : "BILLING", "Review current payer responsibility", "Current complete responsibility is unavailable or its bill/policy source changed.");
      if (r?.allocationComplete && r.insurerOutstandingPaise > 0n) add(row, "INSURER_RECEIPT", e.id, "BILLING", "Record actual insurer money received", "External authorization does not settle the insurer amount still owed.", undefined, { amountPaise: r.insurerOutstandingPaise.toString() });
      if (r?.allocationComplete && r.patientOutstandingPaise > 0n) add(row, "PATIENT_SETTLEMENT", e.id, "BILLING", "Record patient settlement", "Current patient responsibility exceeds payments applied to this bill.", undefined, { amountPaise: r.patientOutstandingPaise.toString() });
      if (bill.unallocatedDepositPaise > 0n || bill.overpaidPaise > 0n || (r?.allocationComplete && (r.patientExcessPaise > 0n || r.insurerExcessPaise > 0n))) add(row, "HELD_MONEY", e.id, "BILLING", "Review deposit allocation / authorized refund", "Held or excess cash needs a recorded allocation or actual authorized refund; no refund is manufactured by this alert.");
      if (open && bill.pendingPaise > 0n) add(row, "PENDING_CHARGES", e.id, "BILLING", "Follow up unresolved department charges", "Pending charges are separate from the final posted bill.", undefined, { amountPaise: bill.pendingPaise.toString() });
      if (open && r && !r.stale && bill.depositCashPaise > 0n && r.patientPaise * 100n >= bill.depositCashPaise * BigInt(depositThreshold.percent)) add(row, "DEPOSIT_THRESHOLD", row.case?.id ?? e.id, e.paymentRoute === "INSURED" ? "INSURANCE" : "BILLING", "Review patient deposit top-up", `Verified patient share reached ${depositThreshold.percent}% of retained deposit cash (${depositThreshold.configured ? "configured threshold" : "80% source default; not configured"}).`);
      if (row.case && open) {
        const caseId = row.case.id, caseHref = `/insurance?caseId=${caseId}`;
        // Manual staff work can remain open on a retained converted case; only
        // its latest event per workId determines current work, not case version.
        const followups = await tx.select({ workId: sql<string>`${insuranceEvents.payload}->>'workId'`, requestType: sql<string>`${insuranceEvents.payload}->>'kind'`, status: sql<string>`${insuranceEvents.payload}->>'status'`, reference: sql<string>`${insuranceEvents.payload}->>'reference'`, reason: insuranceEvents.reason })
          .from(insuranceEvents).where(and(eq(insuranceEvents.caseId, caseId), eq(insuranceEvents.kind, "FOLLOWUP"))).orderBy(desc(insuranceEvents.caseVersion));
        const seen = new Set<string>();
        for (const followup of followups) {
          if (seen.has(followup.workId)) continue;
          seen.add(followup.workId);
          if (followup.status === "OPEN") {
            const kind = followup.requestType === "PREAUTH" ? "pre-authorization" : followup.requestType === "ENHANCEMENT" ? "enhancement" : "appeal";
            add(row, "INSURANCE_FOLLOWUP", `${caseId}:${followup.workId}`, "INSURANCE", `Review ${kind} follow-up`, `${followup.reason} · Reference: ${followup.reference}`, caseHref);
          }
        }
        if (e.paymentRoute === "INSURED") {
          const policy = (await tx.select({ id: insuranceEvents.id }).from(insuranceEvents).where(and(eq(insuranceEvents.caseId, caseId), eq(insuranceEvents.kind, "POLICY"))).orderBy(desc(insuranceEvents.caseVersion)).limit(1))[0];
          const decision = (await tx.select({ id: insuranceDecisions.id, status: insuranceDecisions.status, documentIds: insuranceDecisions.documentIds }).from(insuranceDecisions).where(eq(insuranceDecisions.caseId, caseId)).orderBy(desc(insuranceDecisions.caseVersion)).limit(1))[0];
          const docs = await tx.select({ id: insuranceDocuments.id }).from(insuranceDocuments).where(eq(insuranceDocuments.caseId, caseId));
          const missing = [...(!policy ? ["staff-verified policy"] : []), ...(!decision ? ["externally verified decision"] : []), ...(!docs.length ? ["protected case documents"] : []), ...(e.status === "ADMITTED" && !summaries.some(s => s.admissionId === e.id) ? ["signed discharge summary"] : [])];
          if (missing.length) add(row, "MISSING_PAPERWORK", caseId, "INSURANCE", "Complete current insurance paperwork", missing.join("; "), caseHref);
          if (!decision || decision.status !== "APPROVED") add(row, "PAYER_DECISION", caseId, "INSURANCE", "Follow up external payer decision", decision ? `${decision.status}: staff must record the external response and complete responsibility.` : "No external payer decision recorded.", caseHref);
          const runs = await tx.select({ id: paperworkRuns.id, status: paperworkRuns.status, source: paperworkRuns.source }).from(paperworkRuns).where(eq(paperworkRuns.caseId, caseId));
          for (const run of runs.filter(run => !["ACCEPTED", "REJECTED"].includes(run.status) && run.source.caseVersion === row.case!.version && run.source.documentVersion === row.case!.documentSetRevision && run.source.reviewRevision === row.case!.reviewRevision && run.source.episodeVersion === e.version)) add(row, "PAPERWORK_REVIEW", run.id, "INSURANCE", run.status === "AWAITING_REVIEW" ? "Review manual paperwork draft" : "Resume saved manual paperwork run", "Current source-bound local draft requires staff review. Accepted follow-ups remain retained history, not permanently pending work.", caseHref);
          for (const transfer of source.pendingTransfers) add(row, "INSURANCE_TRANSFER", transfer.id, "INSURANCE", "Record external transfer follow-up", "Actual transfer insurance task remains unresolved.", caseHref);
          if (source.insurerAuthorizedPaise > 0n && bill.netPaise * 100n >= source.insurerAuthorizedPaise * BigInt(insurerThreshold.percent)) add(row, "INSURER_LIMIT", caseId, "INSURANCE", "Review insurer-limit enhancement", `Posted bill reached ${insurerThreshold.percent}% of recorded authorization (${insurerThreshold.configured ? "configured threshold" : "80% source default; not configured"}).`, caseHref);
        }
      } else if (e.paymentRoute === "INSURED" && open) add(row, "INSURANCE_CASE", e.id, "ADMIN", "Assign insurance case", "Staff-entered insured episode has no case assignment.", "/insurance");
      if (e.status === "ADMITTED" && summaries.some(s => s.admissionId === e.id)) {
        const state = await clearanceStateInTransaction(tx, e, bill, { readOnly: true });
        const waiting = state.reviews.find(g => !g.current);
        const ownerRole: StaffRole | null = waiting ? waiting.gate === "NURSING" ? "NURSE" : waiting.gate : null;
        discharge.push({ admissionId: e.id, name: row.name, ipCode: e.ipCode, bedLabel: row.bedLabel, ownerRole, stage: waiting ? `${names[ownerRole!]} review` : "Current four seals; record actual departure", href: `/discharge?admissionId=${e.id}` });
        if (waiting) add(row, "PENDING_SEAL", `${e.id}:${waiting.gate}`, ownerRole!, "Review current human discharge clearance", "The earliest incomplete professional gate owns the next clearance. Later gates cannot sign ahead of it.", `/discharge?admissionId=${e.id}`);
        else add(row, "DEPARTURE", e.id, "BILLING", "Record actual hospital departure", "Four current human seals are present; the physical bed hold remains until actual departure.", `/discharge?admissionId=${e.id}`);
      }
    } else if (e.status === "ADMITTED" && summaries.some(s => s.admissionId === e.id) && ["DOCTOR", "NURSE", "PHARMACY"].includes(staff.role)) {
      const state = await clearanceStateInTransaction(tx, e, undefined, { readOnly: true });
      const waiting = state.reviews.find(g => !g.current), ownerRole = waiting ? waiting.gate === "NURSING" ? "NURSE" : waiting.gate : null;
      if (waiting && ownerRole === staff.role) add(row, "PENDING_SEAL", `${e.id}:${waiting.gate}`, staff.role, "Review current human discharge clearance", "Your professional gate is the next incomplete clearance.", `/discharge?admissionId=${e.id}`);
    }
  }
  let stockThresholds = "NOT_APPLICABLE";
  if (["ADMIN", "PHARMACY"].includes(staff.role)) {
    const stock = await tx.select().from(pharmacyBatches);
    stockThresholds = !stock.length ? "NO_STOCK" : stock.every(s => s.reorderThreshold !== null) ? "CONFIGURED" : "PARTLY_OR_NOT_CONFIGURED";
    for (const s of stock) {
      if (s.reorderThreshold !== null && stockUnits(s.availableQuantity) <= stockUnits(s.reorderThreshold)) add(null, "LOW_STOCK", s.id, "PHARMACY", "Review medicine stock", `${String(versions.find(v => v.id === s.catalogVersionId)?.payload.name ?? s.medicineId)} · batch ${s.batchNo}: ${stockQuantity(stockUnits(s.availableQuantity))} ${s.unit} available; configured threshold ${stockQuantity(stockUnits(s.reorderThreshold))}.`, "/pharmacy");
      if (stockUnits(s.availableQuantity) > 0n && s.expiresOn < hospitalDate(asOf, timezone)) add(null, "EXPIRED_STOCK", s.id, "PHARMACY", "Review expired retained stock", `Batch ${s.batchNo} has retained stock past its expiry date.`, "/pharmacy");
    }
  }
  if (staff.role === "ADMIN") {
    const turns = (await tx.execute(sql`select t.id,b.label from hims.effective_bed_turnovers t join hims.beds b on b.id=t.bed_id where not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id) ${input.bedCategory ? sql`and b.category=${input.bedCategory}` : sql``}`)).rows;
    for (const t of turns) add(null, "BED_CLEANING", String(t.id), "ADMIN", "Record confirmed bed cleaning", `${t.label}: housekeeping completion is required before reuse.`, "/discharge");
  }
  return { role: staff.role, staffName: staff.name, asOf: asOf.toISOString(), timezone, episodes, alerts: [...new Map(alerts.map(a => [a.id, a])).values()], financial, discharge,
    configuration: { hospitalConfigured: !!hospital, timezoneSource: hospital ? "CONFIGURED" : "Asia/Kolkata source default; hospital not configured", stockThresholds, insurerThreshold, depositThreshold }, categories };
}

export async function getStaffWorklist(ctx: CommandContext, input: { asOf?: Date; bedCategory?: string } = {}) {
  const value = clockInput.parse(input);
  return db.transaction(tx => projection(tx, ctx, value), { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** asOf evaluates current rows and due times; it is not a historical database snapshot. */
export async function getOverview(ctx: CommandContext, input: { asOf: Date; bedCategory?: string }) {
  const value = clockInput.required({ asOf: true }).parse(input);
  return db.transaction(async tx => {
    const work = await projection(tx, ctx, value, true);
    const categoryScope = value.bedCategory ? eq(beds.category, value.bedCategory) : undefined;
    const physical = await tx.select({ id: beds.id, category: beds.category, active: beds.active, holdId: bedHolds.admissionId,
      occupied: sql<boolean>`exists(select 1 from hims.effective_room_stays s where s.bed_id=${beds.id} and s.ended_at is null)`,
      cleaning: sql<boolean>`exists(select 1 from hims.effective_bed_turnovers t where t.bed_id=${beds.id} and not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id))` }).from(beds).leftJoin(bedHolds, eq(bedHolds.bedId, beds.id)).where(categoryScope);
    const categoryNames = new Map(work.categories.map(category => [category.code, category.name]));
    const categoryCodes = [...new Set([...categoryNames.keys(), ...physical.map(bed => bed.category)])]
      .filter(code => !value.bedCategory || code === value.bedCategory);
    const bedOccupancy = categoryCodes.map(code => {
      const group = physical.filter(bed => bed.category === code);
      return { code, name: categoryNames.get(code) ?? code, total: group.length,
        occupied: group.filter(bed => bed.occupied).length,
        reserved: group.filter(bed => !!bed.holdId && !bed.occupied).length,
        cleaning: group.filter(bed => bed.cleaning).length,
        ready: group.filter(bed => bed.active && !bed.holdId && !bed.occupied && !bed.cleaning).length,
        disabled: group.filter(bed => !bed.active).length };
    });
    const day = hospitalDate(value.asOf, work.timezone);
    const exits = (await tx.execute(sql`select d.id from (select id,admission_id,departed_at from hims.departures union all select id,admission_id,departed_at from hims.exceptional_departures union all select id,admission_id,departed_at from hims.mvp_exceptional_departures) d join hims.admissions a on a.id=d.admission_id join hims.beds b on b.id=a.bed_id where (d.departed_at at time zone ${work.timezone})::date=${day}::date ${value.bedCategory ? sql`and b.category=${value.bedCategory}` : sql``}`)).rows;
    return { ...work, bedOccupancy, physicalBeds: physical.map(bed => ({ id: bed.id, category: bed.category,
      occupied: bed.occupied, reserved: !!bed.holdId && !bed.occupied, cleaning: bed.cleaning,
      ready: bed.active && !bed.holdId && !bed.occupied && !bed.cleaning, disabled: !bed.active })),
      metrics: { totalBeds: physical.length, activeAdmissions: work.episodes.filter(e => e.status === "ADMITTED").length, pendingAdmissions: work.episodes.filter(e => e.status === "PENDING").length,
      occupiedBeds: physical.filter(b => b.occupied).length, reservedBeds: physical.filter(b => !!b.holdId && !b.occupied).length, cleaningBeds: physical.filter(b => b.cleaning).length,
      availableBeds: physical.filter(b => b.active && !b.holdId && !b.occupied && !b.cleaning).length, disabledBeds: physical.filter(b => !b.active).length, dischargesToday: exits.length, dischargeWaiting: work.discharge.filter(d => d.ownerRole !== null).length,
      needsAttention: work.alerts.length }, financialTotals: {
        netPaise: work.financial.reduce((n, f) => n + BigInt(f.netPaise), 0n).toString(), patientCashPaise: work.financial.reduce((n, f) => n + BigInt(f.patientCashPaise), 0n).toString(), insurerCashPaise: work.financial.reduce((n, f) => n + BigInt(f.insurerCashPaise), 0n).toString(), heldDepositPaise: work.financial.reduce((n, f) => n + BigInt(f.heldDepositPaise), 0n).toString(), unknownResponsibility: work.financial.filter(f => !f.allocationCurrent).length,
      } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
