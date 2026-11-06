import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "../../src/server/cron-auth";

const secret = "a".repeat(40);

describe("scheduled job authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isCronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isCronAuthorized(`Bearer ${"b".repeat(40)}`, secret)).toBe(false);
    expect(isCronAuthorized(secret, secret)).toBe(false);
    expect(isCronAuthorized(null, secret)).toBe(false);
  });
  it("is disabled when the secret is absent or short", () => {
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
  });
});
