/** A test runner cannot silently redirect a late continuation into hospital data. */
export function assertSyntheticRuntime(connectionString: string) {
  if (process.env.HIMS_SYNTHETIC_TEST_RUN === undefined) return;
  try {
    const url = new URL(connectionString), name = decodeURIComponent(url.pathname.slice(1));
    if (process.env.HIMS_SYNTHETIC_TEST_RUN !== "1" || !["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || decodeURIComponent(url.username) !== "hims_test_runtime" || !(name === "hims_test" || (process.env.CI === "true" && /^hims_test_ci_[a-z0-9]{8,40}$/.test(name)))) throw new Error();
  } catch { throw new Error("Synthetic runtime requires the dedicated database"); }
}
