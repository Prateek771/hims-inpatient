import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { mariaPoolOptions } from "../src/server/maria-options.ts";
import { splitStatements } from "./sql-statements.ts";

export function loadLocalEnvironment() {
  // Next intentionally excludes .env.local in test mode and that file may still hold the retained PostgreSQL
  // checkout's settings, so this branch keeps its MariaDB variables in .env.mariadb.local (ignored by Git).
  // Node preserves explicitly supplied CI/hosting variables.
  const path = fileURLToPath(new URL("../.env.mariadb.local", import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

/** One connection for DDL: TLS verified off loopback, no multi-statement mode (the splitter sends statements one by one). */
export async function connectForMigration(connectionString: string): Promise<Connection> {
  const { connectionLimit, maxIdle, idleTimeout, waitForConnections, ...options } = mariaPoolOptions(connectionString);
  void connectionLimit; void maxIdle; void idleTimeout; void waitForConnections;
  return createConnection({ ...options, multipleStatements: false });
}

const migrationFolder = fileURLToPath(new URL("../drizzle-maria/", import.meta.url));

async function migrationFiles(folder: string) {
  const files: { name: string; script: string; checksum: string }[] = [];
  for (const name of (await readdir(folder)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) {
    const script = await readFile(resolve(folder, name), "utf8");
    files.push({ name, script, checksum: createHash("sha256").update(script.replace(/\r\n/g, "\n")).digest("hex") });
  }
  return files;
}

/** True when every current migration file is recorded with an identical checksum (the schema can be reused as is). */
export async function isMigrated(connection: Connection, folder = migrationFolder) {
  try {
    const [recorded] = await connection.query<RowDataPacket[]>("SELECT name, checksum FROM hims_migrations");
    const known = new Map(recorded.map((row) => [row.name as string, row.checksum as string]));
    const files = await migrationFiles(folder);
    return files.length > 0 && files.every((file) => known.get(file.name) === file.checksum);
  } catch {
    return false; // no ledger yet
  }
}

/**
 * Applies web/drizzle-maria/*.sql in order. MariaDB has no transactional DDL, so every file is idempotent and
 * is recorded in hims_migrations only after all of its statements succeeded; a failed file is simply re-run.
 * A recorded file whose checksum changed is refused.
 */
export async function migrate(connection: Connection, folder = migrationFolder) {
  const [[lock]] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('hims_migrate', 30) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error("Another migration is running");
  try {
    await connection.query("CREATE TABLE IF NOT EXISTS hims_migrations (name VARCHAR(255) NOT NULL, checksum CHAR(64) NOT NULL, applied_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)), PRIMARY KEY (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin");
    const applied: string[] = [];
    for (const { name, script, checksum } of await migrationFiles(folder)) {
      const [existing] = await connection.query<RowDataPacket[]>("SELECT checksum FROM hims_migrations WHERE name = ?", [name]);
      if (existing.length) {
        if (existing[0].checksum !== checksum) throw new Error("Applied migration checksum mismatch");
        continue;
      }
      for (const statement of splitStatements(script)) await connection.query(statement);
      await connection.query("INSERT INTO hims_migrations (name, checksum) VALUES (?, ?)", [name, checksum]);
      applied.push(name);
    }
    return applied;
  } finally {
    await connection.query("SELECT RELEASE_LOCK('hims_migrate')");
  }
}
