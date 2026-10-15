import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { admissionOperator, transferAdmissionInTransaction } from "../admissions/commands";
import { admissions, beds, effectiveRoomStays } from "../admissions/schema";
import { admissionTransfers, mvpTransferAuthorities, mvpTransferCancellations } from "../admissions/transfer-schema";
import { appendAudit } from "../audit";
import { careEpisode, careRequest } from "../clinical/commands";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { settingVersions } from "../schema/core";
import { doctorDirectoryVersions } from "./staff-schema";

const note = z.string().trim().min(3).max(500);
const externalSource = { externalDoctorId: z.uuid(), authorizerName: z.string().trim().min(2).max(150), sourceTime: z.iso.datetime(), evidence: note, reason: note };
export const mvpTransferAuthorityInput = z.strictObject({ admissionId: z.uuid(), ...externalSource, destinationCategory: z.string().trim().regex(/^[A-Z0-9_-]{2,32}$/), expectedVersion: z.number().int().positive(), requestId: z.uuid() });
export const executeMvpTransferInput = z.strictObject({ admissionId: z.uuid(), authorityId: z.uuid(), targetBedId: z.uuid(), shiftId: z.uuid(), handover: note, transferredAt: z.iso.datetime(), requestId: z.uuid() });
export const cancelMvpTransferInput = z.strictObject({ admissionId: z.uuid(), authorityId: z.uuid(), ...externalSource, requestId: z.uuid() });
export type MvpTransferAuthorityInput = z.input<typeof mvpTransferAuthorityInput>;
export type ExecuteMvpTransferInput = z.input<typeof executeMvpTransferInput>;
export type CancelMvpTransferInput = z.input<typeof cancelMvpTransferInput>;

