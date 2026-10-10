import { expect, it } from "vitest";
import { withTestDatabase, waitForTestDatabaseIdle } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { protectedStorageDirectory } from "../../src/server/protected-storage";
loadLocalEnvironment();
it("drains an unfinished actual database callback before restoring its synthetic storage environment", async () => {
  const original = { DATABASE_URL: process.env.DATABASE_URL, HIMS_DOCUMENT_STORAGE: process.env.HIMS_DOCUMENT_STORAGE };
  const target = getTestDatabaseConfig();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }), gate = new Promise<void>(done => { release = done; });
  let cleanupFinished = false, observed: string | undefined;
  const pending = withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = target.runtimeUrl; process.env.HIMS_DOCUMENT_STORAGE = "synthetic";
    enter(); await gate;
    expect((await runtime.query("select current_database() name,current_user role")).rows[0]).toEqual({ name: target.databaseName, role: "hims_test_runtime" });
    observed = protectedStorageDirectory("discharge");
  });
  try {
    await entered;
    const cleanup = waitForTestDatabaseIdle().then(() => { cleanupFinished = true; });
    await Promise.resolve(); expect(cleanupFinished).toBe(false);
    release(); await pending; await cleanup;
    expect(cleanupFinished).toBe(true); expect(observed).toContain("document-test-storage");
  } finally {
    release(); await pending.catch(() => {});
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
