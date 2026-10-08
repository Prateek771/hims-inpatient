import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
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
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_SECRET: "SyntheticE2EOnlySecretAtLeast32Characters12345",
    },
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error("Synthetic auth fixture preparation failed");
}
