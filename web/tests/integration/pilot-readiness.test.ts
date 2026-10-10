import { afterEach, expect, it } from "vitest";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { prepareProtectedStorage } from "../../src/server/protected-storage";
import { GET } from "../../src/app/api/health/ready/route";
import { assertCoreReadiness } from "../../src/server/readiness";
loadLocalEnvironment();
const original = { DATABASE_URL: process.env.DATABASE_URL, HIMS_INSURANCE_STORAGE: process.env.HIMS_INSURANCE_STORAGE, HIMS_DOCUMENT_STORAGE: process.env.HIMS_DOCUMENT_STORAGE };
afterEach(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function synthetic() {
  process.env.DATABASE_URL = getTestDatabaseConfig().runtimeUrl;
  process.env.HIMS_INSURANCE_STORAGE = "synthetic"; process.env.HIMS_DOCUMENT_STORAGE = "synthetic";
  prepareProtectedStorage();
}
it("reports unavailable when a late required document table is missing", async () => withTestDatabase(async ({ owner }) => {
  synthetic(); await owner.query("alter table hims.discharge_documents rename to synthetic_missing_document_table");
  const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" });
}));
it("reports unavailable when the runtime cannot record actual money", async () => withTestDatabase(async ({ owner }) => {
  synthetic(); await owner.query("revoke insert on hims.receipts from hims_test_runtime");
  const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" });
}));
it("reports unavailable when a required admission update is missing", async () => withTestDatabase(async ({ owner }) => {
  synthetic(); await owner.query("revoke update on hims.admissions from hims_test_runtime; grant update(version,status,bill_revision) on hims.admissions to hims_test_runtime");
  const response = await GET(); expect(response.status).toBe(503);
}));
it("keeps core readiness independent of optional native paperwork setup", async () => withTestDatabase(async ({ owner }) => {
  synthetic(); await owner.query("drop schema hims_paperwork_checkpoints cascade");
  await assertCoreReadiness();
  const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ready" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}));
it("rejects forbidden destructive and immutable-history grants with minimal unavailable responses", async () => withTestDatabase(async ({ owner }) => {
  synthetic();
  for (const [table, privilege] of [["audit_events", "TRUNCATE"], ["charges", "DELETE"], ["clinical_orders", "UPDATE"], ["room_stays", "UPDATE(started_at)"]] as const) {
    await owner.query(`grant ${privilege} on hims.${table} to hims_test_runtime`);
    try {
      const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" });
    } finally { await owner.query(`revoke ${privilege} on hims.${table} from hims_test_runtime`); }
  }
  expect((await GET()).status).toBe(200);
}));
