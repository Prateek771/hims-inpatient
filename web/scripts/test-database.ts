import { Client } from "pg";
import { loadLocalEnvironment, migrate } from "./migrate.ts";
import { getTestDatabaseConfig } from "./test-database-guard.ts";
export { assertTestDatabase, assertTestDatabasePair } from "./test-database-guard.ts";
/** Migration-only preparation for browsers. Never resets existing test records/schema. */
export async function prepareTestDatabase() {
  loadLocalEnvironment();
  const { ownerUrl } = getTestDatabaseConfig();
  const owner = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 3000 });
  try {
    await owner.connect();
    await owner.query("SELECT pg_advisory_lock(729104210)");
    try {
      await migrate(owner);
    } finally {
      await owner.query("SELECT pg_advisory_unlock(729104210)");
    }
  } finally {
    await owner.end();
  }
}

export async function withTestDatabase<T>(fn: (clients: { owner: Client; runtime: Client }) => Promise<T>) {
  loadLocalEnvironment();
  const { ownerUrl, runtimeUrl, databaseName } = getTestDatabaseConfig();
  const owner = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 3000 });
  const runtime = new Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 3000 });
  let locked = false;
  try {
    await owner.connect();
    const { rows: [identity] } = await owner.query("SELECT current_database() AS name, current_user AS role, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user");
    if (identity.name !== databaseName || identity.role !== "hims_test_owner" || identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole) throw new Error("Unsafe actual test connection");
    await owner.query("SELECT pg_advisory_lock(729104210)");
    locked = true;
    await owner.query("DROP SCHEMA IF EXISTS hims CASCADE; DROP TABLE IF EXISTS public.hims_migrations");
    await migrate(owner);
    await runtime.connect();
    return await fn({ owner, runtime });
  } finally {
    if (locked) await owner.query("SELECT pg_advisory_unlock(729104210)");
    await Promise.all([owner.end(), runtime.end()]);
  }
}
