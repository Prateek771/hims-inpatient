import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[2] === "test") {
  const { prepareTestDatabase } = await import("./test-database.ts");
  await prepareTestDatabase();
}
const result = spawnSync(
  process.execPath,
  [require.resolve("@playwright/test/cli"), ...process.argv.slice(2)],
  {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      PLAYWRIGHT_BROWSERS_PATH: resolve(appRoot, "../tmp/playwright-browsers"),
    },
  },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
