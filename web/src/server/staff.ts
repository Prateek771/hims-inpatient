import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createStaffAuth, staffRoles, createStaffInput } from "./auth";
import { requireAdmin, staffContext } from "./access";
import { db, withTransaction } from "./db";
import { user, session } from "./schema/auth";
import { appendAudit } from "./audit";
import { DomainError } from "./contracts";
const updateInput = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(2).max(100),
  role: z.enum(staffRoles),
  active: z.boolean(),
  password: z.string().min(12).max(128).optional(),
  reason: z.string().trim().min(3).max(500),
});
export async function listStaff(h: Headers) {
  await requireAdmin(h);
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      disabled: user.banned,
    })
    .from(user)
    .orderBy(user.name);
}
export async function createStaff(h: Headers, input: unknown) {
  const staff = await requireAdmin(h);
  const value = createStaffInput.parse(input);
  return withTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(729104211)`);
    const current = await tx.select().from(user).where(eq(user.id, staff.id));
    if (current[0]?.banned || current[0]?.role !== "ADMIN")
      throw new DomainError("FORBIDDEN", "Administrator access required");
    const result = await createStaffAuth(tx).api.createUser({
      headers: h,
      body: {
        name: value.name,
        email: value.email,
        password: value.password,
        role: value.role,
      },
    });
    await appendAudit(tx, staffContext(staff, "staff-management"), {
      event: "staff.created",
      entityType: "staff",
      entityId: result.user.id,
      reason: value.reason,
    });
    return { id: result.user.id };
  });
}
export async function updateStaff(h: Headers, input: unknown) {
  const staff = await requireAdmin(h);
  const value = updateInput.parse(input);
  await withTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(729104211)`);
    const [operator] = await tx
      .select()
      .from(user)
      .where(eq(user.id, staff.id));
    if (!operator || operator.banned || operator.role !== "ADMIN")
      throw new DomainError("FORBIDDEN", "Administrator access required");
    const [target] = await tx.select().from(user).where(eq(user.id, value.id));
    if (!target)
      throw new DomainError("VALIDATION", "Staff account does not exist");
    if (
      target.role === "ADMIN" &&
      !target.banned &&
      (!value.active || value.role !== "ADMIN")
    ) {
      const admins = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, "ADMIN"), eq(user.banned, false)));
      if (admins.length < 2)
        throw new DomainError(
          "PRECONDITION",
          "Keep at least one active administrator",
        );
    }
    if (value.password)
      await createStaffAuth(tx).api.setUserPassword({
        headers: h,
        body: { userId: target.id, newPassword: value.password },
      });
    await tx
      .update(user)
      .set({
        name: value.name,
        role: value.role,
        banned: !value.active,
        banReason: value.active ? null : value.reason,
        banExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, target.id));
    if (!value.active || value.role !== target.role || value.password)
      await tx.delete(session).where(eq(session.userId, target.id));
    await appendAudit(tx, staffContext(staff, "staff-management"), {
      event: "staff.updated",
      entityType: "staff",
      entityId: target.id,
      reason: value.reason,
    });
  });
}
export { bootstrapAdmin } from "./bootstrap";
