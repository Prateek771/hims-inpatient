const loopback = ["localhost", "127.0.0.1", "[::1]"];
const refusedEnvironment = ["HIMS_SYNTHETIC_TEST_RUN", "HIMS_SYNTHETIC_RECOVERY_ID", "HIMS_DOCUMENT_STORAGE", "HIMS_INSURANCE_STORAGE"];

/**
 * The demo seeder only ever targets one explicitly named database: a loopback runtime, or (for the hosted fictional
 * demo) the single remote host named in HIMS_DEMO_REMOTE_HOST. Test databases and administrative users are refused.
 */
export function assertDemoTarget(value: string, environment: Record<string, string | undefined> = {}) {
  const target = new URL(value);
  const remoteHost = environment.HIMS_DEMO_REMOTE_HOST?.toLowerCase();
  const user = decodeURIComponent(target.username);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!["mysql:", "mariadb:"].includes(target.protocol) ||
    !(loopback.includes(target.hostname) || (remoteHost && target.hostname.toLowerCase() === remoteHost)) ||
    !database || database.startsWith("hims_test") || !user || user === "root" || user.startsWith("hims_test") ||
    target.search || target.hash || !target.password ||
    refusedEnvironment.some(key => environment[key] !== undefined)) {
    throw new Error("Demo initialization requires a dedicated ordinary runtime without connection overrides");
  }
  return target;
}

const required = ["staff_user", "staff_account", "staff_session", "staff_verification", "patients", "admissions", "hospital_settings", "setting_versions", "audit_events", "beds", "admission_counters"];

export function assertEmptyDemoDatabase(identity: { database: string; user: string }, tables: string[], populated: string[]) {
  if (!identity.database || !identity.user || identity.user.startsWith("root@") ||
    !required.every(name => tables.includes(name)) || populated.length) {
    throw new Error("Demo initialization requires a complete empty database under its runtime account; existing installations are never reseeded");
  }
}
