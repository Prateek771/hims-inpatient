import { expect, it, vi } from "vitest";
import { assertRecoveryTargets } from "../../scripts/recovery-guard";
const source = "postgresql://hims_test_owner:synthetic@127.0.0.1:5432/hims_test";
const runtime = (url: string) => url.replace("hims_test_owner", "hims_test_runtime");
it("permits the same guarded identity only on a distinct loopback cluster", () => {
  expect(() => assertRecoveryTargets(source, runtime(source), source.replace("5432", "55432"), runtime(source.replace("5432", "55432")))).not.toThrow();
});
it("rejects another synthetic database on the same cluster", () => {
  vi.stubEnv("CI", "true");
  try {
    const target = source.replace(/\/hims_test$/, "/hims_test_ci_12345678");
    expect(() => assertRecoveryTargets(source, runtime(source), target, runtime(target))).toThrow("different clusters");
  } finally { vi.unstubAllEnvs(); }
});
it.each([source, source.replace("127.0.0.1", "localhost"), source.replace("127.0.0.1", "remote.invalid"), source.replace("/hims_test", "/hims_local"), "postgresql://sentinel-private-secret@["])("rejects equal, remote, ordinary and malformed recovery targets without disclosing input", target => {
  let caught: unknown; try { assertRecoveryTargets(source, runtime(source), target, runtime(target)); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error); expect(String(caught)).not.toContain("sentinel-private-secret");
});
