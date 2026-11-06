import { sql, type SQL } from "drizzle-orm";
import { deferredCheckQueries } from "./deferred-check-queries";
import type { Executor } from "./sql";
import { rowsOf } from "./sql";

/**
 * PostgreSQL enforced seven rules with DEFERRABLE INITIALLY DEFERRED constraint triggers, checked at COMMIT because
 * the rows that satisfy them are written after the row that carries them. MariaDB has no commit-time triggers, so
 * each command that writes such rows calls the matching assertion after its last write and before it commits;
 * a violation rolls the whole transaction back. The error looks like a trigger rejection (errno 1644, SQLSTATE 45000).
 */
export class DeferredRuleViolation extends Error {
  readonly errno = 1644;
  readonly sqlState = "45000";
  readonly sqlMessage: string;
  constructor(message: string) {
    super(message);
    this.name = "DeferredRuleViolation";
    this.sqlMessage = message;
  }
}

const idList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** Replaces the `<ids>` placeholder of a generated query with bound values. */
function withIds(template: string, ids: readonly string[]): SQL {
  const parts = template.split("<ids>");
  let query: SQL = sql.raw(parts[0]);
  for (let i = 1; i < parts.length; i += 1) query = sql`${query}${idList(ids)}${sql.raw(parts[i])}`;
  return query;
}

async function firstViolation(tx: Pick<Executor, "execute">, query: SQL, message?: string) {
  const rows = rowsOf<{ message?: string }>(await tx.execute(query));
  if (rows.length) throw new DeferredRuleViolation(message ?? rows[0].message ?? "Commit-time rule violated");
}

/** Available stock must equal the append-only movement ledger for every batch the command wrote. */
export async function assertPharmacyLedger(tx: Pick<Executor, "execute">, batchIds: readonly string[]) {
  if (!batchIds.length) return;
  await firstViolation(
    tx,
    sql`SELECT b.id FROM pharmacy_batches b
        WHERE b.id IN (${idList(batchIds)})
          AND b.available_quantity <> COALESCE((SELECT SUM(m.quantity) FROM pharmacy_movements m WHERE m.batch_id = b.id), 0)`,
    "Available stock must equal the append-only movement ledger",
  );
}

/** A closed-episode charge or reversal must be backed by its exact attributable post-discharge amendment. */
export async function assertClosedFinancialResults(tx: Pick<Executor, "execute">, written: { chargeIds?: readonly string[]; reversalIds?: readonly string[] }) {
  const message = "Closed financial effect must commit its exact persisted attributable amendment";
  if (written.chargeIds?.length) {
    await firstViolation(
      tx,
      sql`SELECT ch.id FROM charges ch
          WHERE ch.id IN (${idList(written.chargeIds)}) AND ch.correction_exception_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id
                            WHERE a.id = ch.correction_exception_id AND m.kind = a.correction_kind AND m.source_id = a.source_id
                              AND m.signed_by = ch.actor_id
                              AND ((m.kind = 'CARE_BILLING' AND CAST(m.result_id AS CHAR) = ch.source_event_id)
                                OR (m.kind IN ('LAB_REPORT', 'LAB_BILLING')
                                    AND EXISTS (SELECT 1 FROM lab_reports r WHERE r.id = m.result_id AND r.order_id = a.source_id))))`,
      message,
    );
  }
  if (written.reversalIds?.length) {
    await firstViolation(
      tx,
      sql`SELECT cr.id FROM charge_reversals cr
          WHERE cr.id IN (${idList(written.reversalIds)}) AND cr.correction_exception_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id
                            WHERE a.id = cr.correction_exception_id AND m.kind = 'REVERSE_CHARGE' AND m.source_id = cr.charge_id
                              AND m.result_id = cr.id AND m.signed_by = cr.actor_id)`,
      message,
    );
  }
}

/** A receipt on a discharged version-2 admission must settle only its original party obligation. */
export async function assertClosedReceipt(tx: Pick<Executor, "execute">, receiptIds: readonly string[]) {
  if (receiptIds.length) await firstViolation(tx, withIds(deferredCheckQueries.closed_receipt, receiptIds));
}

/** A version-2 service charge needs its atomic external performed-service source. */
export async function assertExternalChargePair(tx: Pick<Executor, "execute">, chargeIds: readonly string[]) {
  if (chargeIds.length) await firstViolation(tx, withIds(deferredCheckQueries.external_charge_pair, chargeIds));
}

/** An actual MVP transfer must retain its source-bed turnover and required external insurance follow-up. */
export async function assertTransferEffects(tx: Pick<Executor, "execute">, transferIds: readonly string[]) {
  if (transferIds.length) await firstViolation(tx, withIds(deferredCheckQueries.transfer_effects, transferIds));
}

/** Convenience for the post-discharge amendment command: every charge and reversal carrying this exception must be backed. */
export async function assertClosedFinancialResultsForException(tx: Pick<Executor, "execute">, exceptionId: string) {
  const ids = async (table: "charges" | "charge_reversals") =>
    rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM ${sql.raw(table)} WHERE correction_exception_id = ${exceptionId}`)).map((row) => row.id);
  await assertClosedFinancialResults(tx, { chargeIds: await ids("charges"), reversalIds: await ids("charge_reversals") });
}
