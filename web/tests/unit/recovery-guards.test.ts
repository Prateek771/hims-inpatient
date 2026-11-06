import { expect, it } from "vitest";
import { assertRecoveryTargets } from "../../scripts/recovery-guard";

const source = "mysql://hims_test_owner:synthetic@127.0.0.1:3306/hims_test";
const restore = source.replace(/\/hims_test$/, "/hims_test_restore_0a1b2c3d");

it("permits a uniquely named scratch database on the same loopback server", () => {
  expect(assertRecoveryTargets(source, restore)).toEqual({ source: "hims_test", restore: "hims_test_restore_0a1b2c3d" });
});
it.each([
  source,
  restore.replace("0a1b2c3d", "ZZ"),
  restore.replace(/hims_test_restore_0a1b2c3d$/, "hims_local"),
  restore.replace("127.0.0.1", "remote.invalid"),
  restore.replace(":3306", ":3307"),
  restore.replace("hims_test_owner", "hims_test_runtime"),
  restore + "?host=production.example",
  "mysql://sentinel-private-secret@[",
])("rejects equal, remote, ordinary, other-user and malformed targets without disclosure", (target) => {
  let caught: unknown;
  try { assertRecoveryTargets(source, target); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect(String(caught)).not.toContain("sentinel-private-secret");
});
it("refuses a source that is not the dedicated synthetic database", () => {
  expect(() => assertRecoveryTargets(source.replace(/\/hims_test$/, "/hims_local"), restore)).toThrow();
});
