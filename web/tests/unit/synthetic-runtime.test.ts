import { expect, it, vi, afterEach } from "vitest";
import { assertSyntheticRuntime } from "../../src/server/synthetic-runtime";
afterEach(() => vi.unstubAllEnvs());
it("permits ordinary configuration only outside a synthetic runner", () => {
  vi.stubEnv("HIMS_SYNTHETIC_TEST_RUN", undefined);
  expect(() => assertSyntheticRuntime("postgresql://hims_runtime:private@127.0.0.1/hims_local")).not.toThrow();
});
it("permits the limited loopback synthetic runtime", () => {
  vi.stubEnv("HIMS_SYNTHETIC_TEST_RUN", "1");
  expect(() => assertSyntheticRuntime("postgresql://hims_test_runtime:synthetic@127.0.0.1/hims_test")).not.toThrow();
});
it.each(["postgresql://hims_runtime:sentinel-private@127.0.0.1/hims_local", "postgresql://hims_test_owner:sentinel-private@127.0.0.1/hims_test", "postgresql://hims_test_runtime:sentinel-private@remote.invalid/hims_test", "postgresql://sentinel-private@["])("refuses ordinary, owner, remote and malformed runtime without disclosure", url => {
  vi.stubEnv("HIMS_SYNTHETIC_TEST_RUN", "1");
  expect(() => assertSyntheticRuntime(url)).toThrow("Synthetic runtime requires the dedicated database");
  try { assertSyntheticRuntime(url); } catch (error) { expect(String(error)).not.toContain("sentinel-private"); }
});
