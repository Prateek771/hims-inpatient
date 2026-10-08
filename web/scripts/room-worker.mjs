import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Running this explicit entry authorizes ledger reconciliation on the configured application database.
try {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  mkdirSync(resolve("tmp"), { recursive: true });
  const output = resolve("tmp/room-worker.mjs");
  await build({ entryPoints: ["src/server/billing/worker-entry.ts"], outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [{ name: "server-only-worker", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" })); b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" })); b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: pathToFileURL(resolve("node_modules/next/headers.js")).href, external: true })); } }] });
  const child = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { env: process.env, stdio: "inherit" });
  process.exitCode = child.status ?? 1;
} catch {
  console.error("Room worker could not start. No credentials or database details logged.");
  process.exitCode = 1;
}
