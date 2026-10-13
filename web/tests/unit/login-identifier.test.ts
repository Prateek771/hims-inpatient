import { describe, expect, it } from "vitest";
import { loginEmail } from "../../src/components/login-identifier";

describe("local demo login identifiers", () => {
  it.each(["admin", "admission", "doctor", "nurse", "pharmacy", "lab", "insurance", "billing"])("allows the one-word %s login", (role) => {
    expect(loginEmail(role)).toBe(`${role}@hims.test`);
  });
  it("accepts capitalized role names with surrounding spaces", () => {
    expect(loginEmail("  Nurse  ")).toBe("nurse@hims.test");
  });
  it("preserves ordinary emails and never invents an account for an unknown role", () => {
    expect(loginEmail("  person@hospital.example  ")).toBe("person@hospital.example");
    expect(loginEmail("superadmin")).toBe("superadmin");
  });
});
