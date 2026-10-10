import { describe, expect, it } from "vitest";
import { hospitalLocalInput, hospitalLocalInstant, formatHospitalTime } from "../../src/lib/hospital-time";

describe("hospital wall time rather than browser time", () => {
  it("round trips Kolkata midnight and exact milliseconds", () => {
    const instant = "2026-10-09T18:30:00.123Z";
    expect(hospitalLocalInput(instant, "Asia/Kolkata")).toBe("2026-10-10T00:00:00.123");
    expect(hospitalLocalInstant("2026-10-10T00:00:00.123", "Asia/Kolkata")).toBe(instant);
    expect(formatHospitalTime(instant, "Asia/Kolkata")).toContain("Asia/Kolkata");
  });
  it("rejects invalid dates, daylight-saving gaps and ambiguous folds", () => {
    for (const value of ["2026-02-30T10:00", "2026-03-08T02:30", "2026-11-01T01:30"])
      expect(() => hospitalLocalInstant(value, "America/New_York")).toThrow();
    expect(hospitalLocalInstant("2026-03-08T03:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(hospitalLocalInstant("2026-11-01T02:30", "America/New_York")).toBe("2026-11-01T07:30:00.000Z");
  });
});
