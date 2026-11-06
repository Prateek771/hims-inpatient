import { describe, expect, it } from "vitest";
import { assertDemoTarget, assertEmptyDemoDatabase } from "../../scripts/demo-hospital-guard";

const target = "mysql://hims_runtime:local-only@127.0.0.1:3306/hims_local";
const identity = { database: "hims_local", user: "hims_runtime@127.0.0.1" };
const required = ["staff_user", "staff_account", "staff_session", "staff_verification", "patients", "admissions", "hospital_settings", "setting_versions", "audit_events", "beds", "admission_counters"];

describe("fresh clone demo guard", () => {
  it("accepts a dedicated loopback runtime, including an isolated verification port", () => {
    expect(assertDemoTarget(target.replace("3306", "55441")).port).toBe("55441");
    expect(assertDemoTarget(target.replace("127.0.0.1", "[::1]")).hostname).toBe("[::1]");
  });
  it("accepts exactly the one remote host named for the hosted fictional demo", () => {
    const remote = "mysql://u1_demo:private@srv.example.invalid:3306/u1_demo";
    expect(assertDemoTarget(remote, { HIMS_DEMO_REMOTE_HOST: "srv.example.invalid" }).hostname).toBe("srv.example.invalid");
    expect(() => assertDemoTarget(remote)).toThrow();
    expect(() => assertDemoTarget(remote, { HIMS_DEMO_REMOTE_HOST: "other.example.invalid" })).toThrow();
  });
  it.each([
    target.replace("127.0.0.1", "hospital.example"),
    target.replace("hims_runtime", "root"),
    target.replace("hims_local", "hims_test"),
    target.replace("hims_runtime", "hims_test_runtime"),
    target + "?host=production.example",
    target + "#fragment",
    target.replace("mysql:", "https:"),
    target.replace("local-only", ""),
  ])("refuses an unsafe or overridden connection target", value => {
    expect(() => assertDemoTarget(value)).toThrow();
  });
  it("refuses a synthetic-test context", () => {
    expect(() => assertDemoTarget(target, { HIMS_SYNTHETIC_TEST_RUN: "1" })).toThrow();
    expect(() => assertDemoTarget(target, { HIMS_DOCUMENT_STORAGE: "synthetic" })).toThrow();
  });
  it("requires a complete empty schema under a named runtime identity", () => {
    expect(() => assertEmptyDemoDatabase(identity, required, [])).not.toThrow();
    expect(() => assertEmptyDemoDatabase(identity, [], [])).toThrow();
    expect(() => assertEmptyDemoDatabase({ ...identity, user: "root@localhost" }, required, [])).toThrow();
    expect(() => assertEmptyDemoDatabase({ ...identity, database: "" }, required, [])).toThrow();
  });
  it.each(["staff_user", "patients", "audit_events", "admission_counters", "future_hospital_table"])("rejects every populated operational table before initialization", table => {
    expect(() => assertEmptyDemoDatabase(identity, [...required, table], [table])).toThrow();
  });
});
