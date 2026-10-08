import { expect, it } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
it("bundled room worker import has no database or polling side effect", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  await mkdir(resolve(root, "tmp"), { recursive: true });
  const directory = await mkdtemp(resolve(root, "tmp/room-worker-import-"));
  try {
    const output = resolve(directory, "probe.mjs");
    await build({
      stdin: { contents: "import { postDueRoomCharges } from './src/server/billing/room-worker'; if(typeof postDueRoomCharges!=='function') throw Error('Missing job'); console.log('IMPORT_ONLY');", resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "server-only-test", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" })); b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" })); b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: pathToFileURL(resolve(root, "node_modules/next/headers.js")).href, external: true })); } }]
    });
    const result = spawnSync(process.execPath, [output], {
      cwd: root, env: { ...process.env, DATABASE_URL: "postgresql://hims_test_runtime:synthetic@127.0.0.1:1/hims_test" }, encoding: "utf8", timeout: 10000
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("IMPORT_ONLY");
  }
  finally {
    await rm(directory, { recursive: true, force: true });
  }
});
