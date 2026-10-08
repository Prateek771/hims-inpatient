import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = resolve(appRoot, "../tmp/vitest");
mkdirSync(temporaryDirectory, { recursive: true });
const vitestRoot = dirname(require.resolve("vitest/package.json"));
const result = spawnSync(process.execPath, [resolve(vitestRoot, "vitest.mjs"), ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, TEMP: temporaryDirectory, TMP: temporaryDirectory, TMPDIR: temporaryDirectory },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
