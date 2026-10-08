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
    const kind = value.value.type === "tariff" ? "tariff" : "rule";
    const versions = await tx
      .select()
      .from(settingVersions)
      .where(eq(settingVersions.hospitalId, hospital.id))
      .orderBy(desc(settingVersions.version));
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
