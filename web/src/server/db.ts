import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { assertSyntheticRuntime } from "./synthetic-runtime";

type Database = ReturnType<typeof createDatabase>;
const globalDb = globalThis as typeof globalThis & { himsDatabase?: Database };

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  assertSyntheticRuntime(connectionString);
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000, statement_timeout: 5000 });
  // Idle connection errors must not terminate the web process or expose credentials.
  pool.on("error", () => console.error("HIMS database connection unavailable"));
  return drizzle(pool, { schema });
}

/** Lazy initialization keeps compilation and liveness independent of PostgreSQL. */
export function getDb(): Database {
  return globalDb.himsDatabase ??= createDatabase();
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
