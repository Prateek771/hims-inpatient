export function assertDemoTarget(value: string, environment: Record<string, string | undefined> = {}) {
  const target = new URL(value);
  if (!["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/hims_local" || decodeURIComponent(target.username) !== "hims_runtime" ||
    target.search || target.hash || !target.password ||
    ["HIMS_SYNTHETIC_TEST_RUN", "HIMS_SYNTHETIC_RECOVERY_ID", "HIMS_DOCUMENT_STORAGE", "HIMS_INSURANCE_STORAGE"].some(key => environment[key] !== undefined)) {
    throw new Error("Demo initialization requires a dedicated ordinary local runtime without connection overrides");
  }
  return target;
}

export function assertEmptyDemoDatabase(
  identity: { database: string; role: string; superuser: boolean; createDatabase: boolean; createRole: boolean; bypassRls: boolean },
  tables: string[], populated: string[],
) {
  const required = ["staff_user", "staff_account", "staff_session", "staff_verification", "patients", "admissions", "hospital_settings", "setting_versions", "audit_events", "beds", "admission_counters"];
  if (identity.database !== "hims_local" || identity.role !== "hims_runtime" ||
    [identity.superuser, identity.createDatabase, identity.createRole, identity.bypassRls].some(flag => flag !== false) ||
    !required.every(name => tables.includes(name)) || populated.length) {
    throw new Error("Demo initialization requires a complete empty database under its limited runtime account; existing installations are never reseeded");
  }
}
