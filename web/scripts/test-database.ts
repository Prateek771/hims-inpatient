import type { Connection } from "mysql2/promise";
import { connectForMigration, isMigrated, loadLocalEnvironment, migrate } from "./migrate.ts";
import { TestClient } from "./test-client.ts";
import { getTestDatabaseConfig } from "./test-database-guard.ts";
export { assertTestDatabase, assertTestDatabasePair } from "./test-database-guard.ts";
export { TestClient } from "./test-client.ts";

const inFlight = new Set<Promise<void>>();
/** Vitest timeouts do not cancel callbacks. Drain before restoring mutable test env. */
export async function waitForTestDatabaseIdle() {
  while (inFlight.size) await Promise.all([...inFlight]);
}

/** The same account without a default database, so a dropped or missing test database can be (re)created. */
function withoutDatabase(url: string) {
  const parsed = new URL(url);
  parsed.pathname = "/";
  return parsed.toString();
}
const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;
const lifecycleLock = "hims_test_lifecycle";

async function ownerIdentity(owner: Connection, databaseName: string) {
  const [rows] = await owner.query("SELECT DATABASE() AS name, CURRENT_USER() AS user");
  const identity = (rows as { name: string | null; user: string }[])[0];
  if (identity.name !== databaseName || !identity.user.startsWith("hims_test_owner@")) throw new Error("Unsafe actual test connection");
}

/** TRUNCATE does not fire the append-only triggers, and foreign keys are not checked while the tables are emptied. */
async function emptyAllTables(owner: Connection) {
  const [rows] = await owner.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT IN ('hims_migrations', 'hims_locks', 'lg_checkpoint_migrations')");
  await owner.query("SET foreign_key_checks = 0");
  try {
    for (const { name } of rows as { name: string }[]) await owner.query(`TRUNCATE TABLE ${quote(name)}`);
  } finally {
    await owner.query("SET foreign_key_checks = 1");
  }
}

/** Migration-only preparation for browsers. Never resets existing test records/schema. */
export async function prepareTestDatabase() {
  loadLocalEnvironment();
  const { ownerUrl } = getTestDatabaseConfig();
  const { databaseName } = getTestDatabaseConfig();
  const owner = await connectForMigration(withoutDatabase(ownerUrl));
  try {
    await owner.query(`SELECT GET_LOCK('${lifecycleLock}', 60)`);
    await owner.query(`CREATE DATABASE IF NOT EXISTS ${quote(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
    await owner.query(`USE ${quote(databaseName)}`);
    try {
      await migrate(owner);
      await emptyAllTables(owner); // browser fixtures are created once per run; earlier runs' synthetic rows would duplicate them
    } finally {
      await owner.query(`SELECT RELEASE_LOCK('${lifecycleLock}')`);
    }
  } finally {
    await owner.end();
  }
}

/**
 * Drops and recreates the dedicated synthetic database (so every object, trigger and routine starts empty),
 * migrates it, and hands the test an owner client and a limited runtime client.
 */
export async function withTestDatabase<T>(fn: (clients: { owner: TestClient; runtime: TestClient }) => Promise<T>) {
  loadLocalEnvironment();
  const { ownerUrl, runtimeUrl, databaseName } = getTestDatabaseConfig();
  const ownerConnection = await connectForMigration(withoutDatabase(ownerUrl));
  let owner: TestClient | undefined;
  let runtime: TestClient | undefined;
  let locked = false;
  let finished!: () => void;
  const completion = new Promise<void>((done) => { finished = done; });
  inFlight.add(completion);
  try {
    await ownerConnection.query(`SELECT GET_LOCK('${lifecycleLock}', 120)`);
    locked = true;
    await ownerConnection.query(`CREATE DATABASE IF NOT EXISTS ${quote(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
    await ownerConnection.query(`USE ${quote(databaseName)}`);
    await ownerIdentity(ownerConnection, databaseName);
    if (await isMigrated(ownerConnection)) {
      await emptyAllTables(ownerConnection); // same schema, triggers and routines: only the data is reset (~seconds)
    } else {
      await ownerConnection.query(`DROP DATABASE IF EXISTS ${quote(databaseName)}`);
      await ownerConnection.query(`CREATE DATABASE ${quote(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
      await ownerConnection.query(`USE ${quote(databaseName)}`);
      await migrate(ownerConnection); // DDL runs with the plain session mode the SQL files were written for
    }
    owner = new TestClient(ownerUrl);
    runtime = new TestClient(runtimeUrl);
    return await fn({ owner, runtime });
  } finally {
    try {
      if (locked) await ownerConnection.query(`SELECT RELEASE_LOCK('${lifecycleLock}')`);
    } finally {
      try { await Promise.all([ownerConnection.end(), owner?.end(), runtime?.end()]); }
      finally { inFlight.delete(completion); finished(); }
    }
  }
}