function requestKey(ctx: CommandContext, requestId: string) {
  if (ctx.requestId !== requestId) throw new DomainError("VALIDATION", "Request keys disagree");
}
async function externalDoctor(tx: Transaction, id: string, name: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`doctor-directory:${id}`},0))`);
  const [doctor] = await tx.select().from(doctorDirectoryVersions).where(eq(doctorDirectoryVersions.doctorId, id)).orderBy(desc(doctorDirectoryVersions.version)).limit(1);
  if (!doctor?.active || doctor.name !== name) throw new DomainError("VALIDATION", "Select the named active external Doctor from the directory");
}
function sourceTime(value: string, earliest: Date) {
  const actual = new Date(value);
  if (actual < earliest || actual > new Date()) throw new DomainError("VALIDATION", "External instruction must fall within the current stay and no later than now");
  return actual;
}

/** Called only after the governing admission lock, by the shared physical transfer writer. */
export async function currentMvpTransferAuthority(tx: Transaction, episode: typeof admissions.$inferSelect, stay: typeof effectiveRoomStays.$inferSelect | undefined, authorityId: string) {
  const [authority] = await tx.select().from(mvpTransferAuthorities).where(eq(mvpTransferAuthorities.id, authorityId));
  const [latest] = await tx.select({ id: mvpTransferAuthorities.id }).from(mvpTransferAuthorities).where(eq(mvpTransferAuthorities.admissionId, episode.id)).orderBy(desc(mvpTransferAuthorities.version)).limit(1);
  const [cancelled] = await tx.select({ id: mvpTransferCancellations.id }).from(mvpTransferCancellations).where(eq(mvpTransferCancellations.authorityId, authorityId));
  const [used] = await tx.select({ id: admissionTransfers.id }).from(admissionTransfers).where(eq(admissionTransfers.mvpAuthorityId, authorityId));
  if (episode.workflowVersion !== 2 || episode.status !== "ADMITTED" || !stay || stay.bedId !== episode.bedId || !authority || authority.admissionId !== episode.id || authority.sourceStayId !== stay.id || latest?.id !== authority.id || cancelled || used)
    throw new DomainError("CONFLICT", "External transfer authority is missing, superseded, cancelled or already consumed; refresh the current stay");
  return authority;
}

export async function recordMvpTransferAuthority(ctx: CommandContext, input: unknown) {
  const value = mvpTransferAuthorityInput.parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async tx => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(tx, ctx, staff, "mvp.transfer-authority", value, async () => {
      const episode = await careEpisode(tx, staff, value.admissionId);
      if (episode.workflowVersion !== 2 || episode.version !== value.expectedVersion) throw new DomainError("CONFLICT", "Review the current MVP admission before recording transfer authority");
      const [stay] = await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId, episode.id), isNull(effectiveRoomStays.endedAt)));
      if (!stay || stay.bedId !== episode.bedId) throw new DomainError("PRECONDITION", "An occupied current stay is required; waiting patients need the attributable return workflow");
      await externalDoctor(tx, value.externalDoctorId, value.authorizerName);
      const actual = sourceTime(value.sourceTime, stay.startedAt);
      const [latest] = await tx.select().from(mvpTransferAuthorities).where(eq(mvpTransferAuthorities.admissionId, episode.id)).orderBy(desc(mvpTransferAuthorities.version)).limit(1);
      if (latest && actual < latest.sourceTime) throw new DomainError("CONFLICT", "A newer recorded external transfer instruction already exists");
      const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, episode.hospitalId)).orderBy(desc(settingVersions.version));
      const category = versions.find(v => v.payload.type === "bed-category" && v.payload.code === value.destinationCategory);
      if (category?.payload.active !== true) throw new DomainError("PRECONDITION", "Select an active configured destination category");
      const [record] = await tx.insert(mvpTransferAuthorities).values({ admissionId: episode.id, sourceStayId: stay.id, externalDoctorId: value.externalDoctorId, authorizerName: value.authorizerName, sourceTime: actual, destinationCategory: value.destinationCategory, evidence: value.evidence, reason: value.reason, version: (latest?.version ?? 0) + 1, admissionVersion: episode.version, recordedBy: staff.id }).returning();
      // The native insert guard advances the admission version with the immutable instruction.
      await appendAudit(tx, ctx, { event: "mvp.transfer-authority-recorded", entityType: "mvp-transfer-authority", entityId: record.id, reason: value.reason, beforeVersion: episode.version, afterVersion: episode.version + 1 });
      return { id: record.id };
    });
  });
}

export async function executeMvpTransfer(ctx: CommandContext, input: unknown) {
  const value = executeMvpTransferInput.parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(tx => transferAdmissionInTransaction(tx, ctx, { admissionId: value.admissionId, mvpAuthorityId: value.authorityId, targetBedId: value.targetBedId, handover: { shiftId: value.shiftId, notes: value.handover }, transferredAt: value.transferredAt, requestId: value.requestId }));
}

export async function cancelMvpTransferAuthority(ctx: CommandContext, input: unknown) {
  const value = cancelMvpTransferInput.parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async tx => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(tx, ctx, staff, "mvp.transfer-cancelled", value, async () => {
      const episode = await careEpisode(tx, staff, value.admissionId);
      const [stay] = await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId, episode.id), isNull(effectiveRoomStays.endedAt)));
      const authority = await currentMvpTransferAuthority(tx, episode, stay, value.authorityId);
      await externalDoctor(tx, value.externalDoctorId, value.authorizerName);
      const actual = sourceTime(value.sourceTime, authority.sourceTime);
      const [record] = await tx.insert(mvpTransferCancellations).values({ admissionId: episode.id, authorityId: authority.id, externalDoctorId: value.externalDoctorId, authorizerName: value.authorizerName, sourceTime: actual, evidence: value.evidence, reason: value.reason, recordedBy: staff.id }).returning();
      await appendAudit(tx, ctx, { event: "mvp.transfer-cancelled", entityType: "mvp-transfer-cancellation", entityId: record.id, reason: value.reason, beforeVersion: episode.version, afterVersion: episode.version + 1 });
      return { id: record.id };
    });
  });
}

export async function getMvpTransferState(ctx: CommandContext, admissionId: string) {
  return withTransaction(async tx => {
    const staff = await admissionOperator(ctx, ["ADMIN", "ADMISSION", "NURSE"], tx);
    const [episode] = await tx.select().from(admissions).where(eq(admissions.id, z.uuid().parse(admissionId)));
    if (!episode || episode.workflowVersion !== 2) throw new DomainError("FORBIDDEN", "MVP transfer access denied");
    if (staff.role === "NURSE" && !(await tx.execute(sql`select hims.mvp_assigned(${episode.id}::uuid,${staff.id}) allowed`)).rows[0]?.allowed) throw new DomainError("FORBIDDEN", "Current episode Nurse assignment required");
    const [currentStay] = await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId, episode.id), isNull(effectiveRoomStays.endedAt)));
    const sources = await tx.select().from(mvpTransferAuthorities).where(eq(mvpTransferAuthorities.admissionId, episode.id)).orderBy(desc(mvpTransferAuthorities.version));
    const cancellations = await tx.select().from(mvpTransferCancellations).where(eq(mvpTransferCancellations.admissionId, episode.id));
    const history = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.admissionId, episode.id)).orderBy(desc(admissionTransfers.transferredAt));
    const authorities = sources.map((source, i) => ({ ...source, status: history.some(h => h.mvpAuthorityId === source.id) ? "COMPLETED" as const : cancellations.some(c => c.authorityId === source.id) ? "CANCELLED" as const : i === 0 && episode.status === "ADMITTED" && currentStay?.id === source.sourceStayId ? "PENDING" as const : "SUPERSEDED" as const }));
    const targets = await tx.select({ id: beds.id, label: beds.label, category: beds.category, available: sql<boolean>`${beds.active} and not exists(select 1 from hims.bed_holds h where h.bed_id=${beds.id}) and not exists(select 1 from hims.effective_bed_turnovers t where t.bed_id=${beds.id} and not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id))` }).from(beds).orderBy(asc(beds.label));
    const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, episode.hospitalId)).orderBy(desc(settingVersions.version));
    const seen = new Set<string>();
    const categories = versions.filter(v => { if (v.payload.type !== "bed-category" || typeof v.payload.code !== "string" || seen.has(v.payload.code)) return false; seen.add(v.payload.code); return v.payload.active === true; }).map(v => ({ code: String(v.payload.code), name: String(v.payload.name) }));
    return { episodeVersion: episode.version, currentStay: currentStay ?? null, authorities, cancellations, history, beds: targets, categories };
  });
}
