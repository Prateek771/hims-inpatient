import { describe, expect, it } from "vitest";
import { assertDemoTarget, assertEmptyDemoDatabase } from "../../scripts/demo-hospital-guard";

const target = "postgresql://hims_runtime:local-only@127.0.0.1:55441/hims_local";
const identity = { database: "hims_local", role: "hims_runtime", superuser: false, createDatabase: false, createRole: false, bypassRls: false };
const required = ["staff_user", "staff_account", "staff_session", "staff_verification", "patients", "admissions", "hospital_settings", "setting_versions", "audit_events", "beds", "admission_counters"];

describe("fresh clone demo guard", () => {
  it("accepts only a dedicated local runtime, including an isolated verification port", () => {
    expect(assertDemoTarget(target).port).toBe("55441");
    expect(assertDemoTarget(target.replace("127.0.0.1", "[::1]")).hostname).toBe("[::1]");
  });
  it.each([
    target.replace("127.0.0.1", "hospital.example"),
    target.replace("hims_runtime", "postgres"),
    target.replace("hims_local", "hims_test"),
    target + "?host=production.example",
    target + "#fragment",
    target.replace("postgresql:", "https:"),
  ])("refuses an unsafe or overridden connection target", value => {
    expect(() => assertDemoTarget(value)).toThrow();
  });
  it("refuses a synthetic-test context", () => {
    expect(() => assertDemoTarget(target, { HIMS_SYNTHETIC_TEST_RUN: "1" })).toThrow();
    expect(() => assertDemoTarget(target, { HIMS_DOCUMENT_STORAGE: "synthetic" })).toThrow();
  });
  it("requires complete empty schema under a limited runtime identity", () => {
    expect(() => assertEmptyDemoDatabase(identity, required, [])).not.toThrow();
    expect(() => assertEmptyDemoDatabase(identity, [], [])).toThrow();
    for (const field of ["superuser", "createDatabase", "createRole", "bypassRls"]) {
      expect(() => assertEmptyDemoDatabase({ ...identity, [field]: true }, required, [])).toThrow();
    }
    expect(() => assertEmptyDemoDatabase({ ...identity, database: "other" }, required, [])).toThrow();
  });
  it.each(["staff_user", "patients", "audit_events", "admission_counters", "future_hospital_table"])("rejects every populated operational table before initialization", table => {
    expect(() => assertEmptyDemoDatabase(identity, [...required, table], [table])).toThrow();
  });
});
