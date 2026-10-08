function target(value: string) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash) throw new Error();
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ? "loopback" : url.hostname.toLowerCase();
    return { host, port: url.port || "5432", name: decodeURIComponent(url.pathname.slice(1)), role: decodeURIComponent(url.username) };
  } catch {
    // URL errors carry their original credential-bearing input. Never retain it.
    throw new Error("Invalid PostgreSQL test URL");
  }
}

/** No application credential fallback; explicit synthetic database names only. */
export function assertTestDatabase(testUrl: string, appUrl?: string) {
  const test = target(testUrl);
  const allowed = test.name === "hims_test" || (process.env.CI === "true" && /^hims_test_ci_[a-z0-9]{8,40}$/.test(test.name));
  if (!allowed || test.role !== "hims_test_owner") throw new Error("Refusing to reset a non-test database");
  if (appUrl) {
    const app = target(appUrl);
    if (app.name === test.name && app.port === test.port && app.host === test.host) throw new Error("Test database is the application database");
  }
}

export function assertTestDatabasePair(ownerUrl: string, runtimeUrl: string, appUrl?: string) {
  assertTestDatabase(ownerUrl, appUrl);
  const ownerTarget = target(ownerUrl);
  const runtimeTarget = target(runtimeUrl);
  if (runtimeTarget.name !== ownerTarget.name || runtimeTarget.host !== ownerTarget.host || runtimeTarget.port !== ownerTarget.port || runtimeTarget.role !== "hims_test_runtime") throw new Error("Test runtime must use the same dedicated test database");
}

/** Caller loads the authorized local environment; pure guards also work in Playwright's CJS config loader. */
export function getTestDatabaseConfig() {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
  if (!ownerUrl || !runtimeUrl) throw new Error("Dedicated TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required");
  assertTestDatabasePair(ownerUrl, runtimeUrl, process.env.DATABASE_URL);
  return { ownerUrl, runtimeUrl, databaseName: target(ownerUrl).name };
}
