import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError, type CommandContext, type StaffRole } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { careEpisode } from "../clinical/commands";
import { billingRequest, billProjection, fingerprint, lockBillingAdmission } from "../billing/commands";
import { billingRequests } from "../billing/schema";
import { user } from "../schema/auth";
import { appendAudit } from "../audit";
import { clearanceSeals, effectiveRoomVacations as roomVacations, roomVacations as originalRoomVacations, departures, effectiveBedTurnovers as bedTurnovers, bedTurnovers as originalBedTurnovers, bedTurnoverCompletions, gates, type Gate } from "./schema";
import { clinicalClearanceInputs, pharmacyClearanceInputs, nursingClearanceInputs, billingClearanceInputs, latestSeals, reviewHash, jsonSnapshot, invalidateAffectedClearances } from "./dependencies";
import { admissions, beds, bedHolds, effectiveRoomStays as roomStays, roomStays as originalRoomStays, effectivePatients as patients } from "../admissions/schema";
import { shiftForCare } from "../nursing/commands";
import { reconcileRoomChargesInTransaction } from "../billing/room-charges";
export { invalidateAffectedClearances } from "./dependencies";
const gateInput = z.enum(gates);
const roleForGate: Record<Gate, readonly StaffRole[]> = { DOCTOR: ["DOCTOR"], PHARMACY: ["PHARMACY"], NURSING: ["NURSE"], BILLING: ["BILLING", "ADMIN"] };
async function operator(tx: Transaction, ctx: CommandContext, gate: Gate) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
  return admissionOperator(ctx, roleForGate[gate], tx);
}
async function episodeForStaff(tx: Transaction, staff: { id: string; role: string }, admissionId: string, active = true) {
  const e = ["DOCTOR", "NURSE"].includes(staff.role) ? await careEpisode(tx, staff, admissionId, false) : await lockBillingAdmission(tx, admissionId);
  if (active && e.status !== "ADMITTED") throw new DomainError("PRECONDITION", "Ordinary discharge requires an active admission");
  return e;
}
/** Later gates validate predecessors internally without exposing their chart. */
export async function clearanceStateInTransaction(tx: Transaction, episode: typeof admissions.$inferSelect, reviewedBill?: Awaited<ReturnType<typeof billProjection>>) {
  const stored = await latestSeals(tx, episode.id);
  if(episode.status==="DISCHARGED")return {history:stored.all,reviews:gates.map(gate=>{
    const seal=stored.currentCandidates[gate];
    return {gate,reviewHash:seal?.reviewHash??"",inputs:seal?.inputs??{},blockers:[] as string[],current:!!seal,seal,predecessorId:seal?.predecessorId??null};
  })};
  const sources = [await clinicalClearanceInputs(tx, episode.id), await pharmacyClearanceInputs(tx, episode), await nursingClearanceInputs(tx, episode.id), await billingClearanceInputs(tx,episode,reviewedBill)];
  const reviews = [];
  let previous: typeof clearanceSeals.$inferSelect | undefined;
  for (const [index, gate] of gates.entries()) {
    const source = sources[index];
    const inputs = jsonSnapshot({ source: source.inputs, predecessorId: previous?.id ?? null });
    const hash = reviewHash(inputs), candidate = stored.currentCandidates[gate];
    const current = !!candidate && candidate.reviewHash === hash && source.blockers.length === 0 && (index === 0 || !!previous);
    if (candidate && !current) await invalidateAffectedClearances(tx, { admissionId: episode.id, changeKind: gate === "DOCTOR" ? "CLINICAL" : gate === "PHARMACY" ? "PHARMACY" : gate === "NURSING" ? "NURSING" : "MONEY", changedRecordIds: [candidate.id] });
    reviews.push({ gate, reviewHash: hash, inputs, blockers: [...source.blockers, ...(index > 0 && !previous ? ["The preceding professional clearance must be current before this gate can sign."] : [])], current, seal: current ? candidate : undefined, predecessorId: previous?.id ?? null });
    previous = current ? candidate : undefined;
  }
  return { reviews, history: stored.all };
}
export async function getClearanceReview(ctx: CommandContext, admissionId: string, gate: string) {
  const selected = gateInput.parse(gate);
  return withTransaction(async tx => {
    const staff = await operator(tx, ctx, selected), episode = await episodeForStaff(tx, staff, z.uuid().parse(admissionId), false);
    const bill=selected==="BILLING"?await billProjection(tx,episode,new Date()):undefined;
    const state = await clearanceStateInTransaction(tx, episode,bill), review = state.reviews.find(r => r.gate === selected)!;
    const signerIds=[...new Set(state.history.map(r=>r.seal.signedBy))];
    const signers=signerIds.length?await tx.select({id:user.id,name:user.name}).from(user).where(inArray(user.id,signerIds)):[];
    const [physicalBedUse]=await tx.select({vacatedAt:roomVacations.vacatedAt,waitingLocation:roomVacations.waitingLocation}).from(roomVacations).where(eq(roomVacations.admissionId,episode.id));
    return { ...review, billVersion: episode.billRevision, status: episode.status, admissionId: episode.id, ipCode: episode.ipCode,
      physicalBedUse,...(bill?{bill}:{}),
      gates: state.reviews.map(r => ({ gate: r.gate, current: r.current, signedBy: r.seal?.signedBy, signerName:signers.find(s=>s.id===r.seal?.signedBy)?.name, signedAt: r.seal?.signedAt })),
      history: state.history.map(r => ({ id: r.seal.id, gate: r.seal.gate, signedBy: r.seal.signedBy, signerName:signers.find(s=>s.id===r.seal.signedBy)?.name, signedAt: r.seal.signedAt, invalidation: r.invalidation?.changeKind })) };
  });
}
export async function issueClearance(ctx: CommandContext, input: unknown) { return withTransaction(tx => issueClearanceInTransaction(tx, ctx, input)); }
export async function recordRoomVacated(ctx: CommandContext, input: unknown) { return withTransaction(tx=>recordRoomVacatedInTransaction(tx,ctx,input)); }
/** Actual end of physical bed use, not hospital exit or a financial grace period. Bed hold and clinical care remain. */
export async function recordRoomVacatedInTransaction(tx:Transaction,ctx:CommandContext,input:unknown) {
  const v=z.strictObject({admissionId:z.uuid(),shiftId:z.uuid(),vacatedAt:z.iso.datetime(),waitingLocation:z.string().trim().min(3).max(200),handover:z.string().trim().min(3).max(1000),requestId:z.uuid()}).parse(input);
  if(ctx.requestId!==v.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  const staff=await operator(tx,ctx,"NURSING");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e=await episodeForStaff(tx,staff,v.admissionId,false);
  return billingRequest(tx,ctx,"discharge.room-vacated",v,async()=>{
    if(e.status!=="ADMITTED")throw new DomainError("PRECONDITION","New physical bed vacancy requires an active admission");
    if((await tx.select().from(roomVacations).where(eq(roomVacations.admissionId,e.id))).length)throw new DomainError("CONFLICT","Physical bed use already ended. Returning to a bed requires fresh clinical authority and an attributable stay workflow");
    const state=await clearanceStateInTransaction(tx,e);
    if(state.reviews.slice(0,3).some(r=>!r.current))throw new DomainError("PRECONDITION","Record current Doctor, Pharmacy and Nursing clearances before ordinary room vacancy");
    const nursing=state.reviews[2].seal!;
    const {actual:T}=await shiftForCare(tx,staff,v.shiftId,e.id,v.vacatedAt);
    const [stay]=await tx.select().from(roomStays).where(and(eq(roomStays.admissionId,e.id),isNull(roomStays.endedAt)));
    if(!stay||T<=stay.startedAt||T<nursing.signedAt||(stay.lastReconciledAt&&T<stay.lastReconciledAt))throw new DomainError("CONFLICT","Actual bed vacancy precedes its stay, current nursing seal or posted room history; use attributable correction rather than changing the physical time");
    await tx.select().from(beds).where(eq(beds.id,stay.bedId)).for("update");
    const [hold]=await tx.select().from(bedHolds).where(eq(bedHolds.bedId,stay.bedId));
    if(hold?.admissionId!==e.id)throw new DomainError("CONFLICT","Current physical bed hold changed");
    const laterUse=await tx.execute(sql`select 1 from hims.nursing_consumables where stay_id=${stay.id} and used_at>=${T} limit 1`);
    if(laterUse.rows.length)throw new DomainError("CONFLICT","Room vacancy precedes already recorded bed use; retain the factual time for correction");
    await reconcileRoomChargesInTransaction(tx,{admissionId:e.id,cutoff:T,actorContext:ctx});
    await tx.update(originalRoomStays).set({endedAt:T}).where(eq(originalRoomStays.id,stay.id));
    const [vacation]=await tx.insert(originalRoomVacations).values({admissionId:e.id,stayId:stay.id,nursingSealId:nursing.id,shiftId:v.shiftId,vacatedAt:T,waitingLocation:v.waitingLocation,handover:v.handover,signedBy:staff.id,signedAt:new Date()}).returning();
    await appendAudit(tx,ctx,{event:"discharge.room-vacated",entityType:"room-vacation",entityId:vacation.id,reason:v.handover});
    return {id:vacation.id};
  });
}
export async function recordDeparture(ctx:CommandContext,input:unknown){return withTransaction(tx=>recordDepartureInTransaction(tx,ctx,input));}
export async function recordDepartureInTransaction(tx:Transaction,ctx:CommandContext,input:unknown){
  const v=z.strictObject({admissionId:z.uuid(),departedAt:z.iso.datetime(),expectedBillVersion:z.number().int().positive(),requestId:z.uuid()}).parse(input);
  if(ctx.requestId!==v.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  const staff=await operator(tx,ctx,"BILLING");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e=await episodeForStaff(tx,staff,v.admissionId,false),T=new Date(v.departedAt);
  const [request]=await tx.select().from(billingRequests).where(and(eq(billingRequests.actorId,staff.id),eq(billingRequests.requestId,ctx.requestId)));
  if(request&&(request.action!=="discharge.departure"||request.payload!==fingerprint(v)))throw new DomainError("CONFLICT","Request key already belongs to a different action or payload");
  if(T>new Date()||!e.admittedAt||T<e.admittedAt)throw new DomainError("VALIDATION","Actual hospital departure must be within the admission and no later than now");
  const [old]=await tx.select().from(departures).where(eq(departures.admissionId,e.id));
  if(old){if(old.departedAt.getTime()!==T.getTime()||old.billVersion!==v.expectedBillVersion)throw new DomainError("CONFLICT","Departure is already recorded with different facts");await billingRequest(tx,ctx,"discharge.departure",v,async()=>({id:old.id}));return {id:old.id,status:"DISCHARGED" as const};}
  if(e.status!=="ADMITTED")throw new DomainError("PRECONDITION","Departure requires an active episode");
  const [vacation]=await tx.select().from(roomVacations).where(eq(roomVacations.admissionId,e.id));
  // Catch-up is committed even when new money requires review. This is not a recorded hospital exit.
  await reconcileRoomChargesInTransaction(tx,{admissionId:e.id,cutoff:vacation?.vacatedAt??T,actorContext:ctx});
  const updated=await lockBillingAdmission(tx,e.id),state=await clearanceStateInTransaction(tx,updated),financial=await billingClearanceInputs(tx,updated);
  if(!vacation||updated.billRevision!==v.expectedBillVersion||state.reviews.some(r=>!r.current))return {status:"REVIEW_REQUIRED" as const,billVersion:updated.billRevision,netPaise:financial.bill.netPaise,patientOutstandingPaise:financial.financial.responsibility?.patientOutstandingPaise,insurerOutstandingPaise:financial.financial.responsibility?.insurerOutstandingPaise,blockers:financial.blockers};
  const seal=state.reviews[3].seal!;
  if(T<seal.signedAt||T<vacation.vacatedAt)throw new DomainError("PRECONDITION","Hospital exit before final human clearance requires the administrator exception workflow; preserve its actual time");
  await tx.select().from(beds).where(eq(beds.id,e.bedId)).for("update");
  const [hold]=await tx.select().from(bedHolds).where(eq(bedHolds.bedId,e.bedId));
  if(hold?.admissionId!==e.id)throw new DomainError("CONFLICT","Episode bed hold changed");
  const [departure]=await tx.insert(departures).values({admissionId:e.id,stayId:vacation.stayId,billSealId:seal.id,billVersion:updated.billRevision,departedAt:T,signedBy:staff.id,signedAt:new Date()}).returning();
  await tx.update(admissions).set({status:"DISCHARGED",version:sql`${admissions.version}+1`}).where(eq(admissions.id,e.id));
  await tx.delete(bedHolds).where(eq(bedHolds.admissionId,e.id));
  // A proposed return may already have created this vacancy's cleaning task.
  const [turnover] = await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId, vacation.stayId));
  if (!turnover) {
    await tx.insert(originalBedTurnovers).values({
      bedId: e.bedId, stayId: vacation.stayId, admissionId: e.id, vacatedAt: vacation.vacatedAt,
      reason: "Ordinary hospital departure; housekeeping completion required before reuse",
      signedBy: staff.id, signedAt: new Date(),
    });
  }
  await appendAudit(tx,ctx,{event:"discharge.departure-recorded",entityType:"departure",entityId:departure.id,reason:"Four current human gates and actual party settlement; physical bed use and hospital departure retained separately"});
  await billingRequest(tx,ctx,"discharge.departure",v,async()=>({id:departure.id}));
  return {id:departure.id,status:"DISCHARGED" as const};
}
export async function completeBedTurnover(ctx:CommandContext,input:unknown){
  const v=z.strictObject({turnoverId:z.uuid(),completedAt:z.iso.datetime(),evidence:z.string().trim().min(3).max(1000),requestId:z.uuid()}).parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  return withTransaction(async tx=>{
    const staff=await admissionOperator(ctx,["ADMIN","ADMISSION"],tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const [turnover]=await tx.select().from(bedTurnovers).where(eq(bedTurnovers.id,v.turnoverId));
    if(!turnover)throw new DomainError("FORBIDDEN","Turnover access denied");
    await lockBillingAdmission(tx,turnover.admissionId);
    await tx.select().from(beds).where(eq(beds.id,turnover.bedId)).for("update");
    return billingRequest(tx,ctx,"discharge.turnover-complete",v,async()=>{
      const [old]=await tx.select().from(bedTurnoverCompletions).where(eq(bedTurnoverCompletions.turnoverId,turnover.id));if(old)return {id:old.id};
      const T=new Date(v.completedAt);if(T<turnover.vacatedAt||T>new Date())throw new DomainError("VALIDATION","Actual cleaning completion must follow vacancy and be no later than now");
      const [done]=await tx.insert(bedTurnoverCompletions).values({turnoverId:turnover.id,completedAt:T,evidence:v.evidence,signedBy:staff.id,signedAt:new Date()}).returning();
      await appendAudit(tx,ctx,{event:"discharge.turnover-completed",entityType:"bed-turnover",entityId:turnover.id,reason:v.evidence});return {id:done.id};
    });
  });
}
export async function dischargeWorkspace(ctx:CommandContext){return withTransaction(async tx=>{
  const staff=await admissionOperator(ctx,["ADMIN","BILLING","DOCTOR","NURSE","PHARMACY"],tx);
  const selectedGate:Gate=staff.role==="DOCTOR"?"DOCTOR":staff.role==="NURSE"?"NURSING":staff.role==="PHARMACY"?"PHARMACY":"BILLING";
  const scope=staff.role==="DOCTOR"?eq(admissions.admittingDoctorId,staff.id):staff.role==="NURSE"?sql`exists(select 1 from hims.nurse_assignments a where a.admission_id=${admissions.id} and a.nurse_id=${staff.id} and not exists(select 1 from hims.nurse_assignment_revocations r where r.assignment_id=a.id))`:undefined;
  const episodes=await tx.select({id:admissions.id,ipCode:admissions.ipCode,status:admissions.status,name:patients.name,bedLabel:beds.label}).from(admissions).innerJoin(patients,eq(patients.id,admissions.patientId)).innerJoin(beds,eq(beds.id,admissions.bedId)).where(and(scope,sql`${admissions.status}='ADMITTED' or (${admissions.status}='DISCHARGED' and ${admissions.registeredAt}>now()-interval '30 days')`)).orderBy(desc(admissions.registeredAt));
  const turnovers=staff.role==="ADMIN"?await tx.select({id:bedTurnovers.id,bedLabel:beds.label,vacatedAt:bedTurnovers.vacatedAt,reason:bedTurnovers.reason}).from(bedTurnovers).innerJoin(beds,eq(beds.id,bedTurnovers.bedId)).leftJoin(bedTurnoverCompletions,eq(bedTurnoverCompletions.turnoverId,bedTurnovers.id)).where(isNull(bedTurnoverCompletions.id)).orderBy(asc(bedTurnovers.vacatedAt)):[];
  return {selectedGate,episodes,turnovers};
});}
export async function requireGate4Review(tx:Transaction,episode:typeof admissions.$inferSelect,expectedHash?:string,expectedVersion?:number) {
  const state=await clearanceStateInTransaction(tx,episode);
  if(state.reviews.slice(0,3).some(r=>!r.current))throw new DomainError("PRECONDITION","Refunds and allocation corrections require current Doctor, Pharmacy and Nursing clearances");
  const review=state.reviews[3];
  if(review.reviewHash!==expectedHash||episode.billRevision!==expectedVersion)throw new DomainError("CONFLICT","Gate 4 review changed; refresh current cash, sources and bill before acting");
  return review;
}
export async function issueClearanceInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ admissionId: z.uuid(), gate: gateInput, expectedReviewHash: z.string().length(64), expectedBillVersion: z.number().int().positive().optional(), reviewNote: z.string().trim().min(3).max(1000).default("Human reviewed this gate's current evidence and discrepancies") }).parse(input);
  const staff = await operator(tx, ctx, value.gate);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const episode = await episodeForStaff(tx, staff, value.admissionId, false);
  const result = await billingRequest(tx, ctx, "discharge.seal", value, async () => {
    if(episode.status!=="ADMITTED")throw new DomainError("PRECONDITION","New human clearance requires an active admission");
    const state = await clearanceStateInTransaction(tx, episode), review = state.reviews.find(r => r.gate === value.gate)!;
    if (value.expectedReviewHash !== review.reviewHash || (value.gate === "BILLING" && value.expectedBillVersion !== episode.billRevision)) throw new DomainError("CONFLICT", "Reviewed inputs or bill changed; refresh and review before signing");
    if (review.blockers.length) throw new DomainError("PRECONDITION", review.blockers.join(" "));
    if (review.current) return { id: review.seal!.id };
    const [seal] = await tx.insert(clearanceSeals).values({ admissionId: episode.id, gate: value.gate, role: staff.role, reviewHash: review.reviewHash, inputs: review.inputs, predecessorId: review.predecessorId, billVersion: value.gate === "BILLING" ? episode.billRevision : null, reason: value.reviewNote, signedBy: staff.id, signedAt: new Date() }).returning();
    await appendAudit(tx, ctx, { event: "discharge.clearance-signed", entityType: "clearance-seal", entityId: seal.id, reason: value.reviewNote });
    return { id: seal.id };
  });
  const [seal] = await tx.select().from(clearanceSeals).where(eq(clearanceSeals.id, result.id));
  return seal;
}
