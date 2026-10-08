import "server-only";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin, staffContext } from "./access";
import { db, withTransaction } from "./db";
import { hospitalSettings, settingVersions, user } from "./schema";
import { appendAudit } from "./audit";
import { DomainError } from "./contracts";
const key = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{2,32}$/);
const money = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/)
  .transform((v) => {
    const [r, p = ""] = v.split(".");
    return (BigInt(r) * 100n + BigInt(p.padEnd(2, "0"))).toString();
  });
export const settingInput = z.strictObject({
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
  value: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("hospital"),
      name: z.string().trim().min(2).max(150),
      address: z.string().trim().min(3).max(500),
      timezone: z.string().refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid timezone"),
    }),
    z.strictObject({
      type: z.literal("bed-category"),
      code: key,
      name: z.string().trim().min(2).max(80),
      active: z.boolean(),
    }),
    z.strictObject({
      type: z.literal("tariff"),
      category: key,
      amount: money,
      basis: z.enum(["hour", "24-hours"]),
      rounding: z.enum(["exact", "started-unit"]),
      graceMinutes: z.number().int().min(0).max(1440),
      graceMode: z.literal("deduct-once").optional(),
    }).refine((v) => v.graceMinutes === 0 || v.graceMode === "deduct-once", "Choose explicit grace behavior"),
    z.strictObject({
      type: z.literal("billable-item"), code: key,
      name: z.string().trim().min(2).max(120),
      category: z.enum(["consultation", "procedure", "medicine", "consumable", "lab", "radiology"]),
      department: z.enum(["DOCTOR", "PHARMACY", "NURSE", "LAB"]),
      unit: z.string().trim().regex(/^[a-z][a-z0-9-]{0,31}$/),
      quantityScale: z.number().int().min(0).max(6),
      amount: money, active: z.boolean(),
    }),
    z.strictObject({
      type: z.literal("deposit"),
      category: key,
      route: z.enum(["self-pay", "insured"]),
      requirement: z.enum(["required", "not-required"]),
      amount: money,
    }),
    z.strictObject({
      type: z.literal("alert"),
      basis: z.enum(["insurer-limit", "patient-deposit"]),
      percent: z.number().int().min(1).max(100),
    }),
  ]),
});
export async function listSettings(h: Headers) {
  await requireAdmin(h);
  const [hospital] = await db.select().from(hospitalSettings).limit(1);
  const versions = hospital
    ? await db
        .select({ record: settingVersions, actorName: user.name })
        .from(settingVersions)
        .leftJoin(user, eq(settingVersions.actorId, user.id))
        .where(eq(settingVersions.hospitalId, hospital.id))
        .orderBy(desc(settingVersions.createdAt), desc(settingVersions.version))
    : [];
  return {
    hospital: hospital ?? null,
    versions: versions.map(({ record, actorName }) => ({
      ...record,
      actorName: actorName ?? "Former staff",
    })),
  };
}
export async function saveSetting(h: Headers, input: unknown) {
  const staff = await requireAdmin(h);
  const value = settingInput.parse(input);
  return withTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(729104211)`);
    const [operator] = await tx
      .select()
      .from(user)
      .where(eq(user.id, staff.id));
    if (!operator || operator.banned || operator.role !== "ADMIN")
      throw new DomainError("FORBIDDEN", "Administrator access required");
    let [hospital] = await tx.select().from(hospitalSettings).limit(1);
    if (!hospital) {
      if (value.value.type !== "hospital")
        throw new DomainError(
          "PRECONDITION",
          "Configure hospital details first",
        );
      [hospital] = await tx
        .insert(hospitalSettings)
        .values({
          name: value.value.name,
          timezone: value.value.timezone,
          identity: { address: value.value.address },
        })
        .returning();
    }
    if (value.value.type === "hospital")
      await tx
        .update(hospitalSettings)
        .set({
          name: value.value.name,
          timezone: value.value.timezone,
          identity: { address: value.value.address },
        })
        .where(eq(hospitalSettings.id, hospital.id));
    const kind = ["tariff", "billable-item"].includes(value.value.type) ? "tariff" : "rule";
    const versions = await tx
      .select()
      .from(settingVersions)
      .where(eq(settingVersions.hospitalId, hospital.id))
      .orderBy(desc(settingVersions.version));
    if (value.value.type === "billable-item") {
      const item = value.value;
      const departments = { consultation: "DOCTOR", procedure: "DOCTOR", medicine: "PHARMACY", consumable: "NURSE", lab: "LAB", radiology: "LAB" };
      if (item.department !== departments[item.category]) throw new DomainError("VALIDATION", "Configure the item in its source department");
      const prior = versions.find((v) => v.payload.type === "billable-item" && v.payload.code === item.code);
      if (prior && (prior.payload.category !== item.category || prior.payload.department !== item.department || prior.payload.unit !== item.unit || prior.payload.quantityScale !== item.quantityScale)) throw new DomainError("CONFLICT", "Item identity, department and quantity unit/scale are stable; use a new code for a different item");
    }
    if (value.value.type === "tariff" || value.value.type === "deposit") {
      const code = value.value.category;
      const category = versions.find(
        (v) => v.payload.type === "bed-category" && v.payload.code === code,
      );
      if (!category || !category.payload.active)
        throw new DomainError(
          "PRECONDITION",
          "Configure an active bed category first",
        );
    }
    if (
      value.value.type === "deposit" &&
      value.value.requirement === "required" &&
      value.value.amount === "0"
    )
      throw new DomainError(
        "VALIDATION",
        "Required deposit must be greater than zero",
      );
    if (
      value.value.type === "deposit" &&
      value.value.requirement === "not-required" &&
      value.value.amount !== "0"
    )
      throw new DomainError(
        "VALIDATION",
        "No-deposit rule must have zero amount",
      );
    const previous = versions.find((v) => v.kind === kind)?.version ?? 0;
    if (value.expectedVersion !== previous)
      throw new DomainError(
        "CONFLICT",
        "Settings changed. Refresh the page and review the latest version before saving.",
      );
    const [record] = await tx
      .insert(settingVersions)
      .values({
        hospitalId: hospital.id,
        kind,
        version: previous + 1,
        payload: value.value,
        actorType: "staff",
        actorId: staff.id,
        reason: value.reason,
      })
      .returning();
    await appendAudit(tx, staffContext(staff, "hospital-settings"), {
      event: "settings.version-created",
      entityType: "setting-version",
      entityId: record.id,
      reason: value.reason,
      beforeVersion: previous || undefined,
      afterVersion: record.version,
    });
    return record;
  });
}
