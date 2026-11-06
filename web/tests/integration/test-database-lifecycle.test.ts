import { expect, it } from "vitest";
import { withTestDatabase, waitForTestDatabaseIdle } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
loadLocalEnvironment();
it("drains an unfinished actual database callback before restoring its mutable test environment", async () => {
  const original = { DATABASE_URL: process.env.DATABASE_URL };
  const target = getTestDatabaseConfig();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }), gate = new Promise<void>(done => { release = done; });
  let cleanupFinished = false, observed: string | undefined;
  const pending = withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = target.runtimeUrl;
    enter(); await gate;
    expect((await runtime.query("select database() name, substring_index(user(), '@', 1) role")).rows[0]).toEqual({ name: target.databaseName, role: "hims_test_runtime" });
    observed = process.env.DATABASE_URL;
  });
  try {
    await entered;
    const cleanup = waitForTestDatabaseIdle().then(() => { cleanupFinished = true; });
    await Promise.resolve(); expect(cleanupFinished).toBe(false);
    release(); await pending; await cleanup;
    expect(cleanupFinished).toBe(true); expect(observed).toBe(target.runtimeUrl);
  } finally {
    release(); await pending.catch(() => {});
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
