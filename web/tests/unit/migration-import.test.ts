import { expect, it } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

it("importing migration helpers directly or in an entry bundle never invokes the CLI", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const temporaryRoot = resolve(root, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(resolve(temporaryRoot, "migration-import-"));
  const helper = pathToFileURL(resolve(root, "scripts/migrate.ts")).href;
  // Explicit unusable synthetic connections prevent access to ordinary credentials,
  // even while exercising the old bundled main-module guard.
  const invalidUrl =
    "postgresql://hims_test_owner:synthetic@127.0.0.1:1/hims_test";
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: invalidUrl,
    DATABASE_URL: invalidUrl,
    TEST_DATABASE_URL: invalidUrl,
    TEST_RUNTIME_DATABASE_URL: invalidUrl,
  };
  const assertion =
    "if (typeof loadLocalEnvironment !== 'function' || typeof migrate !== 'function') throw new Error('Missing helpers'); console.log('IMPORT_ONLY');";
  try {
    const direct = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { loadLocalEnvironment, migrate } from ${JSON.stringify(helper)}; ${assertion}`,
      ],
      { cwd: root, env, encoding: "utf8" },
    );
    expect(direct.status).toBe(0);
    expect(direct.stdout.trim()).toBe("IMPORT_ONLY");
    const output = resolve(directory, "probe.mjs");
    await build({
      stdin: {
        contents: `import { loadLocalEnvironment, migrate } from './scripts/migrate.ts'; ${assertion}`,
        resolveDir: root,
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const bundled = spawnSync(process.execPath, [output], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    expect(bundled.status, bundled.stderr).toBe(0);
    expect(bundled.stdout.trim()).toBe("IMPORT_ONLY");
    expect(bundled.stderr).not.toContain("HIMS migration");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
