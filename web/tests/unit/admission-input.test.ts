import { describe, expect, it } from "vitest";
import {
  admissionInput,
  admissionYear,
} from "../../src/server/admissions/commands";

const sample = {
  patientDetails: {
    name: "Synthetic age-only patient",
    ageYearsAtRegistration: 54,
    sex: "UNKNOWN",
    phone: "9999999999",
  },
  admittingDoctorId: "synthetic-doctor",
  clinicianAssessment: {
    clinicianId: "synthetic-doctor",
    assessedAt: "2026-01-01T09:00:00Z",
    chiefComplaint: "Synthetic complaint",
    vitals: "Synthetic vitals",
    triage: "Clinician-selected",
    destinationCategory: "GENERAL",
  },
  bedId: "b5d6fe77-e80a-4be5-bc75-a862a478cfbc",
  paymentRoute: "SELF_PAY",
  expectedStayDays: 2,
  requestId: "c8c9a393-d351-41ef-afec-7b8db7f9a8e4",
};

describe("ordinary admission input boundaries", () => {
  it("allows unavailable contact without fabricating a phone number", () => {
    expect(
      admissionInput.safeParse({
        ...sample,
        patientDetails: { ...sample.patientDetails, phone: undefined },
      }).success,
    ).toBe(true);
    expect(
      admissionInput.safeParse({
        ...sample,
        patientDetails: { ...sample.patientDetails, phone: "not a phone" },
      }).success,
    ).toBe(false);
  });
  it("uses the configured hospital year across a UTC New Year boundary", () => {
    expect(
      admissionYear(new Date("2026-12-31T20:00:00Z"), "Asia/Kolkata"),
    ).toBe(2027);
    expect(
      admissionYear(new Date("2026-12-31T20:00:00Z"), "America/New_York"),
    ).toBe(2026);
  });
  it("accepts explicitly recorded age without inventing a date of birth", () => {
    const parsed = admissionInput.parse(sample);
    expect(parsed.patientDetails?.ageYearsAtRegistration).toBe(54);
    expect(parsed.patientDetails?.dateOfBirth).toBeUndefined();
    expect(
      admissionInput.safeParse({
        ...sample,
        patientDetails: { ...sample.patientDetails, dateOfBirth: "1972-01-01" },
      }).success,
    ).toBe(false);
    expect(
      admissionInput.safeParse({
        ...sample,
        patientDetails: {
          ...sample.patientDetails,
          ageYearsAtRegistration: undefined,
        },
      }).success,
    ).toBe(false);
  });
  it("rejects calendar-invalid birth dates, forged actor fields and clinician-future times", () => {
    expect(
      admissionInput.safeParse({ ...sample, actorId: "forged" }).success,
    ).toBe(false);
    expect(
      admissionInput.safeParse({
        ...sample,
        patientDetails: {
          ...sample.patientDetails,
          ageYearsAtRegistration: undefined,
          dateOfBirth: "2026-02-31",
        },
      }).success,
    ).toBe(false);
    expect(
      admissionInput.safeParse({
        ...sample,
        clinicianAssessment: {
          ...sample.clinicianAssessment,
          assessedAt: "2100-01-01T00:00:00Z",
        },
      }).success,
    ).toBe(false);
  });
});
