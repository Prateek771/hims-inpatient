import { afterEach, expect, it } from "vitest";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { withTestDatabase, type TestClient } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { GET } from "../../src/app/api/health/ready/route";
import { assertCoreReadiness } from "../../src/server/readiness";
loadLocalEnvironment();
const original = { DATABASE_URL: process.env.DATABASE_URL };
afterEach(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function synthetic() { process.env.DATABASE_URL = getTestDatabaseConfig().runtimeUrl; }
/** These tests change the schema or grants, so the next test must rebuild the database instead of reusing it. */
const dirty = (owner: TestClient) => owner.query("delete from hims_migrations");
const unavailable = async () => { const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" }); };

it("reports ready with no-store caching on a complete schema", async () => withTestDatabase(async () => {
  synthetic(); await assertCoreReadiness();
  const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ready" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}));
it("reports unavailable when a late required document table is missing", async () => withTestDatabase(async ({ owner }) => {
  try { synthetic(); await owner.query("alter table discharge_documents rename to synthetic_missing_document_table"); await unavailable(); }
  finally { await dirty(owner); }
}));
it("reports unavailable when an integrity trigger is missing", async () => withTestDatabase(async ({ owner }) => {
  try { synthetic(); await owner.query("drop trigger append_only_audit_events_upd"); await unavailable(); }
  finally { await dirty(owner); }
}));
it("reports unavailable when an integrity function is missing", async () => withTestDatabase(async ({ owner }) => {
  try { synthetic(); await owner.query("drop function mvp_assigned"); await unavailable(); }
  finally { await dirty(owner); }
}));
it("reports unavailable when the runtime cannot record actual money", async () => withTestDatabase(async ({ owner, runtime }) => {
  // The account host differs between a local install (127.0.0.1) and CI (any host), so take it from the live connection.
  const [name, host] = String((await runtime.query("select current_user() u")).rows[0].u).split("@");
  const account = `'${name}'@'${host}'`;
  try {
    synthetic();
    await owner.query(`revoke insert on hims_test.* from ${account}`);
    await unavailable();
  } finally { await owner.query(`grant select, insert, update, delete, execute on hims_test.* to ${account}`); await dirty(owner); }
}));
