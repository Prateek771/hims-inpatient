// Backup/restore verification on synthetic data only: dump the dedicated hims_test database with mariadb-dump,
// load it into a new scratch database on the same loopback server, and prove the copy is identical (table checksums,
// row counts, triggers, routines, views, migration ledger and protected-file hashes). Run after the tests that
// populate hims_test, e.g. `npm run test:integration && npm run test:recovery`.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectForMigration, loadLocalEnvironment } from "./migrate.ts";
import { assertRecoveryTargets } from "./recovery-guard.ts";
import { getTestDatabaseConfig } from "./test-database-guard.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const infrastructure = new Set(["hims_migrations", "hims_locks", "lg_checkpoint_migrations"]);
const binary = (name) => (process.platform === "win32" ? resolve("C:/Program Files/MariaDB 11.8/bin", `${name}.exe`) : name);
const quote = (name) => `\`${name.replace(/`/g, "``")}\``;

function client(command, url, args, options = {}) {
  const target = new URL(url);
  const result = spawnSync(binary(command), ["-h", target.hostname.replace(/^\[|\]$/g, ""), "-P", target.port || "3306", "-u", decodeURIComponent(target.username), ...args], {
    cwd: app,
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(target.password) },
    ...options,
  });
  // Child output can echo statements and paths; never forward it.
  if (result.error || result.status !== 0) throw new Error(`Recovery ${command} step failed (${result.status ?? "SPAWN"})`);
  return result;
}

async function inventory(connection, database) {
  const scalar = async (sql) => Number((await connection.query(sql, [database]))[0][0].n);
  const [tableRows] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", [database]);
  const tables = [];
  for (const { name } of tableRows) {
    const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM ${quote(database)}.${quote(name)}`);
    const [[checksum]] = await connection.query(`CHECKSUM TABLE ${quote(database)}.${quote(name)} EXTENDED`);
    tables.push({ name, rows: Number(count.n), checksum: String(checksum.Checksum) });
  }
  return {
    tables,
    triggers: await scalar("SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?"),
    routines: await scalar("SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?"),
    views: await scalar("SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?"),
  };
}

loadLocalEnvironment();
const config = getTestDatabaseConfig();
const restoreName = `hims_test_restore_${randomBytes(8).toString("hex")}`;
const restoreUrl = (() => { const url = new URL(config.ownerUrl); url.pathname = `/${restoreName}`; return url.toString(); })();
assertRecoveryTargets(config.ownerUrl, restoreUrl, process.env.DATABASE_URL);

const workDirectory = resolve(app, "../tmp/recovery", restoreName);
const dump = resolve(workDirectory, "dump.sql");
let source;
let restored;
try {
  mkdirSync(workDirectory, { recursive: true });
  source = await connectForMigration(config.ownerUrl);
  const before = await inventory(source, config.databaseName);
  assert(before.tables.some((t) => !infrastructure.has(t.name) && t.rows > 0), "The synthetic database is empty: populate it first (run the integration or browser tests).");

  // mariadb-dump restores views alphabetically over placeholder tables with integer columns, so a view that reads another
  // view created later fails ("Illegal parameter data types"). Views are therefore dumped as definitions and replayed below.
  const [viewRows] = await source.query("SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [config.databaseName]);
  const views = viewRows.map((row) => row.name);
  client("mariadb-dump", config.ownerUrl, ["--single-transaction", "--routines", "--triggers", "--events", "--skip-comments", "--default-character-set=utf8mb4", ...views.map((name) => `--ignore-table=${config.databaseName}.${name}`), `--result-file=${dump}`, config.databaseName]);

  await source.query(`CREATE DATABASE ${quote(restoreName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
  client("mariadb", restoreUrl, ["--default-character-set=utf8mb4", restoreName, "-e", `source ${dump.replace(/\\/g, "/")}`]);

  restored = await connectForMigration(restoreUrl);
  for (let pending = views, pass = 0; pending.length > 0; pass += 1) {
    assert(pass <= views.length, "Views could not be restored in dependency order");
    const failed = [];
    for (const name of pending) {
      const [[definition]] = await source.query(`SHOW CREATE VIEW ${quote(config.databaseName)}.${quote(name)}`);
      try { await restored.query(definition["Create View"]); } catch { failed.push(name); }
    }
    pending = failed;
  }
  const after = await inventory(restored, restoreName);
  assert.deepEqual(after.tables.map((t) => t.name), before.tables.map((t) => t.name), "Restored table set differs");
  for (const table of before.tables) {
    const copy = after.tables.find((t) => t.name === table.name);
    assert.equal(copy.rows, table.rows, `Row count differs for ${table.name}`);
    assert.equal(copy.checksum, table.checksum, `Checksum differs for ${table.name}`);
  }
  assert.equal(after.triggers, before.triggers, "Trigger count differs");
  assert.equal(after.routines, before.routines, "Routine count differs");
  assert.equal(after.views, before.views, "View count differs");
  const [[files]] = await restored.query("SELECT COUNT(*) AS total, SUM(sha2(content, 256) <> sha256 OR OCTET_LENGTH(content) <> size_bytes) AS damaged FROM protected_files");
  assert.equal(Number(files.damaged ?? 0), 0, "A restored protected file does not match its recorded hash");
  console.log(JSON.stringify({ restore: "verified", tables: after.tables.length, rows: after.tables.reduce((n, t) => n + t.rows, 0), triggers: after.triggers, routines: after.routines, views: after.views, protectedFiles: Number(files.total) }));
} catch (error) {
  console.error(error instanceof assert.AssertionError || /^Recovery |synthetic database is empty/.test(error?.message ?? "") ? error.message : "Recovery verification failed; inspect database access and the dump tools without exposing credentials");
  process.exitCode = 1;
} finally {
  await source?.query(`DROP DATABASE IF EXISTS ${quote(restoreName)}`).catch(() => {});
  await Promise.all([source?.end().catch(() => {}), restored?.end().catch(() => {})]);
  rmSync(workDirectory, { recursive: true, force: true });
}
