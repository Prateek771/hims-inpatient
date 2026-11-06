import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

it("checkpointer helper imports without connecting or automatically running migrations", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const helper = pathToFileURL(resolve(root, "scripts/paperwork-checkpointer.ts")).href;
  const unreachable = "mysql://hims_test_owner:synthetic@127.0.0.1:1/hims_test";
  const script = `import { setupPaperworkCheckpointer, verifyPaperworkCheckpointer, EXPECTED_CHECKPOINT_VERSIONS } from ${JSON.stringify(helper)};
    if (typeof setupPaperworkCheckpointer !== "function" || typeof verifyPaperworkCheckpointer !== "function" || EXPECTED_CHECKPOINT_VERSIONS.join() !== "0,1,2,3,4") throw new Error("unexpected exports");
    console.log("IMPORT_ONLY");`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, MIGRATION_DATABASE_URL: unreachable, DATABASE_URL: unreachable },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("IMPORT_ONLY");
});
