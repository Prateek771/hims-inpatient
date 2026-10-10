import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { readFile, writeFile, readdir, lstat, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { build } from "esbuild";
import { Client } from "pg";
import { loadLocalEnvironment } from "./migrate.ts";
import { getTestDatabaseConfig } from "./test-database-guard.ts";
import { assertRecoveryTargets } from "./recovery-guard.ts";
import { assertProjectDirectory, protectedStorageDirectory } from "../src/server/protected-storage.ts";
const require = createRequire(import.meta.url), app = resolve(dirname(fileURLToPath(import.meta.url)), ".."), project = resolve(app, "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const binary = name => process.platform === "win32" ? resolve("C:/Program Files/PostgreSQL/18/bin", `${name}.exe`) : name;
const safeId = value => { assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)); return value; };
let phase = "guard";
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: app, windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024, ...(/pg_ctl(?:\.exe)?$/.test(executable) ? { stdio: "ignore" } : {}), ...options });
  if (result.error || result.status !== 0) {
    for (const line of (result.stderr?.toString() || "").split(/\r?\n/)) {
      try { const d = JSON.parse(line); if (/^[a-z-]+$/.test(d.stage) && /^[A-Za-z]+$/.test(d.recoveryVerificationError) && /^[A-Z0-9_]+$/.test(d.code)) console.error(JSON.stringify({ stage: d.stage, recoveryVerificationError: d.recoveryVerificationError, code: d.code })); } catch {}
    }
    throw new Error(`Recovery child command unavailable (${result.status ?? "SPAWN"})`);
  }
  return result.stdout;
}
function libpq(url) {
  const target = new URL(url);
  return { ...process.env, PGHOST: target.hostname, PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: decodeURIComponent(target.pathname.slice(1)), PGCONNECT_TIMEOUT: "5" };
}
function archiveCommand(name, url, container, args, input) {
  const env = libpq(url);
  if (container) {
    assert(process.env.CI === "true" && /^[a-f0-9]{12,64}$/.test(container));
    env.PGHOST = "127.0.0.1"; env.PGPORT = "5432";
    return command("docker", ["exec", "-i", ...["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGCONNECT_TIMEOUT"].flatMap(key => ["--env", key]), container, name, ...args], { env, input });
  }
  assert(command(binary(name), ["--version"]).toString().includes("18."));
  return command(binary(name), args, { env, input });
}
async function freePort() { const server = createServer(); await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); }); const port = server.address().port; await new Promise(ok => server.close(ok)); return port; }
async function connected(url) { const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 }); await client.connect(); return client; }
async function provision(adminUrl, port) {
  const admin = await connected(adminUrl), ownerPassword = randomBytes(32).toString("hex"), runtimePassword = randomBytes(32).toString("hex");
  try {
    const existing = await admin.query("select (select count(*) from pg_roles where rolname in ('hims_test_owner','hims_test_runtime')) roles,(select count(*) from pg_database where datname='hims_test') databases");
    assert.equal(existing.rows[0].roles, "0"); assert.equal(existing.rows[0].databases, "0");
    for (const [role, password] of [["hims_test_owner", ownerPassword], ["hims_test_runtime", runtimePassword]]) await admin.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);
    await admin.query("create database hims_test owner hims_test_owner"); await admin.query("revoke all on database hims_test from public; grant connect on database hims_test to hims_test_owner,hims_test_runtime");
    return { ownerUrl: `postgresql://hims_test_owner:${ownerPassword}@127.0.0.1:${port}/hims_test`, runtimeUrl: `postgresql://hims_test_runtime:${runtimePassword}@127.0.0.1:${port}/hims_test` };
  } finally { await admin.end(); }
}
async function tableEvidence(client) {
  const tables = (await client.query("select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('hims','hims_paperwork_checkpoints','public') order by n.nspname,c.relname")).rows;
  const evidence = [];
  for (const table of tables) {
    assert(/^[a-z_]+$/.test(table.schema) && /^[a-z0-9_]+$/.test(table.name));
    const rows = (await client.query(`select row_to_json(t)::text value from "${table.schema}"."${table.name}" t order by row_to_json(t)::text collate "C"`)).rows.map(row => row.value);
    evidence.push({ table: `${table.schema}.${table.name}`, rows: rows.length, sha256: hash(JSON.stringify(rows)) });
  }
  return evidence;
}
async function grantEvidence(client) {
  // pg_dump omits owner-only default ACLs. NULL represents acldefault, not no grants.
  const schema = (await client.query("select nspname name,coalesce(nspacl,acldefault('n',nspowner))::text acl from pg_namespace where nspname in ('hims','hims_paperwork_checkpoints','public') order by nspname")).rows;
  const relations = (await client.query("select n.nspname schema,c.relname name,coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::\"char\" else 'r'::\"char\" end,c.relowner))::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('hims','hims_paperwork_checkpoints','public') and c.relkind in ('r','p','v','m','S') order by n.nspname,c.relname")).rows;
  const columns = (await client.query("select n.nspname schema,c.relname name,a.attname column,a.attacl::text acl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('hims','hims_paperwork_checkpoints','public') and a.attacl is not null order by n.nspname,c.relname,a.attname")).rows;
  return { schema, relations, columns };
}
async function fileEvidence(client, sourceDirectories, targetDirectories) {
  const files = [];
  for (const [table, kind, extension, expectedHash] of [["insurance_documents", "insurance", ".bin", "sha256"], ["discharge_documents", "discharge", ".pdf", "pdf_hash"]]) {
    const records = (await client.query(`select storage_key,${expectedHash} expected_hash,size_bytes from hims.${table} order by storage_key`)).rows;
    for (const row of records) {
      const key = safeId(row.storage_key), file = `${key}${extension}`, source = resolve(sourceDirectories[kind], file), stat = await lstat(source), bytes = await readFile(source);
      assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(bytes.length, row.size_bytes); assert.equal(hash(bytes), row.expected_hash);
      await copyFile(source, resolve(targetDirectories[kind], file));
      if (kind === "discharge") {
        const sourceManifest = resolve(sourceDirectories[kind], `${key}.manifest.json`), manifestStat = await lstat(sourceManifest);
        assert(manifestStat.isFile() && !manifestStat.isSymbolicLink());
        const manifestBytes = await readFile(sourceManifest);
        await copyFile(sourceManifest, resolve(targetDirectories[kind], `${key}.manifest.json`));
        files.push({ kind, file: `${key}.manifest.json`, bytes: manifestBytes.length, sha256: hash(manifestBytes) });
      }
      files.push({ kind, file, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  assert(files.some(f => f.kind === "insurance") && files.some(f => f.kind === "discharge")); return files;
}
async function verifyHttp(folder, env, fixture) {
  const origin = "http://127.0.0.1:3100", server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3100"], { cwd: app, env, windowsHide: true, stdio: "ignore" });
  let started = false;
  try {
    for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw new Error("Restored HTTP server failed to start"); try { if ((await fetch(`${origin}/api/health`)).ok) { started = true; break; } } catch {} await new Promise(ok => setTimeout(ok, 500)); }
    assert(started); assert.equal((await fetch(`${origin}/api/health/ready`)).status, 200);
    async function login(role) {
      const response = await fetch(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: `${role}@e2e.fixture.invalid`, password: "SyntheticE2EOnly123!" }) }); assert.equal(response.status, 200);
      const cookies = response.headers.getSetCookie(); assert(cookies.some(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie))); assert(cookies.every(cookie => !/;\s*Secure/i.test(cookie)));
      return cookies.map(cookie => cookie.split(";")[0]).join("; ");
    }
    const cookie = await login("billing"), proofs = [];
    for (const e of [fixture.selfPay, fixture.insured]) for (const documentId of [e.originalDocumentId, e.amendedDocumentId]) {
      const response = await fetch(`${origin}/api/documents/${documentId}/pdf`, { headers: { cookie } }); assert.equal(response.status, 200); assert(response.headers.get("cache-control").includes("no-store"));
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      const verification = await fetch(`${origin}/documents/${documentId}/verify`, { headers: { cookie } }); assert.equal(verification.status, 200); const html = await verification.text(); assert(html.includes(hash(bytes))); assert(!html.includes("Whole-journey human diagnosis"));
      assert.equal((await fetch(`${origin}/api/documents/${documentId}/pdf`)).status, 401); proofs.push({ documentId, sha256: hash(bytes), verified: true });
    }
    const insuranceCookie = await login("insurance"), caseUrl = `${origin}/api/insurance/cases/${fixture.recovery.caseId}/documents?documentId=${fixture.recovery.documentId}`;
    const file = await fetch(caseUrl, { headers: { cookie: insuranceCookie } }); assert.equal(file.status, 200); assert(file.headers.get("content-security-policy").includes("sandbox"));
    assert(Buffer.from(await file.arrayBuffer()).toString().includes("Synthetic recovery protected case text"));
    const nurse = await login("nurse"); assert.equal((await fetch(caseUrl, { headers: { cookie: nurse } })).status, 403);
    await writeFile(resolve(folder, "http-verification.json"), JSON.stringify({ origin, pdfs: proofs, readiness: "ready", privateCaseFile: true, anonymousDenied: true, wrongRoleDenied: true, httpOnly: true, sameSite: "Lax", secureOnLoopbackHttp: false, immutableVerificationOriginRetained: origin }, null, 2), { mode: 0o600 });
  } finally {
    if (server.exitCode === null) { server.kill(); await new Promise(ok => { server.once("exit", ok); setTimeout(ok, 10000); }); }
  }
}

