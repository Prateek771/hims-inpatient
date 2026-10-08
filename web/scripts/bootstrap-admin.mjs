import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

async function initialize() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (process.argv.includes("--demo")) {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (
      !["localhost", "127.0.0.1"].includes(target.hostname) ||
      target.pathname !== "/hims_local" ||
      decodeURIComponent(target.username) !== "hims_runtime"
    )
      throw new Error("Unsupported demo target");
    process.env.HIMS_BOOTSTRAP_DEMO = "true";
  }
  const output = resolve("tmp/bootstrap-admin.mjs");
  mkdirSync(resolve("tmp"), { recursive: true });
  await build({
    entryPoints: ["src/server/bootstrap-entry.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "server-only-cli",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "empty",
          }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
            contents: "",
          }));
        },
      },
    ],
  });
  const result = spawnSync(process.execPath, [output], {
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Initialization refused");
  console.log("Staff initialization completed");
}
try {
  await initialize();
} catch {
  // Library/URL errors can contain connection strings. Never forward their text or causes.
  console.error(
    "Administrator initialization refused or failed. No credential values logged.",
  );
  process.exitCode = 1;
}
