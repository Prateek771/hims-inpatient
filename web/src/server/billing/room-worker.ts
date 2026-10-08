import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db, withTransaction } from "../db";
import { admissions } from "../admissions/schema";
import { lockBillingAdmission } from "./commands";
import { reconcileRoomChargesInTransaction } from "./room-charges";
/** Explicit one-pass job; importing this module never starts work. Restart uses persisted stay cursors. */
export async function postDueRoomCharges(cutoff: Date) {
  const work = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.status, "ADMITTED")).orderBy(asc(admissions.id));
  let delta = 0n;
  for (const row of work) {
    delta += await withTransaction(async (tx) => {
      // Per-admission job lock lets independent stays progress without a long global transaction.
      await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`room-worker:${row.id}`},0))`);
      const episode = await lockBillingAdmission(tx, row.id);
      if (episode.status !== "ADMITTED")
        return 0n;
      return reconcileRoomChargesInTransaction(tx, { admissionId: episode.id, cutoff, actorContext: { actor: { type: "system", systemId: "room-charge" }, source: "room-worker", requestId: crypto.randomUUID() } });
    });
  }
  return delta;
}
