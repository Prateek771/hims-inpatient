import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createConnection } from "mysql2/promise";
import { mariaPoolOptions } from "../src/server/maria-options.ts";
import { assertDemoTarget, assertEmptyDemoDatabase } from "./demo-hospital-guard.ts";

const app = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(app, "tmp");
const credentials = resolve(output, "clone-demo-logins.txt");
const quote = value => '`' + value.replaceAll('`', '``') + '`';

async function initialize() {
  if (existsSync(resolve(app, ".env.mariadb.local"))) process.loadEnvFile(resolve(app, ".env.mariadb.local"));
  assertDemoTarget(process.env.DATABASE_URL ?? "", process.env);
  const { connectionLimit, maxIdle, idleTimeout, waitForConnections, ...options } = mariaPoolOptions(process.env.DATABASE_URL);
  void connectionLimit; void maxIdle; void idleTimeout; void waitForConnections;
  const client = await createConnection({ ...options, connectTimeout: 3000 });
  try {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("START TRANSACTION");
    const [[identity]] = await client.query("SELECT DATABASE() AS `database`, CURRENT_USER() AS user");
    // The migration ledger, lock and checkpoint-version tables are infrastructure, not hospital data.
    const [tableRows] = await client.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    const tables = tableRows.map(row => row.name).filter(name => !["hims_migrations", "hims_locks", "lg_checkpoint_migrations"].includes(name));
    const populated = [];
    for (const table of tables) {
      const [result] = await client.query(`SELECT EXISTS(SELECT 1 FROM ${quote(table)} LIMIT 1) AS populated`);
      if (Number(result[0].populated)) populated.push(table);
    }
    assertEmptyDemoDatabase(identity, tables, populated);
    await client.query("COMMIT");
  } finally { await client.end().catch(() => {}); }

  // Refuse linked ancestors and reserve private credentials before any bootstrap write.
  const root = dirname(app);
  let current = root;
  for (const segment of relative(root, output).split(sep)) {
    current = resolve(current, segment);
    if (existsSync(current) && (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())) throw Error("Private demo output must use regular project directories");
    if (existsSync(current) && relative(realpathSync(root), realpathSync(current)).startsWith("..")) throw Error("Private demo output escaped the project");
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const bundle = resolve(output, `demo-hospital-${randomUUID()}.mjs`);
  const compiled = await build({ entryPoints: [resolve(app, "scripts/demo-hospital.ts")], outfile: bundle, write: false, bundle: true, platform: "node", format: "esm", packages: "external", tsconfig: resolve(app, "tsconfig.json"), logLevel: "silent", plugins: [{
    name: "standalone-demo-runtime", setup(b) {
      b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: pathToFileURL(resolve(app, "node_modules/next/headers.js")).href, external: true }));
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
    },
  }] });
  writeFileSync(bundle, compiled.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  const password = randomBytes(24).toString("base64url");
  writeFileSync(credentials, ["PRIVATE fictional clone demo logins. Never commit or share this file publicly.", "Email or role: admin, admission, nurse, billing, pharmacy, insurance", "Legacy historical roles: doctor, lab", `Password: ${password}`, "Use only with this local fictional installation.", ""].join("\n"), { flag: "wx", mode: 0o600 });
  const { seedDemoHospital } = await import(pathToFileURL(bundle).href);
  const summary = await seedDemoHospital(password);
  writeFileSync(resolve(output, "clone-demo-summary.json"), JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
  console.log(`Created ${summary.hospital}: ${summary.counts.beds} beds, ${summary.counts.patients} fictional patients and fresh local staff accounts.`);
  console.log("Private generated logins: web/tmp/clone-demo-logins.txt. Scenario guide: docs/CLONE_DEMO.md. Existing installations must not run this command.");
}

try { await initialize(); process.exit(0); }
catch {
  // Driver, SQL, auth and bundler errors can contain credentials. Keep failures nonsecret.
  console.error("Demo initialization refused or failed. It requires a freshly migrated empty local database and no existing clone-demo login file. Existing data was not reset. Preserve any generated private login file and partial setup for review; never rerun against an existing hospital.");
  process.exit(1);
}
