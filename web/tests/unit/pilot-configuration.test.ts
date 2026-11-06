import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@better-auth/core/env";
import { createStaffAuth } from "../../src/server/auth";

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
