import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";

loadLocalEnvironment();
const testRuntimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET =
  "SyntheticAdmissionOnlySecretAtLeast32Characters12345";

describe("patient identity and admission reservations on PostgreSQL", () => {
  it("protects codes, retry payloads, patient identity, beds and role projections", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = testRuntimeUrl;
      const {
        createAdmission,
        cancelAdmission,
        createBed,
        disableBed,
        getAdmission,
        searchPatients,
        admissionWorkspace,
      } = await import("../../src/server/admissions/commands");
      const { bootstrapAdmin, createStaff } = await import(
        "../../src/server/staff"
      );
      const { getAuth } = await import("../../src/server/auth");
      const { saveSetting } = await import("../../src/server/settings");
      const { staffContext, requireStaff, requireAdmissionAccess } =
        await import("../../src/server/access");
      await bootstrapAdmin({
        name: "Synthetic admin",
        email: "admin@admission.invalid",
        password: "SyntheticOnly123!",
        role: "ADMIN",
        reason: "synthetic fixture",
      });
      async function login(email: string) {
        const response = await getAuth().api.signInEmail({
          asResponse: true,
          body: { email, password: "SyntheticOnly123!" },
        });
        expect(response.status).toBe(200);
        return new Headers({
          cookie: response.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        });
      }
      const ah = await login("admin@admission.invalid");
      const doctor = await createStaff(ah, {
        name: "Synthetic doctor",
        email: "doctor@admission.invalid",
        password: "SyntheticOnly123!",
        role: "DOCTOR",
        reason: "synthetic fixture",
      });
      await createStaff(ah, {
        name: "Synthetic desk",
        email: "desk@admission.invalid",
        password: "SyntheticOnly123!",
        role: "ADMISSION",
        reason: "synthetic fixture",
      });
      await createStaff(ah, {
        name: "Synthetic nurse",
        email: "nurse@admission.invalid",
        password: "SyntheticOnly123!",
        role: "NURSE",
        reason: "synthetic fixture",
      });
      const dh = await login("doctor@admission.invalid");
      const nh = await login("nurse@admission.invalid");
      const desk = await requireStaff(await login("desk@admission.invalid"));
      const admin = await requireStaff(ah);
      const context = () => staffContext(desk, "synthetic-admission");
      const ac = () => staffContext(admin, "synthetic-bed");
      await saveSetting(ah, {
        expectedVersion: 0,
        reason: "synthetic identity",
        value: {
          type: "hospital",
          name: "Synthetic hospital",
          address: "Synthetic address",
          timezone: "Asia/Kolkata",
        },
      });
      await saveSetting(ah, {
        expectedVersion: 1,
        reason: "synthetic category",
        value: {
          type: "bed-category",
          code: "GENERAL",
          name: "General",
          active: true,
        },
      });
      await saveSetting(ah, {
        expectedVersion: 0,
        reason: "synthetic tariff",
        value: {
          type: "tariff",
          category: "GENERAL",
          amount: "500",
          basis: "24-hours",
          rounding: "exact",
          graceMinutes: 0,
        },
      });
      const beds = await Promise.all(
        Array.from({ length: 27 }, (_, i) =>
          createBed(ac(), {
            label: `Synthetic ${i}`,
            category: "GENERAL",
            reason: "synthetic inventory",
          }),
        ),
      );
      await saveSetting(ah, {
        expectedVersion: 2,
        reason: "synthetic deposit rule",
        value: {
          type: "deposit",
          category: "GENERAL",
          route: "self-pay",
          requirement: "required",
          amount: "500",
        },
      });
      await saveSetting(ah, {
        expectedVersion: 3,
        reason: "synthetic unrelated later rule",
        value: { type: "alert", basis: "insurer-limit", percent: 80 },
      });
      expect((await admissionWorkspace(context())).depositRules).toMatchObject([
        {
          category: "GENERAL",
          route: "self-pay",
          amount: "50000",
          requirement: "required",
        },
      ]);
      const input = (i: number) => ({
        patientDetails: {
          name: `Synthetic patient ${i}`,
          dateOfBirth: "1990-01-01",
          sex: "FEMALE",
          phone: "9999999999",
        },
        admittingDoctorId: doctor.id,
        clinicianAssessment: {
          clinicianId: doctor.id,
          assessedAt: new Date().toISOString(),
          chiefComplaint: "Synthetic complaint",
          vitals: "Synthetic clinician vitals",
          triage: "Clinician assessment",
          destinationCategory: "GENERAL",
        },
        bedId: beds[i].id,
        paymentRoute: "SELF_PAY" as const,
        expectedStayDays: 2,
        requestId: randomUUID(),
      });
      const episodes = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const data = input(i);
          return createAdmission(
            { ...context(), requestId: data.requestId },
            data,
          );
        }),
      );
      expect(new Set(episodes.map((a) => a.ipCode)).size).toBe(20);
      expect(
        (
          await runtime.query(
            "select count(*)::int as count from hims.bed_holds",
          )
        ).rows[0].count,
      ).toBe(20);
      expect(
        (
          await runtime.query(
            "select count(*)::int as count from hims.room_stays",
          )
        ).rows[0].count,
      ).toBe(0);
      const race = await Promise.allSettled(
        [20, 21].map((i) => {
          const data = { ...input(i), bedId: beds[20].id };
          return createAdmission(
            { ...context(), requestId: data.requestId },
            data,
          );
        }),
      );
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(race.filter((r) => r.status === "rejected")[0]).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      const retry = input(22);
      const retryCtx = { ...context(), requestId: retry.requestId };
      const repeated = await Promise.all([
        createAdmission(retryCtx, retry),
        createAdmission(retryCtx, retry),
      ]);
      expect(repeated[0]).toEqual(repeated[1]);
      await expect(
        createAdmission(retryCtx, { ...retry, expectedStayDays: 3 }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(createAdmission(context(), input(23))).rejects.toMatchObject(
        { code: "VALIDATION" },
      );
      await expect(
        disableBed(ac(), { bedId: beds[0].id, reason: "synthetic disable" }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      await cancelAdmission(context(), {
        admissionId: episodes[0].admissionId,
        reason: "synthetic pending cancellation",
      });
      const existing = {
        ...input(23),
        patientId: episodes[0].patientId,
        patientDetails: undefined,
      };
      const identityRace = await Promise.allSettled(
        [23, 24].map((i) => {
          const data = {
            ...existing,
            bedId: beds[i].id,
            requestId: randomUUID(),
          };
          return createAdmission(
            { ...context(), requestId: data.requestId },
            data,
          );
        }),
      );
      const winner = identityRace.find((r) => r.status === "fulfilled");
      expect(identityRace.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      if (winner?.status !== "fulfilled")
        throw new Error("Expected readmission");
      expect(winner.value.patientId).toBe(episodes[0].patientId);
      expect(winner.value.ipCode).not.toBe(episodes[0].ipCode);
      expect(
        (await searchPatients(context(), "Synthetic patient 0"))[0].id,
      ).toBe(episodes[0].patientId);
      const doctorCtx = staffContext(await requireStaff(dh), "synthetic-read");
      await expect(
        requireAdmissionAccess(
          doctorCtx,
          episodes[1].admissionId,
          "clinical-read",
          dh,
        ),
      ).resolves.toMatchObject({ role: "DOCTOR" });
      expect(
        await getAdmission(doctorCtx, episodes[1].admissionId),
      ).not.toHaveProperty("phone");
      expect(
        await getAdmission(ac(), episodes[1].admissionId),
      ).not.toHaveProperty("clinicianAssessment");
      await expect(
        getAdmission(
          staffContext(await requireStaff(nh), "synthetic-read"),
          episodes[1].admissionId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        requireAdmissionAccess(doctorCtx, randomUUID(), "clinical-read", dh),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        requireAdmissionAccess(
          { ...doctorCtx, actor: { type: "staff", staffId: desk.id } },
          episodes[1].admissionId,
          "clinical-read",
          dh,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const otherDoctor = await createStaff(ah, {
        name: "Other synthetic doctor",
        email: "other@admission.invalid",
        password: "SyntheticOnly123!",
        role: "DOCTOR",
        reason: "synthetic wrong-assignment fixture",
      });
      await expect(
        getAdmission(
          { ...doctorCtx, actor: { type: "staff", staffId: otherDoctor.id } },
          episodes[1].admissionId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        createBed(context(), {
          label: "Forged desk bed",
          category: "GENERAL",
          reason: "synthetic denial",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const before = (
        await runtime.query("select count(*)::int as count from hims.patients")
      ).rows[0].count;
      const bad = { ...input(25), admittingDoctorId: desk.id };
      await expect(
        createAdmission({ ...context(), requestId: bad.requestId }, bad),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(
        (
          await runtime.query(
            "select count(*)::int as count from hims.patients",
          )
        ).rows[0].count,
      ).toBe(before);
      const holdsBefore = (
        await runtime.query("select count(*)::int as count from hims.bed_holds")
      ).rows[0].count;
      const counterBefore = (
        await runtime.query("select value::text from hims.admission_counters")
      ).rows[0].value;
      // Fail after identity, episode and hold insertions to prove transaction rollback.
      await owner.query(
        "CREATE FUNCTION hims.synthetic_fail_admission_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admission.pending-created' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_admission_audit_failure BEFORE INSERT ON hims.audit_events FOR EACH ROW EXECUTE FUNCTION hims.synthetic_fail_admission_audit()",
      );
      try {
        const failed = input(25);
        await expect(
          createAdmission(
            { ...context(), requestId: failed.requestId },
            failed,
          ),
        ).rejects.toThrow();
      } finally {
        await owner.query(
          "DROP TRIGGER synthetic_admission_audit_failure ON hims.audit_events; DROP FUNCTION hims.synthetic_fail_admission_audit()",
        );
      }
      expect(
        (
          await runtime.query(
            "select count(*)::int as count from hims.patients",
          )
        ).rows[0].count,
      ).toBe(before);
      expect(
        (
          await runtime.query(
            "select count(*)::int as count from hims.bed_holds",
          )
        ).rows[0].count,
      ).toBe(holdsBefore);
      expect(
        (await runtime.query("select value::text from hims.admission_counters"))
          .rows[0].value,
      ).toBe(counterBefore);
      await disableBed(ac(), {
        bedId: beds[25].id,
        reason: "synthetic disable",
      });
      const disabled = input(25);
      await expect(
        createAdmission(
          { ...context(), requestId: disabled.requestId },
          disabled,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await owner.query(
        "update hims.admissions set status='ADMITTED', admitted_at=now() where id=$1",
        [episodes[2].admissionId],
      );
      await expect(
        cancelAdmission(context(), {
          admissionId: episodes[2].admissionId,
          reason: "synthetic active denial",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      await owner.query("update hims.admission_counters set value=99999");
      const overflow = {
        ...input(26),
        patientDetails: {
          name: "Synthetic age-only patient",
          ageYearsAtRegistration: 54,
          sex: "UNKNOWN",
          phone: undefined,
        },
      };
      expect(
        (
          await createAdmission(
            { ...context(), requestId: overflow.requestId },
            overflow,
          )
        ).ipCode,
      ).toMatch(/-100000$/);
      const agePatient = (
        await searchPatients(context(), "Synthetic age-only")
      )[0];
      expect(agePatient.dateOfBirth).toBeNull();
      expect(agePatient.ageYearsAtRegistration).toBe(54);
      await saveSetting(ah, {
        expectedVersion: 4,
        reason: "synthetic clinical destination",
        value: { type: "bed-category", code: "ICU", name: "ICU", active: true },
      });
      const override = {
        ...input(0),
        clinicianAssessment: {
          ...input(0).clinicianAssessment,
          destinationCategory: "ICU",
        },
      };
      await expect(
        createAdmission(
          { ...context(), requestId: override.requestId },
          override,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const reasonedOverride = {
        ...override,
        clinicianAssessment: {
          ...override.clinicianAssessment,
          overrideReason: "Synthetic clinician-directed destination change",
        },
      };
      const overridden = await createAdmission(
        { ...context(), requestId: reasonedOverride.requestId },
        reasonedOverride,
      );
      expect(await getAdmission(context(), overridden.admissionId)).toMatchObject({ clinicianAssessment: { overrideReason: "Synthetic clinician-directed destination change" } });
    });
  }, 60000);
});
