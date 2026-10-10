import "server-only";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTransaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, effectivePatients as patients } from "../admissions/schema";
import { user } from "../schema/auth";
import { adminExceptions, exceptionEvidence, exceptionFollowups, postDischargeAmendments, stayBoundaryAmendments } from "./exception-schema";
import { billProjection, lockBillingAdmission } from "../billing/commands";
import { exceptionObligationsInTransaction } from "./exceptions";
import { latestSeals } from "./dependencies";
import { insuranceReviewInTransaction } from "../insurance/commands";
export async function exceptionWorkspace(ctx: CommandContext, selectedId?: string, selectedExceptionId?: string) {
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN", "BILLING", "ADMISSION", "DOCTOR", "NURSE", "LAB", "PHARMACY", "INSURANCE"], tx);
    const finance = ["ADMIN", "BILLING"].includes(staff.role);
    let access: SQL = sql `true`;
    if (staff.role === "DOCTOR")
      access = eq(admissions.admittingDoctorId, staff.id);
    if (staff.role === "NURSE")
      access = sql `exists(select 1 from hims.nurse_assignments a where a.admission_id=${admissions.id} and a.nurse_id=${staff.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=a.id))`;
    if (staff.role === "LAB")
      access = sql `exists(select 1 from hims.care_tasks t where t.admission_id=${admissions.id} and t.owner_role='LAB')`;
    if (staff.role === "PHARMACY")
      access = sql `exists(select 1 from hims.clinical_orders o where o.admission_id=${admissions.id} and o.kind='MEDICINE')`;
    if (staff.role === "INSURANCE")
      access = sql `exists(select 1 from hims.insurance_cases c where c.admission_id=${admissions.id} and c.assigned_staff_id=${staff.id})`;
    const episodes = await tx.select({
      id: admissions.id, ipCode: admissions.ipCode, status: admissions.status, version: admissions.version, name: patients.name, identityStatus: patients.identityStatus, identityProvenance: patients.identityProvenance, bedLabel: beds.label
    })
      .from(admissions).innerJoin(patients, eq(patients.id, admissions.patientId)).innerJoin(beds, eq(beds.id, admissions.bedId)).where(access).orderBy(desc(admissions.registeredAt));
    const staffOptions = staff.role === "ADMIN" ? await tx.select({
      id: user.id, name: user.name, role: user.role
    }).from(user).where(sql `coalesce(${user.banned},false)=false`) : [{
        id: staff.id, name: staff.name, role: staff.role
      }];
    if (!selectedId)
      return {
        staff, episodes, staffOptions, selected: null
      };
    const id = z.uuid().parse(selectedId);
    const e = await lockBillingAdmission(tx, id);
    // The worklist is navigation. Admission ownership must precede selected access and identity.
    const [row] = await tx.select({ id: admissions.id, ipCode: admissions.ipCode, status: admissions.status, version: admissions.version, billRevision: admissions.billRevision, name: patients.name, identityStatus: patients.identityStatus, identityProvenance: patients.identityProvenance, bedLabel: beds.label })
      .from(admissions).innerJoin(patients, eq(patients.id, admissions.patientId)).innerJoin(beds, eq(beds.id, admissions.bedId)).where(and(eq(admissions.id, id), access));
    if (!row)
      throw new DomainError("FORBIDDEN", "Current role or assignment does not permit this admission");
    // Return routing metadata only; clinical chart, cash and policy data retain their own role views.
    const authorities = await tx.select({
      id: adminExceptions.id, type: adminExceptions.type, disposition: adminExceptions.disposition, sourceId: adminExceptions.sourceId, correctionKind: adminExceptions.correctionKind, authority: adminExceptions.authority, reason: adminExceptions.reason, evidence: adminExceptions.evidence, evidenceIds: adminExceptions.evidenceIds, followUpOwnerId: adminExceptions.followUpOwnerId, signedBy: adminExceptions.signedBy, signedAt: adminExceptions.signedAt
    }).from(adminExceptions).where(eq(adminExceptions.admissionId, id)).orderBy(desc(adminExceptions.signedAt));
    const evidence = await tx.select({
      id: exceptionEvidence.id, kind: exceptionEvidence.kind, sourceId: exceptionEvidence.sourceId, exceptionId: exceptionEvidence.exceptionId, notes: sql<string | null>`case when ${["DOCTOR","NURSE"].includes(staff.role)} then ${exceptionEvidence.notes} else null end`, actualAt: exceptionEvidence.actualAt, vacatedAt: exceptionEvidence.vacatedAt, signedBy: exceptionEvidence.signedBy, signedAt: exceptionEvidence.signedAt
    }).from(exceptionEvidence).where(eq(exceptionEvidence.admissionId, id)).orderBy(desc(exceptionEvidence.signedAt));
    const followups = await tx.select().from(exceptionFollowups).where(eq(exceptionFollowups.admissionId, id)).orderBy(desc(exceptionFollowups.signedAt));
    const sources: {
      id: string;
      kind: string;
      label: string;
    }[] = [];
    async function addSources(kind: string, query: SQL) {
      const rows = (await tx.execute(query)).rows;
      sources.push(...rows.map(r => ({
        id: String(r.id), kind, label: String(r.label)
      })));
    }
    if (["ADMIN", "NURSE", "DOCTOR"].includes(staff.role)) {
      await addSources("STAY", sql `select s.id,b.label||' · '||s.started_at::text||' → '||coalesce(s.ended_at::text,'Occupied') label from hims.effective_room_stays s join hims.beds b on b.id=s.bed_id where s.admission_id=${id}`);
      await addSources("VACATION", sql `select id,'Current room vacancy · '||vacated_at::text label from hims.effective_room_vacations where admission_id=${id}`);
      await addSources("TRANSFER_ORDER", sql `select o.id,'Doctor transfer to '||o.destination_category||' · version '||o.version::text label from hims.transfer_orders o where o.admission_id=${id} and not exists(select 1 from hims.admission_transfers t where t.transfer_order_id=o.id)`);
      await addSources("SHIFT", sql `select s.id,'Attendance · '||u.name||' · '||s.started_at::text label from hims.nursing_shifts s join hims.staff_user u on u.id=s.nurse_id where s.admission_id=${id} and (${staff.role}='ADMIN' or s.nurse_id=${staff.id})`);
    }
    if (finance) {
      await addSources("CHARGE", sql`select c.id,'Original non-room charge · '||c.description label from hims.charges c where c.admission_id=${id} and c.category<>'room' and c.source_event_id not like 'room:%' and c.amount_paise>coalesce((select sum(r.amount_paise) from hims.charge_reversals r where r.charge_id=c.id),0)`);
      await addSources("CONVERSION", sql `select v.id,'Original externally verified self-pay conversion' label from hims.insurance_conversions v join hims.insurance_cases c on c.id=v.case_id where c.admission_id=${id}`);
      await addSources("RECEIPT", sql `select id,party||' '||kind||' · '||source_reference label from hims.receipts where admission_id=${id}`);
      await addSources("ALLOCATION", sql `select a.id,'Original deposit allocation · '||a.created_at::text label from hims.receipt_allocations a join hims.receipts r on r.id=a.receipt_id where r.admission_id=${id} and not exists(select 1 from hims.allocation_cancellations c where c.allocation_id=a.id)`);
    }
    if (["ADMIN", "DOCTOR", "NURSE"].includes(staff.role))
      await addSources("CARE_BILLING", sql`select b.id,'Original performed '||b.category||' · '||b.quantity||' '||b.unit label from hims.care_billing_events b where b.admission_id=${id} and b.state='UNRESOLVED' and ((${staff.role} in ('ADMIN','DOCTOR') and b.category='consultation') or (${staff.role} in ('ADMIN','NURSE') and b.category='consumable'))`);
    if (["ADMIN", "BILLING", "INSURANCE"].includes(staff.role))
      await addSources("INSURANCE_CASE", sql `select id,'Retained insurance case · version '||version::text label from hims.insurance_cases where admission_id=${id}`);
    if (["ADMIN", "DOCTOR"].includes(staff.role))
      await addSources("CLINICAL_NOTE", sql `select id,'Original Doctor note · '||signed_at::text label from hims.clinical_rounds where admission_id=${id}`);
    if (staff.role === "DOCTOR")
      await addSources("RETURN_INSTRUCTION", sql`select p.id,'Doctor return instruction · '||p.signed_at::text label from hims.exception_evidence p where p.admission_id=${id} and p.kind='RETURN_TO_BED' and not exists(select 1 from hims.exception_evidence c where c.kind='RETURN_CANCELLED' and c.source_id=p.id) and not exists(select 1 from hims.room_returns r where r.doctor_evidence_id=p.id)`);
    if (["ADMIN", "NURSE"].includes(staff.role)) {
      await addSources("MAR", sql `select id,'Original administration · '||actual_at::text label from hims.medication_administrations where admission_id=${id}`);
      await addSources("OBSERVATION", sql `select id,'Original observation · '||observed_at::text label from hims.nursing_observations where admission_id=${id}`);
      await addSources("CONSUMABLE", sql `select id,'Original consumable · '||used_at::text label from hims.nursing_consumables where admission_id=${id}`);
    }
    if (["ADMIN", "LAB"].includes(staff.role)) {
      await addSources("LAB_ORDER", sql `select o.id,'Diagnostic work processed · '||p.signed_at::text label from hims.clinical_orders o join hims.lab_processing p on p.order_id=o.id where o.admission_id=${id}`);
      await addSources("LAB_REPORT", sql `select id,'Original diagnostic report · '||signed_at::text label from hims.lab_reports where admission_id=${id}`);
    }
    await addSources("DEPARTURE", sql `select id,'Exceptional departure · '||departed_at::text label from hims.exceptional_departures where admission_id=${id} union all select id,'Ordinary departure · '||departed_at::text from hims.departures where admission_id=${id}`);
    const bedOptions = ["ADMIN", "NURSE"].includes(staff.role) ? (await tx.execute(sql `select b.id,b.label,b.category from hims.beds b left join hims.bed_holds h on h.bed_id=b.id where b.active and h.bed_id is null order by b.label`)).rows.map(b => ({ id: String(b.id), label: `${b.label} · ${b.category}` })) : [];
    const amendments = await tx.select({
      id: postDischargeAmendments.id, kind: postDischargeAmendments.kind, sourceId: postDischargeAmendments.sourceId, resultId: postDischargeAmendments.resultId, signedAt: postDischargeAmendments.signedAt, signedBy: postDischargeAmendments.signedBy
    }).from(postDischargeAmendments).where(eq(postDischargeAmendments.admissionId, id));
    const boundaries = await tx.select().from(stayBoundaryAmendments).where(eq(stayBoundaryAmendments.admissionId, id));
    const seals = await latestSeals(tx, id);
    const actorIds = [...new Set([...authorities.flatMap(a=>[a.signedBy,a.followUpOwnerId]), ...evidence.map(v=>v.signedBy), ...followups.flatMap(v=>[v.signedBy,v.ownerId])])];
    const actorRows = actorIds.length ? await tx.select({id:user.id,name:user.name}).from(user).where(inArray(user.id,actorIds)) : [];
    const actors = Object.fromEntries(actorRows.map(a=>[a.id,a.name]));

    const selectedAuthority = authorities.find(a => a.id === selectedExceptionId) ?? authorities[0];
    const payer = selectedAuthority?.correctionKind === "INSURANCE_DECISION" && selectedAuthority.sourceId && ["ADMIN", "BILLING", "INSURANCE"].includes(staff.role)
      ? await insuranceReviewInTransaction(tx, ctx, selectedAuthority.sourceId) : null;
    return {
      staff, episodes, staffOptions, selected: {
        payer, actors, episode: {
          ...row, status: e.status, version: e.version
        }, authorities, evidence, followups, sources, bedOptions, amendments, boundaries, seals: seals.all.map(r => ({
          gate: r.seal.gate, signedAt: r.seal.signedAt, signedBy: r.seal.signedBy, current: !r.invalidation
        })), obligations: finance ? await exceptionObligationsInTransaction(tx, e) : null, bill: finance ? await billProjection(tx, e, new Date()) : null
      }
    };
  });
}
