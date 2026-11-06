import { describe, expect, it } from "vitest";
import { hospitalDayBounds } from "../../src/server/hospital-day";

describe("hospitalDayBounds", () => {
  it("bounds an Asia/Kolkata day (UTC+05:30) in UTC", () => {
    const [start, end] = hospitalDayBounds("2026-11-05", "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-11-04T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-05T18:30:00.000Z");
  });

  it("handles a daylight-saving day that is 23 hours long", () => {
    const [start, end] = hospitalDayBounds("2026-03-08", "America/New_York");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});
