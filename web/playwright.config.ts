import { defineConfig, devices } from "@playwright/test";
import { getTestDatabaseConfig } from "./scripts/test-database-guard";

const { runtimeUrl } = getTestDatabaseConfig();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: runtimeUrl, BETTER_AUTH_URL: "http://127.0.0.1:3100", BETTER_AUTH_SECRET: "SyntheticE2EOnlySecretAtLeast32Characters12345" },
  },
});
