import { expect, it } from "vitest";
import {
  orderInput,
  scheduledTimes,
  observationValues,
} from "../../src/server/clinical/input";

it("requires explicit bounded clinician schedules and independent medicine dispensing units", () => {
  const base = {
    kind: "MEDICINE",
    requestedItem: "Synthetic medicine",
    medicationPurpose: "WARD",
    dose: "5",
    doseUnit: "mg",
    route: "oral",
    frequency: "Clinician entered",
    durationDays: 2,
    schedule: {
      startsAt: "2026-10-09T00:00:00.123Z",
      intervalMinutes: 60,
      occurrences: 3,
    },
  };
  expect(scheduledTimes(orderInput.parse(base).schedule!)).toEqual([
    "2026-10-09T00:00:00.123Z",
    "2026-10-09T01:00:00.123Z",
    "2026-10-09T02:00:00.123Z",
  ]);
  expect(orderInput.safeParse({ ...base, schedule: undefined }).success).toBe(
    false,
  );
  expect(
    orderInput.safeParse({ ...base, medicationPurpose: "BOTH" }).success,
  ).toBe(false);
  expect(
    orderInput.safeParse({
      ...base,
      medicationPurpose: "BOTH",
      dispensingQuantity: "6",
      dispensingUnit: "tablet",
    }).success,
  ).toBe(true);
  expect(
    orderInput.safeParse({
      ...base,
      schedule: { ...base.schedule, intervalMinutes: 0 },
    }).success,
  ).toBe(false);
  expect(
    orderInput.safeParse({
      ...base,
      schedule: { ...base.schedule, occurrences: 1001 },
    }).success,
  ).toBe(false);
  expect(
    orderInput.safeParse({ ...base, frequency: "PRN / as needed" }).success,
  ).toBe(false);
  expect(observationValues.safeParse({ spo2: 101 }).success).toBe(false);
  expect(observationValues.safeParse({}).success).toBe(false);
});

it("distinguishes home-only prescribing from ward administration schedules", () => {
  const home = {
    kind: "MEDICINE",
    requestedItem: "Synthetic medicine",
    medicationPurpose: "TAKE_HOME",
    dose: "5",
    doseUnit: "mg",
    route: "oral",
    frequency: "Clinician instructions",
    durationDays: 2,
    dispensingQuantity: "4",
    dispensingUnit: "tablet",
  };
  expect(orderInput.safeParse(home).success).toBe(true);
  expect(
    orderInput.safeParse({ ...home, medicationPurpose: "WARD" }).success,
  ).toBe(false);
  expect(
    orderInput.safeParse({ ...home, dispensingQuantity: undefined }).success,
  ).toBe(false);
});
