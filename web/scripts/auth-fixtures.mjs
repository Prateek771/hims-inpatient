import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getTestDatabaseConfig } from "./test-database-guard.ts";
export async function prepareAuthFixtures() {
  const { runtimeUrl } = getTestDatabaseConfig();
  mkdirSync(resolve("tmp"), { recursive: true });
  const output = resolve("tmp/auth-fixtures.mjs");
  await build({
    entryPoints: ["tests/support/auth-fixture-entry.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "server-only-fixtures",
        setup(b) {
          // Standalone Node ESM needs the extension that Next's bundler normally resolves.
          b.onResolve({ filter: /^next\/headers$/ }, () => ({
            path: pathToFileURL(resolve("node_modules/next/headers.js")).href,
            external: true,
          }));
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
    env: {
      ...process.env,
      DATABASE_URL: runtimeUrl,
      HIMS_SYNTHETIC_TEST_RUN: "1",
      HIMS_INSURANCE_STORAGE: "synthetic",
      HIMS_DOCUMENT_STORAGE: "synthetic",
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_SECRET: "SyntheticE2EOnlySecretAtLeast32Characters12345",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    // Fixture diagnostics expose only error class/code, never SQL, URLs or credentials.
    const diagnostic = result.stderr
      .split("\n")
      .find((line) => line.startsWith('{"fixtureError":'));
    if (diagnostic) console.error(diagnostic);
    throw new Error("Synthetic auth fixture preparation failed");
  }
}
