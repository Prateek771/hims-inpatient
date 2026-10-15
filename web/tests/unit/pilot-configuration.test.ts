import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, symlinkSync, unlinkSync, rmdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createLogger } from "@better-auth/core/env";
import { createStaffAuth } from "../../src/server/auth";
import { insuranceStorageDirectory } from "../../src/server/insurance/documents";
import { documentStorageDirectory } from "../../src/server/documents/commands";

afterEach(() => vi.unstubAllEnvs());
describe("explicit local-pilot authentication", () => {
  it("does not log provider query parameters or session credentials on authentication errors", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");vi.stubEnv("BETTER_AUTH_SECRET", "SyntheticPrivateSecretAtLeast32Characters");
    const output=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      const logger=createLogger(createStaffAuth().options.logger);
      logger.error("Failed query params: synthetic-private-session",{query:"select private authentication source",params:["synthetic-private-password"]});
      expect(output).toHaveBeenCalled();
      expect(JSON.stringify(output.mock.calls)).not.toContain("synthetic-private-session");expect(JSON.stringify(output.mock.calls)).not.toContain("synthetic-private-password");
    } finally {output.mockRestore();}
  });
  it.each([
    ["", "SyntheticPrivateSecretAtLeast32Characters"],
    ["http://hospital.example", "SyntheticPrivateSecretAtLeast32Characters"],
    ["http://localhost:3000", "short"],
    ["https://user:private-sentinel@hospital.example", "SyntheticPrivateSecretAtLeast32Characters"],
    ["http://localhost:3000/untrusted", "SyntheticPrivateSecretAtLeast32Characters"],
  ])("refuses absent or unsafe origin/secret without disclosing configuration", (origin, secret) => {
    vi.stubEnv("BETTER_AUTH_URL", origin); vi.stubEnv("BETTER_AUTH_SECRET", secret);
    expect(() => createStaffAuth()).toThrow("Authentication configuration unavailable");
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3100", "https://hospital.example"])("accepts an explicit loopback or HTTPS origin", origin => {
    vi.stubEnv("BETTER_AUTH_URL", origin); vi.stubEnv("BETTER_AUTH_SECRET", "SyntheticPrivateSecretAtLeast32Characters");
    expect(createStaffAuth().options.baseURL).toBe(origin);
  });
});
describe("server-owned recovery storage", () => {
  const id = "b9bc3b1b-a6d8-4a31-a159-6bfa327a5631";
  function synthetic() {
    vi.stubEnv("DATABASE_URL", "postgresql://hims_test_runtime:synthetic@127.0.0.1:55432/hims_test");
    vi.stubEnv("HIMS_INSURANCE_STORAGE", "synthetic"); vi.stubEnv("HIMS_DOCUMENT_STORAGE", "synthetic");
  }
  it("selects an independent server-computed namespace for both protected stores", () => {
    synthetic(); vi.stubEnv("HIMS_SYNTHETIC_RECOVERY_ID", id);
    expect(insuranceStorageDirectory()).toBe(resolve(process.cwd(), "../tmp/recovery", id, "storage/insurance"));
    expect(documentStorageDirectory()).toBe(resolve(process.cwd(), "../tmp/recovery", id, "storage/discharge"));
  });
  it.each(["../private-uploads", "C:\\outside", "", "b9bc3b1b-a6d8-4a31-a159-6bfa327a5631/other"])("refuses caller-like recovery paths", candidate => {
    synthetic(); vi.stubEnv("HIMS_SYNTHETIC_RECOVERY_ID", candidate);
    expect(insuranceStorageDirectory).toThrow(); expect(documentStorageDirectory).toThrow();
  });
  it("refuses recovery selection for the ordinary database", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://hims_runtime:synthetic@127.0.0.1:5432/hims_local");
    vi.stubEnv("HIMS_SYNTHETIC_RECOVERY_ID", id);
    expect(insuranceStorageDirectory).toThrow(); expect(documentStorageDirectory).toThrow();
  });
  it("refuses ordinary storage after a synthetic test's mutable environment was restored", () => {
    vi.stubEnv("HIMS_SYNTHETIC_TEST_RUN", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://hims_runtime:synthetic@127.0.0.1:5432/hims_local");
    vi.stubEnv("HIMS_INSURANCE_STORAGE", undefined); vi.stubEnv("HIMS_DOCUMENT_STORAGE", undefined);
    expect(insuranceStorageDirectory).toThrow("Synthetic run cannot select ordinary storage");
    expect(documentStorageDirectory).toThrow("Synthetic run cannot select ordinary storage");
  });
  it("rejects a dangling linked namespace before any private file write", () => {
    synthetic(); const token = randomUUID(); vi.stubEnv("HIMS_SYNTHETIC_RECOVERY_ID", token);
    const root = resolve(process.cwd(), "../tmp/recovery"), link = resolve(root, token);
    const target = resolve(root, `${token}-absent`);
    mkdirSync(target, { recursive: true }); symlinkSync(target, link, "junction"); rmdirSync(target);
    try { expect(insuranceStorageDirectory).toThrow(); expect(documentStorageDirectory).toThrow(); }
    finally { unlinkSync(link); }
  });
});
