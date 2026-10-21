import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { user, settingVersions, hospitalSettings } from "../schema";
import { assertHumanActor, DomainError, type CommandContext, type StaffRole } from "../contracts";
import { getMvpEpisode } from "./commands";
import { admissions } from "../admissions/schema";
import { z } from "zod";

export type MvpQueueSource = { id: string; name: string; uhid: string; ipCode: string; status: string; billRevision:number; vacant:boolean; caseId:string|null; bedLabel: string; nurseName: string | null; insuranceOwner: string | null; registeredBy: string | null; temporaryIdentity?: boolean; intakeException?: boolean; insuranceCorrection?: boolean; medicineCount?: number };
export type MvpCoordination = { clinical: boolean; checklist: boolean; pendingChecks: string[]; finance: boolean; finalDelivered: boolean; exception: boolean };
export type MvpReview = Awaited<ReturnType<typeof getMvpEpisode>>;
export type MvpQueueRow = MvpQueueSource & { stage: string; action: string; detail: string; owner: string; ownerRole: string; needsAction: boolean; coordination?: MvpCoordination };

export async function getMvpWorkspace(ctx: CommandContext) {
  return db.transaction(async tx => {
  const actor = assertHumanActor(ctx);
  z.uuid().parse(ctx.requestId);
  if (!ctx.source.trim()) throw new DomainError("VALIDATION", "Workspace source is required");
  const [staff] = await tx.select({ id: user.id, name: user.name, role: user.role, banned: user.banned }).from(user).where(eq(user.id, actor.staffId));
  if (!staff || staff.banned || !["ADMIN", "ADMISSION", "NURSE", "PHARMACY", "INSURANCE", "BILLING"].includes(staff.role)) throw new DomainError("FORBIDDEN", "Current inpatient workspace access denied");
  const scope = staff.role === "NURSE"
    ? sql`exists(select 1 from hims.nurse_assignments n where n.admission_id=a.id and n.nurse_id=${staff.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=n.id))`
    : staff.role === "INSURANCE" ? sql`ic.assigned_staff_id=${staff.id}` : sql`true`;
  const rows = (await tx.execute(sql`with scoped as (select a.id,p.name,p.uhid,a.ip_code as "ipCode",a.status,a.registered_at as "registeredAt",a.bill_revision as "billRevision",ic.id as "caseId",exists(select 1 from hims.effective_room_vacations v where v.admission_id=a.id) as vacant,b.label as "bedLabel",creator.name as "registeredBy",
    (select string_agg(distinct s.name, ', ' order by s.name) from hims.nurse_assignments n join hims.staff_user s on s.id=n.nurse_id where n.admission_id=a.id and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=n.id)) as "nurseName",
    ins.name as "insuranceOwner",p.identity_status='TEMPORARY' as "temporaryIdentity",
    exists(select 1 from hims.admin_exceptions x where x.admission_id=a.id) as "intakeException",
    exists(select 1 from hims.admin_exceptions x where x.admission_id=a.id and x.type='POST_DISCHARGE_CORRECTION' and x.correction_kind='INSURANCE_DECISION' and not exists(select 1 from hims.post_discharge_amendments m where m.exception_id=x.id)) as "insuranceCorrection",
    (select count(*)::int from hims.mvp_medicine_sources m where m.admission_id=a.id) as "medicineCount"
    from hims.admissions a join hims.effective_patients p on p.id=a.patient_id join hims.beds b on b.id=a.bed_id
    left join hims.staff_user creator on creator.id=a.created_by left join hims.insurance_cases ic on ic.admission_id=a.id left join hims.staff_user ins on ins.id=ic.assigned_staff_id
    where a.workflow_version=2 and ${scope} ${staff.role === "PHARMACY" ? sql`and (a.status in ('PENDING','ADMITTED') or exists(select 1 from hims.mvp_medicine_sources m where m.admission_id=a.id))` : sql``})
    select * from scoped where status in ('PENDING','ADMITTED') or id in (select id from scoped where status in ('DISCHARGED','CANCELLED') order by "registeredAt" desc,id desc limit 50) order by "registeredAt" desc,id desc`)).rows as unknown as MvpQueueSource[];
  // The queue reads coordination markers in one batch. Full purpose-limited review is loaded only for the selected episode.
  const events = rows.length ? (await tx.execute(sql`select e.id,e.admission_id as "admissionId",e.action,e.check_key as check,e.status,e.clinical_id as "clinicalId",e.checklist_id as "checklistId",e.bill_version as "billVersion",e.payload->>'kind' as "paperKind",(i.id is not null) as invalid from hims.mvp_events e left join hims.mvp_invalidations i on i.event_id=e.id where e.admission_id in (${sql.join(rows.map(row => sql`${row.id}::uuid`), sql`,`)}) order by e.recorded_at desc,e.id desc`)).rows as unknown as {id:string;admissionId:string;action:string;check:string|null;status:string|null;clinicalId:string|null;checklistId:string|null;billVersion:number;paperKind:string|null;invalid:boolean}[] : [];
  const exceptions = rows.length ? (await tx.execute(sql`select x.id,x.admission_id as "admissionId",x.action,x.type,x.source_id as "sourceId",x.bill_version as "billVersion",exists(select 1 from hims.mvp_room_returns r where r.clinical_id=x.id) as returned from hims.mvp_exception_events x where x.admission_id in (${sql.join(rows.map(row => sql`${row.id}::uuid`), sql`,`)}) order by x.recorded_at desc,x.id desc`)).rows as unknown as {id:string;admissionId:string;action:string;type:string;sourceId:string|null;billVersion:number;returned:boolean}[] : [];
  const episodes: MvpQueueRow[] = rows.map(row => {
    const history = events.filter(event => event.admissionId === row.id);
    const approval = history.find(event => event.action === "doctor-approval");
    const clinical = approval && !approval.invalid ? approval : null;
    const latestChecklist = history.find(event => event.action === "checklist");
    const checklist = latestChecklist && !latestChecklist.invalid && latestChecklist.clinicalId === clinical?.id ? latestChecklist : null;
    const pending = ["NURSING", "PHARMACY", "INSURANCE", "DIAGNOSTICS"].filter(check => {
      const event = history.find(event => ["check", "n-a"].includes(event.action) && event.check === check);
      return !event || event.invalid || !clinical || !checklist || event.clinicalId !== clinical.id || event.checklistId !== checklist.id || !["COMPLETE", "NA"].includes(event.status ?? "");
    });
    const financial = history.find(event => event.action === "finance");
    const financeCurrent = !!financial && !financial.invalid && financial.billVersion === row.billRevision && pending.length === 0;
    let stage = "Inpatient care", action = "Review patient coordination", detail = "Await external Doctor discharge instruction; ongoing care remains with clinical staff", ownerRole = "Assigned Nurse", owner = row.nurseName ?? "Unassigned · Nursing", needsAction = false;
    if (row.status === "PENDING") { stage = "Admission"; action = "Review deposit and actual arrival"; detail = "Bed reserved; actual occupied stay has not started"; ownerRole = "Admission"; owner = row.registeredBy ?? "Unassigned · Admission"; needsAction = true; }
    else if (row.status !== "ADMITTED") { stage = row.status === "DISCHARGED" ? "Exited" : "Cancelled"; action = "Review retained episode"; detail = "Original sources, receipts and departure remain retained"; ownerRole = "Retained history"; owner = row.nurseName ?? "Authorized staff"; }
    else if (!row.nurseName) { stage = "Staff assignment"; action = "Assign responsible Nurse"; detail = "Admin records the patient’s named nursing owner before coordination work"; ownerRole = "Admin"; owner = "Unassigned · Admin"; needsAction = true; }
    else if (clinical) {
      needsAction = true;
      if (!checklist) { stage = "Readiness"; action = "Publish patient checklist"; detail = "Review applicable work and propose any optional N/A checks"; }
      else if (pending.length) {
        stage = "Checks running"; const next = pending.find(check => check === (staff.role === "NURSE" ? "NURSING" : staff.role)) ?? pending[0];
        action = `Review ${next.toLowerCase()} check`; detail = `${pending.length} applicable checks need current review; checks run in parallel`;
        ownerRole = next === "NURSING" ? "Assigned Nurse" : next;
        owner = next === "NURSING" ? row.nurseName ?? "Unassigned · Nursing" : next === "INSURANCE" ? row.insuranceOwner ?? "Unassigned · Insurance" : next === "PHARMACY" ? "Unassigned · Pharmacy" : row.nurseName ?? "Unassigned · Ward coordination";
      } else if (!row.vacant) { stage = "Vacancy"; action = "Record actual bed vacancy"; detail = "Record factual vacancy and waiting care; the bed remains held"; }
      else if (!financeCurrent) { stage = "Final review"; action = "Review final finances"; detail = "Confirm final charges, patient settlement and accepted insurer responsibility"; ownerRole = "Billing / Admin"; owner = "Unassigned · Billing"; }
      else if (!history.some(event => event.action === "deliver" && event.paperKind === "FINAL" && event.billVersion === row.billRevision && !event.invalid)) { stage = "Papers"; action = "Deliver authorized final papers"; detail = "Record recipient, exact version, time and evidence before exit"; }
      else { stage = "Awaiting exit"; action = "Confirm actual hospital exit"; detail = "Authorized papers delivered; assigned Nurse records actual departure"; }
    }
    const exceptional = exceptions.filter(event => event.admissionId === row.id);
    const disposition = exceptional.find(event => event.action === "CLINICAL");
    if (row.status === "ADMITTED" && disposition && disposition.type !== "RETURN_CANCELLED" && !disposition.returned) {
      const authority = exceptional.find(event => event.action === "AUTHORITY" && event.sourceId === disposition.id && event.billVersion === row.billRevision);
      stage = "Exception follow-up"; action = "Review exception authority and obligations"; detail = "External clinical instruction, factual movement, papers and unpaid obligations remain separate"; needsAction = true;
      ownerRole = authority || !row.vacant ? "Assigned Nurse" : "Admin"; owner = ownerRole === "Admin" ? "Unassigned · Admin" : row.nurseName ?? "Unassigned · Nursing";
    }
    return { ...row, stage, action, detail, owner, ownerRole, needsAction, coordination: { clinical: !!clinical, checklist: !!checklist, pendingChecks: pending, finance: financeCurrent, finalDelivered: history.some(event => event.action === "deliver" && event.paperKind === "FINAL" && event.billVersion === row.billRevision && !event.invalid), exception: exceptional.length > 0 } };
  });
  const [hospital] = await tx.select({ id: hospitalSettings.id, timezone: hospitalSettings.timezone }).from(hospitalSettings).limit(1);
  const physical = (await tx.execute(sql`select b.id,b.active,
    exists(select 1 from hims.effective_room_stays s where s.bed_id=b.id and s.ended_at is null) as occupied,
    exists(select 1 from hims.bed_holds h where h.bed_id=b.id) as held,
    exists(select 1 from hims.effective_bed_turnovers t where t.bed_id=b.id and not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id)) as cleaning from hims.beds b`)).rows as unknown as { id: string; active: boolean; occupied: boolean; held: boolean; cleaning: boolean }[];
  const versions = hospital && ["ADMIN", "PHARMACY"].includes(staff.role) ? await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, hospital.id)) : [];
  const medicinePrices = [...new Map(versions.sort((a, b) => a.version - b.version).filter(v => v.payload.type === "billable-item" && v.payload.category === "medicine").map(v => [String(v.payload.code), v] as const)).values()].filter(v => v.payload.active === true);
  return { role: staff.role as StaffRole, staffId: staff.id, staffName: staff.name, episodes, medicinePrices, timezone: hospital?.timezone ?? "Asia/Kolkata", asOf: new Date().toISOString(),
    metrics: { current: episodes.filter(e => ["PENDING", "ADMITTED"].includes(e.status)).length, needsAction: episodes.filter(e => e.needsAction).length, preparing: episodes.filter(e => e.status === "ADMITTED" && e.stage !== "Inpatient care").length, totalBeds: physical.length, occupied: physical.filter(b => b.occupied).length, held: physical.filter(b => b.held && !b.occupied).length, cleaning: physical.filter(b => b.cleaning).length, available: physical.filter(b => b.active && !b.occupied && !b.held && !b.cleaning).length } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}


export async function getMvpIdentity(ctx: CommandContext, admissionId: string) {
  const workspace = await getMvpWorkspace(ctx);
  let identity = workspace.episodes.find(row => row.id === admissionId);
  if (!identity) {
    // History pagination must not make an older insurer receivable inaccessible by its exact source link.
    const review = await getMvpEpisode(ctx, admissionId);
    if (workspace.role === "PHARMACY" && !review.medicine.length) throw new DomainError("FORBIDDEN", "No retained patient medicine sources are available for this Pharmacy purpose");
    const row = (await db.execute(sql`select a.id,p.name,p.uhid,a.ip_code as "ipCode",a.status,a.bill_revision as "billRevision",ic.id as "caseId",exists(select 1 from hims.effective_room_vacations v where v.admission_id=a.id) as vacant,b.label as "bedLabel",creator.name as "registeredBy",
      (select string_agg(distinct s.name, ', ' order by s.name) from hims.nurse_assignments n join hims.staff_user s on s.id=n.nurse_id where n.admission_id=a.id and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=n.id)) as "nurseName",ins.name as "insuranceOwner"
      from hims.admissions a join hims.effective_patients p on p.id=a.patient_id join hims.beds b on b.id=a.bed_id left join hims.staff_user creator on creator.id=a.created_by left join hims.insurance_cases ic on ic.admission_id=a.id left join hims.staff_user ins on ins.id=ic.assigned_staff_id where a.id=${admissionId}::uuid and a.workflow_version=2`)).rows[0] as unknown as MvpQueueSource | undefined;
    if (row) identity = { ...row, stage: row.status, action: "Review retained episode", detail: "Exact historical source; later receipts preserve the original exit", owner: row.nurseName ?? "Authorized staff", ownerRole: "Retained history", needsAction: false };
  }
  if (!identity) throw new DomainError("FORBIDDEN", "Episode is outside this staff workspace");
  return { identity, workspace };
}

export async function isMvpEpisode(admissionId: string) {
  if (!z.uuid().safeParse(admissionId).success) return false;
  const [episode] = await db.select({ version: admissions.workflowVersion }).from(admissions).where(eq(admissions.id, admissionId));
  return episode?.version === 2;
}
