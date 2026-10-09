import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { DomainError, type CommandContext } from "../contracts";
import { db, withTransaction, type Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, patients } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { billingRequests, charges, chargeFinalizations, chargeReversals, receipts, receiptAllocations } from "./schema";
import { paise, quantityAmount } from "./money";
import { estimateRoomChargesInTransaction, reconcileRoomChargesInTransaction } from "./room-charges";
const reason = z.string().trim().min(3).max(500);
const amountInput = z.string().regex(/^\d{1,19}$/).refine((v) => paise(v) > 0n, "Amount must be positive");
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const actorColumns = (ctx: CommandContext) => ({ actorType: ctx.actor.type, actorId: ctx.actor.type === "staff" ? ctx.actor.staffId : ctx.actor.systemId });
export async function lockBillingAdmission(tx: Transaction, admissionId: string) {
  const [record] = await tx.select().from(admissions).where(eq(admissions.id, z.uuid().parse(admissionId))).for("update");
  if (!record)
    throw new DomainError("FORBIDDEN", "Admission access denied");
  return record;
}
export async function bumpBillRevision(tx: Transaction, admissionId: string) {
  const [record] = await tx.update(admissions).set({ billRevision: sql `${admissions.billRevision}+1` }).where(eq(admissions.id, admissionId)).returning();
  return record.billRevision;
}
/** Actor + request key is shared across actions: payload/action reuse cannot silently change meaning. */
export async function billingRequest(tx: Transaction, ctx: CommandContext, action: string, value: unknown, apply: () => Promise<{
  id: string;
}>) {
  if (ctx.actor.type !== "staff")
    throw new DomainError("FORBIDDEN", "Staff command required");
  z.uuid().parse(ctx.requestId);
  const actorId = ctx.actor.staffId, payload = fingerprint(value);
  await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${actorId}:${ctx.requestId}`},0))`);
  const [old] = await tx.select().from(billingRequests).where(and(eq(billingRequests.actorId, actorId), eq(billingRequests.requestId, ctx.requestId)));
  if (old) {
    if (old.action !== action || old.payload !== payload)
      throw new DomainError("CONFLICT", "Request key already belongs to a different action or payload");
    return old.result;
  }
  const result = await apply();
  await tx.insert(billingRequests).values({
    actorId, requestId: ctx.requestId, action, payload, result
  });
  return result;
}
function requestKey(ctx: CommandContext, requestId: string) {
  if (ctx.requestId !== requestId)
    throw new DomainError("VALIDATION", "Request keys disagree");
}
function openEpisode(record: typeof admissions.$inferSelect, requireActive = false) {
  if (!inArrayStatus(record.status, requireActive))
    throw new DomainError("PRECONDITION", "This admission cannot accept financial changes");
}
function inArrayStatus(status: string, active: boolean) { return active ? status === "ADMITTED" : ["PENDING", "ADMITTED"].includes(status); }
export const roomPolicyInput = z.object({
  type: z.literal("tariff"), category: z.string(), amount: z.string().regex(/^\d{1,19}$/), basis: z.enum(["hour", "24-hours"]), rounding: z.enum(["exact", "started-unit"]), graceMinutes: z.number().int().min(0).max(1440), graceMode: z.literal("deduct-once").optional()
});
export async function resolveActivationPolicies(tx: Transaction, record: typeof admissions.$inferSelect) {
  const [bed] = await tx.select().from(beds).where(eq(beds.id, record.bedId));
  const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, record.hospitalId)).orderBy(desc(settingVersions.version));
  const route = record.paymentRoute === "SELF_PAY" ? "self-pay" : "insured";
  const deposit = versions.find((v) => v.payload.type === "deposit" && v.payload.category === bed.category && v.payload.route === route);
  const tariff = versions.find((v) => v.payload.type === "tariff" && v.payload.category === bed.category);
  const category = versions.find((v) => v.payload.type === "bed-category" && v.payload.code === bed.category);
  if (!bed.active || category?.payload.active !== true || !deposit || !tariff)
    throw new DomainError("PRECONDITION", "Configure active category, explicit deposit rule and room tariff before activation");
  const rule = z.object({ requirement: z.enum(["required", "not-required"]), amount: z.string().regex(/^\d{1,19}$/) }).parse(deposit.payload);
  const requiredPaise = paise(rule.amount);
  if ((rule.requirement === "required") !== (requiredPaise > 0n))
    throw new DomainError("PRECONDITION", "Deposit policy is inconsistent");
  const policy = roomPolicyInput.parse(tariff.payload);
  paise(policy.amount);
  if (policy.graceMinutes > 0 && !policy.graceMode)
    throw new DomainError("PRECONDITION", "Configure explicit grace behavior");
  return { deposit, tariff, requiredPaise };
}
export async function patientDepositCash(tx: Transaction, admissionId: string) {
  const rows = await tx.select().from(receipts).where(and(eq(receipts.admissionId, admissionId), eq(receipts.party, "PATIENT"), inArray(receipts.kind, ["DEPOSIT", "TOP_UP"])));
  return rows.reduce((n, r) => n + r.amountPaise, 0n);
}
export const receiptInput = z.strictObject({
  admissionId: z.uuid(), party: z.enum(["PATIENT", "INSURER"]), kind: z.enum(["DEPOSIT", "TOP_UP", "PAYMENT"]), amountPaise: amountInput, mode: z.enum(["CASH", "CARD", "UPI", "BANK"]), channel: z.string().trim().min(2).max(100), sourceReference: z.string().trim().min(1).max(100), reference: z.string().trim().min(2).max(200), evidenceId: z.string().trim().min(2).max(200).optional(), requestId: z.uuid()
});
export async function recordReceipt(ctx: CommandContext, input: unknown) {
  const value = receiptInput.parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN", "BILLING", "ADMISSION"], tx);
    if ((staff.role === "ADMISSION" && (value.party !== "PATIENT" || value.kind === "PAYMENT")) || (value.party === "INSURER" && value.kind !== "PAYMENT"))
      throw new DomainError("FORBIDDEN", "Admission staff may record patient deposits/top-ups only; insurer funds are payments");
    const result = await billingRequest(tx, ctx, "receipt", value, async () => {
      const episode = await lockBillingAdmission(tx, value.admissionId);
      openEpisode(episode);
      const { requestId: retryKey, ...cashDetails } = value;
      void retryKey;
      const identityPayload = fingerprint(cashDetails);
      const identity = `${episode.hospitalId}:${value.mode}:${value.channel}:${value.sourceReference}`;
      await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`receipt:${identity}`},0))`);
      const [old] = await tx.select().from(receipts).where(and(eq(receipts.hospitalId, episode.hospitalId), eq(receipts.mode, value.mode), eq(receipts.channel, value.channel), eq(receipts.sourceReference, value.sourceReference)));
      if (old) {
        if (old.identityPayload !== identityPayload)
          throw new DomainError("CONFLICT", "This cash-book receipt or channel transaction already has different details");
        return { id: old.id };
      }
      const [receipt] = await tx.insert(receipts).values({
        ...cashDetails, amountPaise: paise(value.amountPaise), hospitalId: episode.hospitalId, identityPayload, ...actorColumns(ctx)
      }).returning();
      const revision = await bumpBillRevision(tx, episode.id);
      await appendAudit(tx, ctx, {
        event: "billing.receipt-recorded", entityType: "receipt", entityId: receipt.id, reason: "Staff-recorded receipt; no bank verification by HIMS", afterVersion: revision
      });
      return { id: receipt.id };
    });
    const [receipt] = await tx.select().from(receipts).where(eq(receipts.id, result.id));
    return receipt;
  });
}
const category = z.enum(["consultation", "procedure", "medicine", "consumable", "lab", "radiology"]);
export const itemPolicyInput = z.object({
  type: z.literal("billable-item"), code: z.string(), name: z.string(), category, department: z.enum(["DOCTOR", "PHARMACY", "NURSE", "LAB"]), unit: z.string(), quantityScale: z.number().int().min(0).max(6), amount: z.string().regex(/^\d{1,19}$/), active: z.boolean()
});
/** Narrow latest-active price selector; department commands still resolve and validate again at posting. */
export async function listBillableItems(ctx: CommandContext, eventKind: z.infer<typeof category>) {
  const kind = category.parse(eventKind);
  const departments = { consultation: "DOCTOR", procedure: "DOCTOR", medicine: "PHARMACY", consumable: "NURSE", lab: "LAB", radiology: "LAB" } as const;
  await admissionOperator(ctx, ["ADMIN", "BILLING", departments[kind], ...(["lab", "radiology"].includes(kind) ? ["DOCTOR" as const] : [])]);
  const versions = await db.select().from(settingVersions).where(eq(settingVersions.kind, "tariff")).orderBy(desc(settingVersions.version));
  const seen = new Set<string>();
  const items = [];
  for (const version of versions) {
    if (version.payload.type !== "billable-item") continue;
    const policy = itemPolicyInput.parse(version.payload);
    if (seen.has(policy.code)) continue;
    seen.add(policy.code);
    if (policy.active && policy.category === kind && policy.department === departments[kind]) items.push({ itemId: policy.code, name: policy.name, category: policy.category, unit: policy.unit, quantityScale: policy.quantityScale, tariffVersionId: version.id, unitPricePaise: paise(policy.amount) });
  }
  return items;
}
/** Call at the actual source boundary. A pinned version must come from that persisted source, never a form. */
export async function resolveBillableRate(tx: Transaction, input: {
  itemId: string;
  eventKind: string;
  unit: string;
  quantity: string;
  pinnedVersionId?: string;
}) {
  const versions = await tx.select().from(settingVersions).where(eq(settingVersions.kind, "tariff")).orderBy(desc(settingVersions.version));
  const current = versions.find((v) => v.payload.type === "billable-item" && v.payload.code === input.itemId);
  const version = input.pinnedVersionId ? versions.find((v) => v.id === input.pinnedVersionId && v.payload.type === "billable-item" && v.payload.code === input.itemId) : current;
  if (!version)
    throw new DomainError("PRECONDITION", "Configure this billable item first");
  const policy = itemPolicyInput.parse(version.payload);
  const departments = {
    consultation: "DOCTOR", procedure: "DOCTOR", medicine: "PHARMACY", consumable: "NURSE", lab: "LAB", radiology: "LAB"
  };
  if (!policy.active || policy.category !== input.eventKind || policy.department !== departments[policy.category])
    throw new DomainError("PRECONDITION", "Item is inactive or belongs to another source department");
  if (policy.unit !== input.unit)
    throw new DomainError("VALIDATION", "Quantity unit does not match the configured billing unit");
  const amountPaise = quantityAmount(paise(policy.amount), input.quantity, policy.quantityScale);
  return { version, policy, amountPaise };
}
const chargeInput = z.strictObject({
  admissionId: z.uuid(), sourceEventId: z.uuid(), category, itemId: z.string().regex(/^[A-Z0-9_-]{2,32}$/), quantity: z.string(), unit: z.string(), tariffVersionId: z.uuid(), status: z.enum(["PENDING", "FINAL"])
});
export async function postCharge(ctx: CommandContext, input: unknown) {
  chargeInput.parse(input);
  await admissionOperator(ctx, ["ADMIN", "BILLING"]);
  // Tasks 6–9 supply real department source validation before they expose posting.
  throw new DomainError("PRECONDITION", "Post charges through a recorded department event; department workflows are not yet available");
}
/** Internal-only: owning department validates persisted source and holds the admission lock.
* existing pinned charge retries are accepted; new events must use current configured version.
* Future orders can supply a trusted source-pinned rate after validating their persisted record. */
export async function postChargeInTransaction(tx: Transaction, ctx: CommandContext, input: unknown, sourcePinnedRate?: Awaited<ReturnType<typeof resolveBillableRate>>) {
  const value = chargeInput.parse(input);
  const operator = await admissionOperator(ctx, ["ADMIN", "BILLING", "DOCTOR", "PHARMACY", "NURSE", "LAB"], tx);
  const departments = {
    consultation: "DOCTOR", procedure: "DOCTOR", medicine: "PHARMACY", consumable: "NURSE", lab: "LAB", radiology: "LAB"
  };
  const doctorPendingOrder = operator.role === "DOCTOR" && ["lab", "radiology"].includes(value.category) && value.status === "PENDING";
  if (!["ADMIN", "BILLING"].includes(operator.role) && operator.role !== departments[value.category] && !doctorPendingOrder)
    throw new DomainError("FORBIDDEN", "Source actor belongs to another department");
  const episode = await lockBillingAdmission(tx, value.admissionId);
  openEpisode(episode, true);
  if (doctorPendingOrder && episode.admittingDoctorId !== operator.id) throw new DomainError("FORBIDDEN", "Doctor order admission access denied");
  const sourcePayload = fingerprint({ ...value, status: undefined });
  const [old] = await tx.select().from(charges).where(and(eq(charges.admissionId, value.admissionId), eq(charges.sourceEventId, value.sourceEventId)));
  if (old) {
    if (old.sourcePayload !== sourcePayload)
      throw new DomainError("CONFLICT", "Source event already has different charge details");
    if (value.status === "FINAL")
      await finalizeInTransaction(tx, ctx, old);
    return old;
  }
  const rate = sourcePinnedRate ?? await resolveBillableRate(tx, {
    itemId: value.itemId, eventKind: value.category, unit: value.unit, quantity: value.quantity
  });
  if (rate.version.id !== value.tariffVersionId || rate.policy.code !== value.itemId || rate.policy.category !== value.category || rate.policy.unit !== value.unit || rate.version.hospitalId !== episode.hospitalId || rate.amountPaise !== quantityAmount(paise(rate.policy.amount), value.quantity, rate.policy.quantityScale))
    throw new DomainError("CONFLICT", "Source must pin the authorized configured rate version and quantity");
  const [charge] = await tx.insert(charges).values({
    admissionId: value.admissionId, sourceEventId: value.sourceEventId, sourcePayload, category: value.category, itemId: value.itemId, quantity: value.quantity, unit: value.unit, tariffVersionId: rate.version.id, ratePaise: paise(rate.policy.amount), amountPaise: rate.amountPaise, description: rate.policy.name, initialStatus: value.status, ...actorColumns(ctx)
  }).returning();
  const revision = await bumpBillRevision(tx, value.admissionId);
  await appendAudit(tx, ctx, {
    event: "billing.charge-posted", entityType: "charge", entityId: charge.id, reason: "Server-resolved source item price", afterVersion: revision
  });
  return charge;
}
async function finalizeInTransaction(tx: Transaction, ctx: CommandContext, charge: typeof charges.$inferSelect) {
  if (charge.initialStatus === "FINAL")
    return;
  const [created] = await tx.insert(chargeFinalizations).values({ chargeId: charge.id, ...actorColumns(ctx) }).onConflictDoNothing().returning();
  if (created) {
    const revision = await bumpBillRevision(tx, charge.admissionId);
    await appendAudit(tx, ctx, {
      event: "billing.charge-finalized", entityType: "charge", entityId: charge.id, reason: "Pending source finalized without a second economic charge", afterVersion: revision
    });
  }
}
export async function finalizeCharge(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ chargeId: z.uuid(), requestId: z.uuid() }).parse(input);
  requestKey(ctx, value.requestId);
  await admissionOperator(ctx, ["ADMIN", "BILLING"]);
  throw new DomainError("PRECONDITION", "Finalize charges through the recorded department completion; completion workflows are not yet available");
}
export async function reverseCharge(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({
    chargeId: z.uuid(), amountPaise: amountInput, reason, requestId: z.uuid()
  }).parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
    return billingRequest(tx, ctx, "reverse", value, async () => {
      const [charge] = await tx.select().from(charges).where(eq(charges.id, value.chargeId));
      if (!charge)
        throw new DomainError("FORBIDDEN", "Charge access denied");
      return reverseChargeInTransaction(tx, ctx, { chargeId: charge.id, amountPaise: value.amountPaise, reason: value.reason });
    });
  });
}
/** Transaction composition for later returns: caller supplies validated source correction, no nested transaction. */
export async function reverseChargeInTransaction(tx: Transaction, ctx: CommandContext, input: {
  chargeId: string;
  amountPaise: string;
  reason: string;
}) {
  const value = z.strictObject({ chargeId: z.uuid(), amountPaise: amountInput, reason }).parse(input);
  await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
  const [charge] = await tx.select().from(charges).where(eq(charges.id, value.chargeId));
  if (!charge)
    throw new DomainError("FORBIDDEN", "Charge access denied");
  openEpisode(await lockBillingAdmission(tx, charge.admissionId), true);
  const old = await tx.select().from(chargeReversals).where(eq(chargeReversals.chargeId, charge.id));
  const amountPaise = paise(value.amountPaise);
  if (old.reduce((n, r) => n + r.amountPaise, 0n) + amountPaise > charge.amountPaise)
    throw new DomainError("PRECONDITION", "Reversal exceeds the remaining original charge");
  const [line] = await tx.insert(chargeReversals).values({
    chargeId: charge.id, amountPaise, reason: value.reason, ...actorColumns(ctx)
  }).returning();
  const revision = await bumpBillRevision(tx, charge.admissionId);
  await appendAudit(tx, ctx, {
    event: "billing.charge-reversed", entityType: "charge-reversal", entityId: line.id, reason: value.reason, afterVersion: revision
  });
  return { id: line.id };
}
export async function allocateDeposit(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({
    receiptId: z.uuid(), amountPaise: amountInput, reason, requestId: z.uuid()
  }).parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
    return billingRequest(tx, ctx, "allocate", value, () => allocateDepositInTransaction(tx, ctx, { receiptId: value.receiptId, amountPaise: value.amountPaise, reason: value.reason }));
  });
}
/** Compose final billing allocation with its existing admission transaction. No second cash movement. */
export async function allocateDepositInTransaction(tx: Transaction, ctx: CommandContext, input: { receiptId: string; amountPaise: string; reason: string }) {
  const value = z.strictObject({ receiptId: z.uuid(), amountPaise: amountInput, reason }).parse(input);
  await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
  const [receipt] = await tx.select().from(receipts).where(eq(receipts.id, value.receiptId));
  if (!receipt) throw new DomainError("FORBIDDEN", "Receipt access denied");
  const episode = await lockBillingAdmission(tx, receipt.admissionId);
  openEpisode(episode, true);
  if (receipt.party !== "PATIENT" || receipt.kind === "PAYMENT") throw new DomainError("PRECONDITION", "Allocate a patient deposit or top-up");
  const prior = await tx.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, receipt.id));
  const amountPaise = paise(value.amountPaise);
  if (prior.reduce((n, r) => n + r.amountPaise, 0n) + amountPaise > receipt.amountPaise) throw new DomainError("PRECONDITION", "Allocation exceeds unallocated deposit cash");
  const bill = await billProjection(tx, episode, new Date());
  if (amountPaise > bill.outstandingPaise) throw new DomainError("PRECONDITION", "Allocation exceeds the posted bill remaining balance");
  const [line] = await tx.insert(receiptAllocations).values({ receiptId: receipt.id, amountPaise, reason: value.reason, ...actorColumns(ctx) }).returning();
  const revision = await bumpBillRevision(tx, episode.id);
  await appendAudit(tx, ctx, { event: "billing.deposit-allocated", entityType: "receipt-allocation", entityId: line.id, reason: value.reason, afterVersion: revision });
  return { id: line.id };
}
export async function refundReceipt(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({
    receiptId: z.uuid(), amountPaise: amountInput, reason, requestId: z.uuid()
  }).parse(input);
  requestKey(ctx, value.requestId);
  await admissionOperator(ctx, ["ADMIN", "BILLING"]);
  throw new DomainError("PRECONDITION", "Refunds require current Doctor, Pharmacy and Nursing clearances and Gate 4 review; these gates are not yet available");
}
export async function cancelAllocation(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ allocationId: z.uuid(), reason, requestId: z.uuid() }).parse(input);
  requestKey(ctx, value.requestId);
  await admissionOperator(ctx, ["ADMIN", "BILLING"]);
  throw new DomainError("PRECONDITION", "Deposit adjustments require current clearances and Gate 4 review");
}
async function billProjection(tx: Transaction, episode: typeof admissions.$inferSelect, cutoff: Date) {
  const lines = await tx.select().from(charges).where(eq(charges.admissionId, episode.id)).orderBy(asc(charges.createdAt), asc(charges.id));
  const ids = lines.map((r) => r.id);
  const reversals = ids.length ? await tx.select().from(chargeReversals).where(inArray(chargeReversals.chargeId, ids)) : [];
  const finalizations = ids.length ? await tx.select().from(chargeFinalizations).where(inArray(chargeFinalizations.chargeId, ids)) : [];
  const cash = await tx.select().from(receipts).where(eq(receipts.admissionId, episode.id)).orderBy(asc(receipts.createdAt));
  const cashIds = cash.map((r) => r.id);
  const allocations = cashIds.length ? await tx.select().from(receiptAllocations).where(inArray(receiptAllocations.receiptId, cashIds)) : [];
  const finalized = new Set(finalizations.map((r) => r.chargeId));
  const isFinal = (r: typeof charges.$inferSelect) => r.initialStatus === "FINAL" || finalized.has(r.id);
  const netPending = (r: typeof charges.$inferSelect) => r.amountPaise - reversals.filter(v=>v.chargeId===r.id).reduce((n,v)=>n+v.amountPaise,0n);
  const grossPaise = lines.filter(isFinal).reduce((n, r) => n + r.amountPaise, 0n);
  const reversedPaise = reversals.filter((r) => lines.some((c) => c.id === r.chargeId && isFinal(c))).reduce((n, r) => n + r.amountPaise, 0n);
  const netPaise = grossPaise - reversedPaise;
  const patientCashPaise = cash.filter((r) => r.party === "PATIENT").reduce((n, r) => n + r.amountPaise, 0n);
  const insurerCashPaise = cash.filter((r) => r.party === "INSURER").reduce((n, r) => n + r.amountPaise, 0n);
  const depositCashPaise = cash.filter((r) => r.kind !== "PAYMENT").reduce((n, r) => n + r.amountPaise, 0n);
  const depositAllocatedPaise = allocations.reduce((n, r) => n + r.amountPaise, 0n);
  const billPaidPaise = cash.filter((r) => r.kind === "PAYMENT").reduce((n, r) => n + r.amountPaise, 0n) + depositAllocatedPaise;
  const unpostedRoomPaise = await estimateRoomChargesInTransaction(tx, episode.id, cutoff);
  return {
    admissionId: episode.id, status: episode.status, ipCode: episode.ipCode, paymentRoute: episode.paymentRoute, revision: episode.billRevision, asOf: cutoff, grossPaise, reversedPaise, netPaise, pendingPaise: lines.filter((r) => !isFinal(r)).reduce((n, r) => n + netPending(r), 0n), patientCashPaise, insurerCashPaise, depositCashPaise, depositAllocatedPaise, unallocatedDepositPaise: depositCashPaise - depositAllocatedPaise, billPaidPaise, outstandingPaise: netPaise > billPaidPaise ? netPaise - billPaidPaise : 0n, overpaidPaise: billPaidPaise > netPaise ? billPaidPaise - netPaise : 0n, unpostedRoomPaise, payerResponsibility: episode.paymentRoute === "INSURED" ? "UNAVAILABLE" : "SELF_PAY", charges: lines.map((r) => ({ ...r, status: isFinal(r) ? "FINAL" : "PENDING" })), reversals, receipts: cash, allocations
  };
}
export async function getBill(ctx: CommandContext, admissionId: string, cutoff?: Date) {
  return withTransaction((tx) => getBillInTransaction(tx, ctx, admissionId, cutoff));
}
/** Role-safe read for final cutoff after room reconciliation within the owning transaction. */
export async function getBillInTransaction(tx: Transaction, ctx: CommandContext, admissionId: string, cutoff?: Date) {
  await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
  const [episode] = await tx.select().from(admissions).where(eq(admissions.id, z.uuid().parse(admissionId))).for("share");
  if (!episode) throw new DomainError("FORBIDDEN", "Admission access denied");
  return billProjection(tx, episode, cutoff ?? new Date());
}
export async function getDepositSummary(ctx: CommandContext, admissionId: string) {
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMISSION", "ADMIN", "BILLING"], tx);
    const [episode] = await tx.select().from(admissions).where(eq(admissions.id, z.uuid().parse(admissionId))).for("share");
    if (!episode)
      throw new DomainError("FORBIDDEN", "Admission access denied");
    const paidPaise = await patientDepositCash(tx, episode.id);
    let requiredPaise: bigint | null = null, policyIssue: string | null = null;
    try {
      if (episode.depositVersionId) {
        const [version] = await tx.select().from(settingVersions).where(eq(settingVersions.id, episode.depositVersionId));
        requiredPaise = paise(z.object({ amount: z.string() }).parse(version.payload).amount);
      }
      else
        requiredPaise = (await resolveActivationPolicies(tx, episode)).requiredPaise;
    }
    catch (error) {
      if (!(error instanceof DomainError) && !(error instanceof z.ZodError))
        throw error;
      policyIssue = error instanceof DomainError ? error.message : "Financial policy requires configuration";
    }
    return {
      admissionId: episode.id, version: episode.version, status: episode.status, requiredPaise, paidPaise, remainingPaise: requiredPaise === null ? null : requiredPaise > paidPaise ? requiredPaise - paidPaise : 0n, policyIssue
    };
  });
}
export async function billingWorkspace(ctx: CommandContext) {
  await admissionOperator(ctx, ["ADMIN", "BILLING"]);
  // Refunds are blocked in this phase, so every recorded receipt is still held cash.
  // Task 12 must net actual authorized returns here when it adds cancelled-deposit disposition.
  const heldCash = sql`coalesce((select sum(r.amount_paise) from hims.receipts r where r.admission_id=${admissions.id}),0)`;
  const rows = await db.select({ id: admissions.id, ipCode: admissions.ipCode, status: admissions.status, name: patients.name, bedLabel: beds.label, heldCashPaise: heldCash.mapWith(BigInt) }).from(admissions).innerJoin(patients, eq(patients.id, admissions.patientId)).innerJoin(beds, eq(beds.id, admissions.bedId)).where(or(inArray(admissions.status, ["PENDING", "ADMITTED"]), and(eq(admissions.status, "CANCELLED"), sql`${heldCash}>0`))).orderBy(desc(admissions.registeredAt));
  return rows.map((row) => ({ ...row, requiresCashReview: row.status === "CANCELLED" && row.heldCashPaise > 0n }));
}
export async function reconcileBill(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ admissionId: z.uuid(), cutoff: z.iso.datetime() }).parse(input);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
    return billingRequest(tx, ctx, "room-reconcile", value, async () => {
      const episode = await lockBillingAdmission(tx, value.admissionId);
      openEpisode(episode, true);
      await reconcileRoomChargesInTransaction(tx, { admissionId: episode.id, cutoff: new Date(value.cutoff), actorContext: ctx });
      return { id: episode.id };
    });
  });
}