async function main() {
  loadLocalEnvironment(); process.chdir(app);
  const operation = process.argv[2];
  if (operation === "--cluster-start" || operation === "--cluster-stop") {
    assert(process.platform === "win32"); const id = safeId(process.argv[3]), folder = assertProjectDirectory(resolve(project, "tmp/recovery", id));
    const state = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8")); assert.equal(state.id, id); assert.equal(state.localCluster, true);
    const cluster = assertProjectDirectory(resolve(folder, "cluster")); assert(existsSync(resolve(cluster, "PG_VERSION"))); assert.equal(readFileSync(resolve(cluster, "PG_VERSION"), "utf8").trim(), "18");
    command(binary("pg_ctl"), operation === "--cluster-start" ? ["start", "-D", cluster, "-l", resolve(folder, "postgres.log"), "-w", "-t", "30", "-o", `-h 127.0.0.1 -p ${state.target.port} -c log_statement=none -c log_min_error_statement=panic`] : ["stop", "-D", cluster, "-m", "fast", "-w", "-t", "30"]);
    state.stopped = operation === "--cluster-stop"; writeFileSync(resolve(folder, "manifest.json"), JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`Owned synthetic recovery cluster ${operation === "--cluster-start" ? "started" : "stopped"}: ${id}`); return;
  }
  assert(operation === undefined);
  const source = getTestDatabaseConfig(), id = randomUUID(), folder = assertProjectDirectory(resolve(project, "tmp/recovery", id)); mkdirSync(folder, { recursive: true, mode: 0o700 });
  let clusterStarted = false, cluster, target, sourceClient, targetClient;
  const localCluster = process.platform === "win32" && process.env.CI !== "true";
  try {
    let port, adminUrl; phase = "cluster-provision";
    if (localCluster) {
      port = await freePort(); assert.notEqual(String(port), new URL(source.ownerUrl).port || "5432"); cluster = assertProjectDirectory(resolve(folder, "cluster"));
      const password = randomBytes(32).toString("hex"), passwordFile = resolve(folder, "bootstrap-password.private"); writeFileSync(passwordFile, password, { mode: 0o600, flag: "wx" });
      command(binary("initdb"), ["-D", cluster, "-U", "hims_recovery_bootstrap", "--pwfile", passwordFile, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
      command(binary("pg_ctl"), ["start", "-D", cluster, "-l", resolve(folder, "postgres.log"), "-w", "-t", "30", "-o", `-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic`]); clusterStarted = true;
      adminUrl = `postgresql://hims_recovery_bootstrap:${password}@127.0.0.1:${port}/postgres`;
    } else {
      assert(process.env.CI === "true" && process.env.HIMS_RECOVERY_ADMIN_PASSWORD); port = 55432; assert.notEqual(new URL(source.ownerUrl).port || "5432", String(port));
      adminUrl = `postgresql://postgres:${encodeURIComponent(process.env.HIMS_RECOVERY_ADMIN_PASSWORD)}@127.0.0.1:${port}/postgres`;
    }
    const identity = assertRecoveryTargets(source.ownerUrl, source.runtimeUrl, `postgresql://hims_test_owner:synthetic@127.0.0.1:${port}/hims_test`, `postgresql://hims_test_runtime:synthetic@127.0.0.1:${port}/hims_test`, process.env.DATABASE_URL);
    console.log("Recovery target is a distinct fresh synthetic loopback cluster.");
    target = await provision(adminUrl, port); writeFileSync(resolve(folder, "connection.private.json"), JSON.stringify({ ...target, id, port, cluster, origin: "http://127.0.0.1:3100" }), { mode: 0o600, flag: "wx" });
    assertRecoveryTargets(source.ownerUrl, source.runtimeUrl, target.ownerUrl, target.runtimeUrl, process.env.DATABASE_URL);
    targetClient = await connected(target.ownerUrl); assert.equal((await targetClient.query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('hims','hims_paperwork_checkpoints','public') and c.relkind in ('r','p','v','m')")).rows[0].count, "0");
    sourceClient = await connected(source.ownerUrl); const owner = (await sourceClient.query("select current_database() name,current_user role,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user")).rows[0]; assert.equal(owner.name, source.databaseName); assert.equal(owner.role, "hims_test_owner"); assert(!owner.rolsuper && !owner.rolcreatedb && !owner.rolcreaterole);
    phase = "source-snapshot";
    await sourceClient.query("select pg_advisory_lock(729104210)"); await sourceClient.query("begin isolation level repeatable read read only");
    const fixture = JSON.parse(readFileSync(resolve(app, "tmp/e2e-journey.json"), "utf8")); assert.equal((await sourceClient.query("select count(*) from hims.admissions where id=any($1::uuid[])", [[fixture.selfPay.admissionId, fixture.insured.admissionId, fixture.exceptional.admissionId, fixture.recovery.admissionId]])).rows[0].count, "4");
    const before = await tableEvidence(sourceClient), grants = await grantEvidence(sourceClient), sourceDirectories = {};
    for (const kind of ["insurance", "discharge"]) { process.env[kind === "insurance" ? "HIMS_INSURANCE_STORAGE" : "HIMS_DOCUMENT_STORAGE"] = "synthetic"; const original = process.env.DATABASE_URL; process.env.DATABASE_URL = source.runtimeUrl; sourceDirectories[kind] = protectedStorageDirectory(kind); process.env.DATABASE_URL = original; }
    const targetDirectories = { insurance: assertProjectDirectory(resolve(folder, "storage/insurance")), discharge: assertProjectDirectory(resolve(folder, "storage/discharge")) }; for (const path of Object.values(targetDirectories)) mkdirSync(path, { recursive: true, mode: 0o700 });
    const snapshot = (await sourceClient.query("select pg_export_snapshot() snapshot")).rows[0].snapshot;
    console.log("Backing up one quiescent synthetic database snapshot and its verified protected files."); phase = "archive";
    const dump = archiveCommand("pg_dump", source.ownerUrl, process.env.HIMS_POSTGRES_SOURCE_CONTAINER, ["--format=custom", "--no-password", `--snapshot=${snapshot}`]); writeFileSync(resolve(folder, "synthetic.dump"), dump, { mode: 0o600, flag: "wx" });
    const files = await fileEvidence(sourceClient, sourceDirectories, targetDirectories); await writeFile(resolve(folder, "journey.json"), JSON.stringify(fixture, null, 2), { mode: 0o600 });
    archiveCommand("pg_restore", target.ownerUrl, process.env.HIMS_POSTGRES_RECOVERY_CONTAINER, ["--dbname=hims_test", "--no-password", "--no-owner", "--single-transaction", "--exit-on-error"], dump);
    const restored = await tableEvidence(targetClient), restoredGrants = await grantEvidence(targetClient);
    await writeFile(resolve(folder, "restore-comparison.json"), JSON.stringify({ rowHashesEqual: JSON.stringify(restored) === JSON.stringify(before), grantsEqual: JSON.stringify(restoredGrants) === JSON.stringify(grants), differingTables: before.filter((t, i) => JSON.stringify(t) !== JSON.stringify(restored[i])).map(t => t.table), sourceGrants: grants, targetGrants: restoredGrants }, null, 2), { mode: 0o600 });
    phase = "restored-row-comparison"; assert.deepEqual(restored, before);
    phase = "restored-grant-comparison"; assert.deepEqual(restoredGrants, grants);
    phase = "restored-protected-files"; for (const file of files) assert.equal(hash(await readFile(resolve(targetDirectories[file.kind], file.file))), file.sha256);
    phase = "restored-checkpoint-versions"; const versions = (await targetClient.query("select v from hims_paperwork_checkpoints.checkpoint_migrations order by v")).rows.map(row => row.v); assert.deepEqual(versions, [0, 1, 2, 3, 4]);
    phase = "restored-migration-inventory";
    const migrationRows = (await targetClient.query("select name,checksum from public.hims_migrations order by name")).rows;
    const expectedMigrations = (await readdir(resolve(app, "drizzle"))).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    assert.deepEqual(migrationRows.map(row => row.name), expectedMigrations);
    for (const row of migrationRows) assert.equal(hash(await readFile(resolve(app, "drizzle", row.name))), row.checksum);
    const runtime = await connected(target.runtimeUrl); try { const flags = (await runtime.query("select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,has_schema_privilege(current_user,'hims','CREATE') create_schema,has_table_privilege(current_user,'hims_paperwork_checkpoints.checkpoint_blobs','UPDATE') blob_update,has_table_privilege(current_user,'hims_paperwork_checkpoints.checkpoints','DELETE') checkpoint_delete from pg_roles where rolname=current_user")).rows[0]; assert(Object.values(flags).every(value => value === false)); } finally { await runtime.end(); }
    await sourceClient.query("commit"); assert.deepEqual(await tableEvidence(sourceClient), before);
    const manifest = { id, createdAt: new Date().toISOString(), localCluster, ...identity, originalVerificationOrigin: "http://127.0.0.1:3100", tables: before, grants: { sha256: hash(JSON.stringify(grants)), exact: true }, files, dump: { bytes: dump.length, sha256: hash(dump) }, migrations: migrationRows.length, checkpointVersions: versions, exactRowsPreserved: true, sourceUnchanged: true, privateConnectionFile: "connection.private.json", stopped: false };
    writeFileSync(resolve(folder, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const env = { ...process.env, DATABASE_URL: target.runtimeUrl, BETTER_AUTH_URL: "http://127.0.0.1:3100", BETTER_AUTH_SECRET: "SyntheticE2EOnlySecretAtLeast32Characters12345", HIMS_INSURANCE_STORAGE: "synthetic", HIMS_DOCUMENT_STORAGE: "synthetic", HIMS_SYNTHETIC_RECOVERY_ID: id, HIMS_RECOVERY_EVIDENCE_DIRECTORY: folder, NEXT_TELEMETRY_DISABLED: "1" };
    env.HIMS_SYNTHETIC_TEST_RUN = "1";
    phase = "restored-http"; await verifyHttp(folder, env, fixture);
    const verifier = resolve(app, "tmp", `recovery-${id}-verify.mjs`);
    await build({ entryPoints: [resolve(app, "tests/support/restored-verification-entry.ts")], outfile: verifier, bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "server-only-recovery", setup(b) { b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: pathToFileURL(resolve(app, "node_modules/next/headers.js")).href, external: true })); b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" })); b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" })); } }] });
    phase = "restored-commands"; command(process.execPath, [verifier], { env }); assert.deepEqual(await tableEvidence(sourceClient), before);
    const proofs = JSON.parse(readFileSync(resolve(folder, "command-verification.json"), "utf8")); const http = JSON.parse(readFileSync(resolve(folder, "http-verification.json"), "utf8")); for (const pdf of http.pdfs) assert.equal(proofs.pdfHashes[pdf.documentId], pdf.sha256);
    await writeFile(resolve(project, "tmp/task16-recovery-latest.json"), JSON.stringify({ id, manifest: `tmp/recovery/${id}/manifest.json`, commandVerification: `tmp/recovery/${id}/command-verification.json`, httpVerification: `tmp/recovery/${id}/http-verification.json` }, null, 2), { mode: 0o600 });
    console.log(`Recovery verified: ${before.length} tables, ${before.reduce((n, t) => n + t.rows, 0)} exact rows, ${files.length} protected files; current human review resumed once. Evidence: tmp/recovery/${id}/manifest.json`);
  } finally {
    await sourceClient?.query("rollback").catch(() => {}); await sourceClient?.query("select pg_advisory_unlock(729104210)").catch(() => {}); await sourceClient?.end().catch(() => {}); await targetClient?.end().catch(() => {});
    if (clusterStarted) {
      command(binary("pg_ctl"), ["stop", "-D", cluster, "-m", "fast", "-w", "-t", "30"]);
      const manifestPath = resolve(folder, "manifest.json"); if (existsSync(manifestPath)) { const saved = JSON.parse(readFileSync(manifestPath, "utf8")); saved.stopped = true; writeFileSync(manifestPath, JSON.stringify(saved, null, 2), { mode: 0o600 }); }
    }
  }
}
main().catch(error => { console.error(JSON.stringify({ phase, recoveryError: error.name, code: /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "UNAVAILABLE" })); process.exitCode = 1; });
