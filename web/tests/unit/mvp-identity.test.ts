import { describe, expect, it } from "vitest";
import { admissionInput, generatePatientUhid } from "../../src/server/admissions/commands";

describe("MVP identity and external Doctor intake", () => {
  it("uses uppercase initials and exactly seven cryptographic random digits", () => {
    expect(generatePatientUhid(" Prateek   Yadav ")).toMatch(/^PY\d{7}$/);
    expect(generatePatientUhid("Meera")).toMatch(/^M\d{7}$/);
    expect(generatePatientUhid(undefined)).toMatch(/^UN\d{7}$/);
    expect(new Set(Array.from({length: 30}, () => generatePatientUhid("Meera Shah"))).size).toBeGreaterThan(1);
  });
  it("requires an external directory Doctor and forbids a client workflow version", () => {
    const input = { patientDetails: {name:"Meera Shah",ageYearsAtRegistration:42,sex:"FEMALE"}, externalDoctorId:crypto.randomUUID(),bedId:crypto.randomUUID(),paymentRoute:"SELF_PAY",expectedStayDays:2,requestId:crypto.randomUUID() };
    expect(admissionInput.safeParse(input).success).toBe(true);
    expect(admissionInput.safeParse({...input,workflowVersion:1}).success).toBe(false);
    expect(admissionInput.safeParse({...input,externalDoctorId:undefined,admittingDoctorId:"login"}).success).toBe(false);
    expect(admissionInput.safeParse({...input,patientDetails:{sex:"UNKNOWN",identityStatus:"TEMPORARY",identityProvenance:"Emergency identity not yet established"}}).success).toBe(true);
    expect(admissionInput.safeParse({...input,patientDetails:{sex:"UNKNOWN",identityStatus:"TEMPORARY"}}).success).toBe(false);
  });
});
