import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { assertTestDatabase, assertTestDatabasePair } from "../../scripts/test-database";
import { assertHumanActor } from "../../src/server/contracts";

describe("destructive test database guard", () => {
  const url = "postgresql://hims_test_owner:synthetic@127.0.0.1:5432/hims_test";
  it("allows only the dedicated test database and owner", () => {
    expect(() => assertTestDatabase(url)).not.toThrow();
  });
  it.each([
    url.replace("/hims_test", "/hims_local"),
    url.replace("/hims_test", "/postgres"),
    url.replace("hims_test_owner", "postgres"),
    url.replace("/hims_test", "/hims_test_backup"),
  ])("refuses unsafe destinations without an app URL", (candidate) => {
    expect(() => assertTestDatabase(candidate)).toThrow();
  });
  it("refuses an app-equivalent URL even with another role", () => {
    expect(() => assertTestDatabase(url, url.replace("hims_test_owner", "hims_runtime"))).toThrow();
  });
  it("refuses localhost aliases of the app connection", () => {
    expect(() => assertTestDatabase(url, url.replace("127.0.0.1", "localhost"))).toThrow();
  });
  it("accepts a matching synthetic owner/runtime pair", () => {
    expect(() => assertTestDatabasePair(url, url.replace("hims_test_owner", "hims_test_runtime"))).not.toThrow();
  });
  it.each([
    url.replace("hims_test_owner", "hims_runtime"),
    url.replace("hims_test_owner", "hims_test_runtime").replace("/hims_test", "/hims_local"),
    url.replace("hims_test_owner", "hims_test_runtime").replace(":5432", ":5433"),
  ])("rejects a mismatched browser database pair", (runtimeUrl) => {
    expect(() => assertTestDatabasePair(url, runtimeUrl)).toThrow();
  });
  it.each([
    "postgresql://hims_test_owner:sentinel-private-password@[broken:5432/hims_test",
    "postgresql://hims_test_owner:sentinel-private-password@127.0.0.1:wrong/hims_test",
    "postgresql://hims_test_owner:sentinel-private-password@127.0.0.1:5432/%E0%A4%A",
  ])("sanitizes malformed URL diagnostics", (candidate) => {
    let caught: unknown;
    try {
      assertTestDatabase(candidate);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ message: "Invalid PostgreSQL test URL" });
    expect(inspect(caught)).not.toContain("sentinel-private-password");
    expect(JSON.stringify(caught)).not.toContain("sentinel-private-password");
    expect(caught).not.toHaveProperty("input");
    expect(caught).not.toHaveProperty("cause");
  });
});

describe("audit actor boundary", () => {
  it("allows a human actor", () => {
    expect(assertHumanActor({ actor: { type: "staff", staffId: "staff-1" }, source: "test", requestId: "request-1" }).staffId).toBe("staff-1");
  });
  it("rejects a system actor from human commands", () => {
    expect(() => assertHumanActor({ actor: { type: "system", systemId: "room-charge" }, source: "test", requestId: "request-1" })).toThrow();
  });
});
