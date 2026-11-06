import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { createPool, type Pool } from "mysql2/promise";
import { mariaPoolOptions, mariaSessionSettings } from "./maria-options";
import type { Executor } from "./sql";

export type TxLockMode = "exclusive" | "shared";

/** `hims_locks.lock_key` is VARCHAR(255); longer keys are replaced by their SHA-256 so equal keys still collide. */
export function lockRowKey(key: string): string {
  if (key.length === 0) throw new Error("A lock key is required");
  return key.length <= 255 ? key : `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * Lock rows are created by a tiny autocommit statement on a separate two-connection pool (one per database URL), never
 * inside the caller's transaction: two transactions racing to insert the same new key would otherwise deadlock while
 * upgrading their locks, and a separate pool cannot starve the main pool of connections.
 */
const creators = new Map<string, Pool>();
function creatorFor(url: string): Pool {
  let pool = creators.get(url);
  if (!pool) {
    const { connectionLimit, maxIdle, ...options } = mariaPoolOptions(url);
    void connectionLimit; void maxIdle;
    pool = createPool({ ...options, connectionLimit: 2, maxIdle: 2 });
    pool.pool.on("connection", (connection) => { connection.query(mariaSessionSettings(5), () => {}); });
    creators.set(url, pool);
  }
  return pool;
}
async function ensureLockRow(lockKey: string) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const creator = creatorFor(url);
  // A plain read takes no lock; inserting an existing key would queue behind whoever holds it exclusively.
  const [existing] = await creator.query("SELECT 1 FROM hims_locks WHERE lock_key = ?", [lockKey]);
  if ((existing as unknown[]).length === 0) await creator.query("INSERT IGNORE INTO hims_locks (lock_key) VALUES (?)", [lockKey]);
}

/**
 * Transaction-scoped lock replacing pg_advisory_xact_lock / pg_advisory_xact_lock_shared.
 * The row lock is released at COMMIT or ROLLBACK. Must be called inside a transaction.
 * Take every lock a command needs in one consistent order, and never upgrade shared to exclusive
 * (two sharers upgrading deadlock; MariaDB then aborts one with errno 1213).
 * `hims_locks` rows are never deleted: the table is bounded by the number of distinct keys.
 */
export async function acquireTxLock(tx: Pick<Executor, "execute">, key: string, mode: TxLockMode = "exclusive"): Promise<void> {
  const lockKey = lockRowKey(key);
  await ensureLockRow(lockKey);
  if (mode === "shared") await tx.execute(sql`SELECT lock_key FROM hims_locks WHERE lock_key = ${lockKey} LOCK IN SHARE MODE`);
  else await tx.execute(sql`SELECT lock_key FROM hims_locks WHERE lock_key = ${lockKey} FOR UPDATE`);
}
