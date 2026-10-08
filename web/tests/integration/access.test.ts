import { afterEach, describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../../scripts/migrate";
loadLocalEnvironment();
const applicationDatabaseUrl = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = applicationDatabaseUrl;
});
const testRuntimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET =
  "SyntheticTestOnlySecretAtLeast32Characters12345";

describe("staff access and settings on real PostgreSQL", () => {
  it("requires signed-in staff, prevents actor forgery, preserves roles and immutable settings", async () => {
    await withTestDatabase(async ({ runtime }) => {
      process.env.DATABASE_URL = testRuntimeUrl;

      const { bootstrapAdmin, createStaff, updateStaff, listStaff } =
        await import("../../src/server/staff");
      const { getAuth } = await import("../../src/server/auth");
      const { requireStaff, requireAdmissionAccess } = await import(
        "../../src/server/access"
      );
      const { saveSetting, listSettings } = await import(
        "../../src/server/settings"
      );

      await expect(listStaff(new Headers())).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      const admin = await bootstrapAdmin({
        name: "Synthetic administrator",
        email: "admin@fixture.invalid",
        password: "SyntheticOnly123!",
        role: "ADMIN",
        reason: "synthetic test initialization",
      });
      await expect(
        bootstrapAdmin({
          name: "Second administrator",
          email: "second@fixture.invalid",
          password: "SyntheticOnly123!",
          role: "ADMIN",
          reason: "synthetic test",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      async function login(email: string) {
        const response = await getAuth().handler(
          new Request("http://127.0.0.1:3100/api/auth/sign-in/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1:3100",
            },
            body: JSON.stringify({ email, password: "SyntheticOnly123!" }),
          }),
        );
        expect(response.status).toBe(200);
        const cookies = response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        return new Headers({
          "Content-Type": "application/json",
          cookie: cookies,
          Origin: "http://127.0.0.1:3100",
        });
      }

      const ah = await login("admin@fixture.invalid");
      await expect(
        requireAdmissionAccess(
          {
            actor: { type: "staff", staffId: admin },
            source: "test",
            requestId: "test",
          },
          "unknown-admission",
          "doctor-clearance",
          ah,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await requireStaff(ah)).id).toBe(admin);
      await expect(
        createStaff(ah, {
          name: "Forge",
          email: "forged@fixture.invalid",
          password: "SyntheticOnly123!",
          role: "DOCTOR",
          reason: "test",
          actorId: "forged",
        }),
      ).rejects.toThrow();
      const doctor = await createStaff(ah, {
        name: "Synthetic doctor",
        email: "doctor@fixture.invalid",
        password: "SyntheticOnly123!",
        role: "DOCTOR",
        reason: "synthetic staff fixture",
      });
      const dh = await login("doctor@fixture.invalid");
      await expect(
        createStaff(dh, {
          name: "Forbidden",
          email: "forbidden@fixture.invalid",
          password: "SyntheticOnly123!",
          role: "ADMIN",
          reason: "synthetic wrong role",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        saveSetting(dh, {
          reason: "forged settings",
          value: { type: "alert", basis: "insurer-limit", percent: 80 },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        requireAdmissionAccess(
          {
            actor: { type: "staff", staffId: doctor.id },
            source: "test",
            requestId: "test",
          },
          "unknown-admission",
          "clinical-read",
          dh,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await saveSetting(ah, {
        expectedVersion: 0,
        reason: "synthetic hospital identity",
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
      const one = await saveSetting(ah, {
        expectedVersion: 0,
        reason: "synthetic tariff one",
        value: {
          type: "tariff",
          category: "GENERAL",
          amount: "500.50",
          basis: "hour",
          rounding: "exact",
          graceMinutes: 0,
        },
      });
      const two = await saveSetting(ah, {
        expectedVersion: 1,
        reason: "synthetic tariff two",
        value: {
          type: "tariff",
          category: "GENERAL",
          amount: "700",
          basis: "hour",
          rounding: "exact",
          graceMinutes: 0,
        },
      });
      await expect(
        saveSetting(ah, {
          expectedVersion: 1,
          reason: "stale settings fixture",
          value: {
            type: "tariff",
            category: "GENERAL",
            amount: "999",
            basis: "hour",
            rounding: "exact",
            graceMinutes: 0,
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(two.version).toBe(one.version + 1);
      expect(
        (await listSettings(ah)).versions.find((v) => v.id === one.id)?.payload
          .amount,
      ).toBe("50050");
      await expect(
        saveSetting(ah, {
          expectedVersion: 2,
          reason: "invalid currency",
          value: {
            type: "deposit",
            category: "GENERAL",
            route: "self-pay",
            requirement: "required",
            amount: "1.999",
          },
        }),
      ).rejects.toThrow();
      await expect(
        updateStaff(ah, {
          id: admin,
          name: "Admin",
          role: "ADMIN",
          active: false,
          reason: "last admin fixture",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      await updateStaff(ah, {
        id: doctor.id,
        name: "Synthetic doctor",
        role: "NURSE",
        active: true,
        reason: "synthetic role change",
      });
      await expect(requireStaff(dh)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      const nh = await login("doctor@fixture.invalid");
      expect((await requireStaff(nh)).role).toBe("NURSE");
      await updateStaff(ah, {
        id: doctor.id,
        name: "Synthetic doctor",
        role: "NURSE",
        active: true,
        password: "ResetSyntheticOnly123!",
        reason: "synthetic password reset",
      });
      await expect(requireStaff(nh)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      const resetLogin = await getAuth().api.signInEmail({
        asResponse: true,
        body: {
          email: "doctor@fixture.invalid",
          password: "ResetSyntheticOnly123!",
        },
      });
      expect(resetLogin.status).toBe(200);
      const resetHeaders = new Headers(nh);
      resetHeaders.set(
        "cookie",
        resetLogin.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      );
      expect((await requireStaff(resetHeaders)).id).toBe(doctor.id);
      await updateStaff(ah, {
        id: doctor.id,
        name: "Synthetic doctor",
        role: "NURSE",
        active: false,
        reason: "synthetic disabling",
      });
      await expect(requireStaff(resetHeaders)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      const denied = await getAuth().handler(
        new Request("http://127.0.0.1:3100/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1:3100",
          },
          body: JSON.stringify({
            email: "doctor@fixture.invalid",
            password: "ResetSyntheticOnly123!",
          }),
        }),
      );
      expect(denied.ok).toBe(false);
      const audit = await runtime.query(
        "SELECT actor_id,source FROM hims.audit_events WHERE event='staff.created'",
      );
      expect(audit.rows).toEqual([
        { actor_id: admin, source: "staff-management" },
      ]);
      expect((await listStaff(ah))[0]).not.toHaveProperty("password");
      const ah2 = await login("admin@fixture.invalid");
      const changed = await getAuth().api.changePassword({
        asResponse: true,
        headers: ah2,
        body: {
          currentPassword: "SyntheticOnly123!",
          newPassword: "ChangedSyntheticOnly123!",
          revokeOtherSessions: true,
        },
      });
      await expect(requireStaff(ah)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(changed.status).toBe(200);
      const newHeaders = new Headers(ah2);
      newHeaders.set(
        "cookie",
        changed.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      );
      expect((await requireStaff(newHeaders)).id).toBe(admin);
      await getAuth().handler(
        new Request("http://127.0.0.1:3100/api/auth/sign-out", {
          method: "POST",
          headers: newHeaders,
          body: "{}",
        }),
      );
      await expect(requireStaff(newHeaders)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  }, 60000);
  it("actual bootstrap CLI initializes once and refuses to overwrite staff", async () => {
    await withTestDatabase(async ({ runtime }) => {
      const environment = {
        ...process.env,
        DATABASE_URL: testRuntimeUrl,
        HIMS_BOOTSTRAP_ADMIN_NAME: "Synthetic CLI administrator",
        HIMS_BOOTSTRAP_ADMIN_EMAIL: "cli@fixture.invalid",
        HIMS_BOOTSTRAP_ADMIN_PASSWORD: "SyntheticCliOnly123!",
      };
      const execute = () =>
        spawnSync(process.execPath, ["scripts/bootstrap-admin.mjs"], {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          env: environment,
          encoding: "utf8",
        });
      const first = execute();
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("Staff initialization completed");
      expect(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM hims.staff_user",
          )
        ).rows[0].count,
      ).toBe(1);
      const second = execute();
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("initialization refused");
      expect(second.stdout + second.stderr).not.toContain(
        "SyntheticCliOnly123!",
      );
      expect(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM hims.staff_user",
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await runtime.query(
            "SELECT source FROM hims.audit_events WHERE event='staff.initialized'",
          )
        ).rows,
      ).toEqual([{ source: "local-bootstrap" }]);
    });
  }, 60000);
  it("serializes simultaneous administrator demotions and preserves one active administrator", async () => {
    await withTestDatabase(async ({ runtime }) => {
      process.env.DATABASE_URL = testRuntimeUrl;
      const { bootstrapAdmin, createStaff, updateStaff } = await import(
        "../../src/server/staff"
      );
      const { getAuth } = await import("../../src/server/auth");
      const { requireStaff } = await import("../../src/server/access");
      const first = await bootstrapAdmin({
        name: "First synthetic admin",
        email: "race-a@fixture.invalid",
        password: "SyntheticRaceOnly123!",
        role: "ADMIN",
        reason: "synthetic administrator race",
      });
      async function login(email: string) {
        const response = await getAuth().api.signInEmail({
          asResponse: true,
          body: { email, password: "SyntheticRaceOnly123!" },
        });
        expect(response.status).toBe(200);
        return new Headers({
          cookie: response.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        });
      }
      const firstHeaders = await login("race-a@fixture.invalid");
      const second = await createStaff(firstHeaders, {
        name: "Second synthetic admin",
        email: "race-b@fixture.invalid",
        password: "SyntheticRaceOnly123!",
        role: "ADMIN",
        reason: "synthetic administrator race",
      });
      const secondHeaders = await login("race-b@fixture.invalid");
      expect((await requireStaff(firstHeaders)).role).toBe("ADMIN");
      expect((await requireStaff(secondHeaders)).role).toBe("ADMIN");
      const outcomes = await Promise.allSettled([
        updateStaff(firstHeaders, {
          id: first,
          name: "First synthetic admin",
          role: "ADMISSION",
          active: true,
          reason: "concurrent first demotion",
        }),
        updateStaff(secondHeaders, {
          id: second.id,
          name: "Second synthetic admin",
          role: "ADMISSION",
          active: true,
          reason: "concurrent second demotion",
        }),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === "rejected");
      expect(
        rejected?.status === "rejected" ? rejected.reason : null,
      ).toMatchObject({ code: "PRECONDITION" });
      const admins = await runtime.query(
        "SELECT id FROM hims.staff_user WHERE role='ADMIN' AND banned=false",
      );
      expect(admins.rowCount).toBe(1);
      const survivorHeaders =
        admins.rows[0].id === first ? firstHeaders : secondHeaders;
      expect((await requireStaff(survivorHeaders)).role).toBe("ADMIN");
    });
  }, 60000);
});
