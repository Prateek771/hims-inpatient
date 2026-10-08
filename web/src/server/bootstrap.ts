import "server-only";
import { sql } from "drizzle-orm";
import { createStaffInput, createStaffAuth, staffRoles } from "./auth";
import { withTransaction } from "./db";
import { user } from "./schema/auth";
import { appendAudit } from "./audit";
import { DomainError } from "./contracts";
export async function bootstrapAdmin(input: unknown, demo = false) {
  const value = createStaffInput.parse(input);
  if (value.role !== "ADMIN")
    throw new DomainError("VALIDATION", "Bootstrap requires an administrator");
  return withTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(729104211)`);
    if ((await tx.select({ id: user.id }).from(user).limit(1)).length)
      throw new DomainError(
        "PRECONDITION",
        "Staff initialization already completed",
      );
    const result = await createStaffAuth(tx).api.createUser({
      body: {
        name: value.name,
        email: value.email,
        password: value.password,
        role: "ADMIN",
      },
    });
    await appendAudit(
      tx,
      {
        actor: { type: "staff", staffId: result.user.id },
        source: "local-bootstrap",
        requestId: crypto.randomUUID(),
      },
      {
        event: "staff.initialized",
        entityType: "staff",
        entityId: result.user.id,
        reason: value.reason,
      },
    );
    if (demo) {
      for (const role of staffRoles.filter((r) => r !== "ADMIN")) {
        const extra = await createStaffAuth(tx).api.createUser({
          body: {
            name: `${role[0]}${role.slice(1).toLowerCase()} development staff`,
            email: `${role.toLowerCase()}@hims.test`,
            password: value.password,
            role,
          },
        });
        await appendAudit(
          tx,
          {
            actor: { type: "staff", staffId: result.user.id },
            source: "local-demo-bootstrap",
            requestId: crypto.randomUUID(),
          },
          {
            event: "staff.created",
            entityType: "staff",
            entityId: extra.user.id,
            reason: "Owner authorized local development role accounts",
          },
        );
      }
    }
    return result.user.id;
  });
}
