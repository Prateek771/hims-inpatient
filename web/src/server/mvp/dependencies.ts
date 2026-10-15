import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Transaction } from "../db";
import { admissions } from "../admissions/schema";
import { billProjection, financialResponsibilityInTransaction } from "../billing/commands";
import { effectiveRoomVacations, departures } from "../discharge/schema";
import { jsonSnapshot, reviewHash } from "../discharge/dependencies";
import { mvpChecks, mvpEvents, mvpInvalidations, mvpMedicineSources,mvpExceptionEvents,mvpExceptionalDepartures,mvpRoomReturns } from "./schema";
export type MvpEvent = typeof mvpEvents.$inferSelect;
export async function mvpState(tx: Transaction, episode: typeof admissions.$inferSelect) {
  const history = await tx.select({ event: mvpEvents, invalidation: mvpInvalidations }).from(mvpEvents).leftJoin(mvpInvalidations, eq(mvpEvents.id,mvpInvalidations.eventId)).where(eq(mvpEvents.admissionId,episode.id)).orderBy(desc(mvpEvents.recordedAt),desc(mvpEvents.id));
  const latest = (action: string, check?: string) => history.find(r => r.event.action===action && (check===undefined||r.event.check===check));
  const approval = latest("doctor-approval"), checklist = latest("checklist");
  const clinical = approval && !approval.invalidation ? approval.event : null;
  const physicalChecklist = checklist && !checklist.invalidation && checklist.event.clinicalId===clinical?.id ? checklist.event : null;
  const checks = mvpChecks.map(check => {
    const row = history.find(r => ["check","n-a"].includes(r.event.action) && r.event.check===check);
    const current = !!row && !row.invalidation && !!clinical && !!physicalChecklist && row.event.clinicalId===clinical.id && row.event.checklistId===physicalChecklist.id;
    return { check, status: current ? row.event.status : "PENDING", current: current && ["COMPLETE","NA"].includes(row.event.status??""), event: row?.event??null, invalidation: row?.invalidation??null };
  });
  const [vacancy] = await tx.select().from(effectiveRoomVacations).where(eq(effectiveRoomVacations.admissionId,episode.id));
  const [departure] = await tx.select().from(departures).where(eq(departures.admissionId,episode.id));
  const [exceptionalDeparture]=await tx.select().from(mvpExceptionalDepartures).where(eq(mvpExceptionalDepartures.admissionId,episode.id));
  const exceptions=await tx.select().from(mvpExceptionEvents).where(eq(mvpExceptionEvents.admissionId,episode.id)).orderBy(desc(mvpExceptionEvents.recordedAt),desc(mvpExceptionEvents.id));
  const returns=await tx.select().from(mvpRoomReturns).where(eq(mvpRoomReturns.admissionId,episode.id));
  const bill = await billProjection(tx,episode,new Date()), financial = await financialResponsibilityInTransaction(tx,episode,bill);
  const medicine = await tx.select().from(mvpMedicineSources).where(eq(mvpMedicineSources.admissionId,episode.id)).orderBy(asc(mvpMedicineSources.recordedAt),asc(mvpMedicineSources.id));
  const assignments = (await tx.execute(sql`select a.id,a.nurse_id from hims.nurse_assignments a where a.admission_id=${episode.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=a.id) order by a.id`)).rows;
  const shifts = (await tx.execute(sql`select s.id,s.nurse_id,s.started_at,e.ended_at from hims.nursing_shifts s left join hims.effective_shift_ends e on e.shift_id=s.id where s.admission_id=${episode.id} order by s.started_at desc`)).rows;
  const blockers: string[] = [];
  if (!clinical) blockers.push("Assigned Nurse must record the named external Doctor's discharge approval and source evidence.");
  if (!physicalChecklist) blockers.push("Assigned Nurse must publish the current physical readiness checklist.");
  for (const c of checks) if (!c.current) blockers.push(`${c.check} requires completion or an applicable Admin-confirmed N/A.`);
  if (!vacancy) blockers.push("Assigned Nurse must record actual bed vacancy and waiting-care handover.");
  const pendingReturn=exceptions.find(x=>x.action==="CLINICAL"&&x.type==="RETURN_TO_BED"&&!exceptions.some(c=>c.action==="CLINICAL"&&c.type==="RETURN_CANCELLED"&&c.sourceId===x.id)&&!returns.some(r=>r.clinicalId===x.id));
  if(pendingReturn)blockers.push("Current external Doctor return instruction requires actual return or a source-bound external reconsideration.");
  if (bill.pendingPaise>0n) blockers.push("Pending charge sources require reconciliation.");
  if (bill.unpostedRoomPaise>0n) blockers.push("Reconcile actual room use before financial authorization.");
  const r = financial.responsibility;
  if (!r?.allocationComplete) blockers.push("Current externally verified payer responsibility is incomplete or stale.");
  if (r?.patientOutstandingPaise) blockers.push("Patient responsibility remains unpaid.");
  if (r?.patientExcessPaise || r?.insurerExcessPaise || bill.unallocatedDepositPaise>0n || bill.overpaidPaise>0n) blockers.push("Excess cash, unallocated deposit or actual refunds require disposition.");
  if (financial.pendingTransfers.length) blockers.push("External insurance responsibility for a transfer requires recorded resolution.");
  const f = latest("finance");
  const finance = f && !f.invalidation && f.event.billVersion===episode.billRevision && !blockers.length ? f.event : null;
  const deliveries = history.filter(r=>r.event.action==="deliver").map(r=>r.event);
  const hash = reviewHash(jsonSnapshot({ episode:{id:episode.id,status:episode.status,version:episode.version,billVersion:episode.billRevision}, events:history.map(r=>({id:r.event.id,invalid:r.invalidation?.id??null})),exceptions:exceptions.map(x=>x.id),returns:returns.map(x=>x.id),assignments,financial, vacancy:vacancy??null,departure:departure??null,exceptionalDeparture:exceptionalDeparture??null }));
  return { clinical,checklist:physicalChecklist,checks,finance,vacancy:vacancy??null,departure:departure??null,exceptionalDeparture:exceptionalDeparture??null,exceptions,returns,bill,financial,medicine,assignments,shifts,history,deliveries,blockers,reviewHash:hash };
}
export async function invalidateMvp(tx: Transaction, admissionId: string, checks: string[], kind: string, sourceId: string) {
  await tx.execute(sql`insert into hims.mvp_invalidations(event_id,kind,source_id) select e.id,${kind},${sourceId} from hims.mvp_events e where e.admission_id=${admissionId} and (e.action='finance' or (e.action in ('check','n-a') and e.check_key in (${sql.join(checks.length?checks.map(c=>sql`${c}`):[sql`''`],sql`, `)}))) on conflict(event_id) do nothing`);
}
