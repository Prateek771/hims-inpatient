import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
it("bootstrap refuses a malformed credential URL without disclosing its input", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/bootstrap-admin.mjs", "--demo"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://synthetic:DO_NOT_LOG_PASSWORD@[",
      },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("DO_NOT_LOG_PASSWORD");
  expect(result.stderr).toContain(
    "Administrator initialization refused or failed",
  );
});
