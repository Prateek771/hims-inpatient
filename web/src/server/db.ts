import "server-only";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { mariaPoolOptions, mariaSessionSettings, rewriteSharedLocks } from "./maria-options";
import * as schema from "./schema";
import { assertSyntheticRuntime } from "./synthetic-runtime";

type Database = ReturnType<typeof createDatabase>;
const globalDb = globalThis as typeof globalThis & { himsDatabase?: Database; himsPool?: Pool };
/** Server-side statement limit in seconds (MariaDB max_statement_time), the equivalent of the old statement_timeout. */
const statementTimeoutSeconds = 5;

/** Per-connection session settings: UTC, bounded statements, PostgreSQL-like READ COMMITTED default. */
export function initialiseMariaConnection(pool: Pool) {
  pool.pool.on("connection", (connection) => {
    rewriteSharedLocks(connection);
    connection.query(
      mariaSessionSettings(statementTimeoutSeconds),
      (error: unknown) => { if (error) console.error("HIMS database session setup failed"); },
    );
    connection.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED", (error: unknown) => {
      if (error) console.error("HIMS database session setup failed");
    });
  });
  // Idle connection errors must not terminate the web process or expose credentials.
  pool.pool.on("error", () => console.error("HIMS database connection unavailable"));
  return pool;
}

/** Creates a configured pool; scripts and tests may use it directly. */
export function createMariaPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return initialiseMariaConnection(createPool(mariaPoolOptions(connectionString)));
}

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  assertSyntheticRuntime(connectionString);
  const pool = (globalDb.himsPool = createMariaPool(connectionString));
  return drizzle(pool, { schema, mode: "default" });
}

/** Lazy initialization keeps compilation and liveness independent of MariaDB. */
export function getDb(): Database {
  return globalDb.himsDatabase ??= createDatabase();
}

/** The raw mysql2 pool behind getDb(), for scripts and the lock/migration helpers. */
export function getPool(): Pool {
  getDb();
  return globalDb.himsPool as Pool;
}

export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = getDb();
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function withTransaction<T>(fn: (tx: Transaction) => Promise<T>) {
  return getDb().transaction(fn);
}
