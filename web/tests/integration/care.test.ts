import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as schema from "../../src/server/schema";

loadLocalEnvironment();
const appUrl = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = appUrl;
});
const testRuntimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET =
  "SyntheticCareOnlySecretAtLeast32Characters12345";

describe("assigned clinical and nursing care on PostgreSQL", () => {
  it("preserves the first procedure rate through concurrent resolution and actual completion", async () => {
    await withTestDatabase(async ({ runtime }) => {
      process.env.DATABASE_URL = testRuntimeUrl;
      const care = await import("../../src/server/clinical/commands");
      const dbModule = await import("../../src/server/db");
      const { activateAdmission } = await import(
        "../../src/server/admissions/commands"
      );
      const f = await billingFixture();
      await f.setting({
        type: "deposit",
        category: "GENERAL",
        route: "self-pay",
        requirement: "not-required",
        amount: "0",
      });
      const a = await f.episode();
      const ac = f.deskCtx();
      await activateAdmission(ac, {
        admissionId: a.admissionId,
        arrivedAt: new Date().toISOString(),
        expectedVersion: 1,
        requestId: ac.requestId,
      });
      const dc = () => staffContext(f.doctor, "synthetic-care-rate-race");
      const round = dc();
      await care.recordRound(round, {
        admissionId: a.admissionId,
        notes: "Synthetic procedure awaiting configured billing",
        orders: [
          {
            kind: "PROCEDURE",
            requestedItem: "Synthetic race procedure",
            itemId: "RACE_PROC",
            quantity: "1",
            unit: "procedure",
          },
        ],
        requestId: round.requestId,
      });
      const source = (await care.getCare(dc(), a.admissionId)).billing[0];
      expect(source.state).toBe("UNRESOLVED");
      const policy = {
        type: "billable-item",
        code: "RACE_PROC",
        name: "Synthetic race procedure",
        category: "procedure",
        department: "DOCTOR",
        unit: "procedure",
        quantityScale: 0,
        active: true,
      };
      const firstPrice = await f.setting({ ...policy, amount: "100" });
      const firstConnection = new Client({ connectionString: testRuntimeUrl });
      const secondConnection = new Client({ connectionString: testRuntimeUrl });
      await Promise.all([
        firstConnection.connect(),
        secondConnection.connect(),
      ]);
      const firstPid = (
        await firstConnection.query("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      const secondPid = (
        await secondConnection.query("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      expect(secondPid).not.toBe(firstPid);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: () => void;
      let failReady!: (error: unknown) => void;
      const pinned = new Promise<void>((resolve, reject) => {
        ready = resolve;
        failReady = reject;
      });
      const spy = vi
        .spyOn(dbModule, "withTransaction")
        .mockImplementationOnce((fn) =>
          drizzle(firstConnection, { schema }).transaction(async (tx) => {
            const result = await fn(tx);
            ready();
            await hold;
            return result;
          }),
        )
        .mockImplementationOnce((fn) =>
          drizzle(secondConnection, { schema }).transaction(fn),
        );
      const firstContext = dc();
      const firstInput = {
        sourceEventId: source.id,
        reason: "First professional resolution",
      };
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      try {
        first = care.resolveCareBilling(firstContext, firstInput);
        void first.catch(failReady);
        await pinned;
        second = care.resolveCareBilling(dc(), {
          sourceEventId: source.id,
          reason: "Competing professional resolution",
        });
        void second.catch(() => {});
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          blocked = (
            await runtime.query(
              "SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked",
              [firstPid, secondPid],
            )
          ).rows[0].blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        const laterPrice = await f.setting({ ...policy, amount: "999" });
        expect(laterPrice.id).not.toBe(firstPrice.id);
        release();
        expect(await first).toEqual({ id: source.id });
        expect(await second).toEqual({ id: source.id });
        const resolved = (await care.getCare(dc(), a.admissionId)).billing[0];
        await care.completeClinicalTask(dc(), {
          orderId: source.orderId!,
          reason: "Actual synthetic procedure completion",
        });
        expect(await care.resolveCareBilling(firstContext, firstInput)).toEqual(
          { id: source.id },
        );
        const charges = (
          await runtime.query(
            "SELECT amount_paise, tariff_version_id FROM hims.charges WHERE source_event_id = $1",
            [source.id],
          )
        ).rows;
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({
          amount_paise: "10000",
          tariff_version_id: firstPrice.id,
        });
        expect(resolved).toMatchObject({
          state: "READY",
          tariffVersionId: firstPrice.id,
          resolutionReason: firstInput.reason,
        });
        expect(
          (await care.getCare(dc(), a.admissionId)).billing[0],
        ).toMatchObject({
          state: "POSTED",
          tariffVersionId: firstPrice.id,
        });
      } finally {
        release();
        await Promise.all([first?.catch(() => {}), second?.catch(() => {})]);
        spy.mockRestore();
        await Promise.all([firstConnection.end(), secondConnection.end()]);
      }
    });
  });

  it("retains signed history, source prices, retry identity, and obligations across handover", async () => {
    await withTestDatabase(async ({ runtime }) => {
      process.env.DATABASE_URL = testRuntimeUrl;
      const care = await import("../../src/server/clinical/commands");
      const nursing = await import("../../src/server/nursing/commands");
      const { activateAdmission } = await import(
        "../../src/server/admissions/commands"
      );
      const f = await billingFixture();
      await f.setting({
        type: "deposit",
        category: "GENERAL",
        route: "self-pay",
        requirement: "not-required",
        amount: "0",
      });
      const consult = await f.setting({
        type: "billable-item",
        code: "CARE_FEE",
        name: "Synthetic consultation",
        category: "consultation",
        department: "DOCTOR",
        unit: "visit",
        quantityScale: 0,
        amount: "120",
        active: true,
      });
      const proc = await f.setting({
        type: "billable-item",
        code: "CARE_PROC",
        name: "Synthetic procedure",
        category: "procedure",
        department: "DOCTOR",
        unit: "procedure",
        quantityScale: 0,
        amount: "500",
        active: true,
      });
      const a = await f.episode();
      const arrivedAt = new Date().toISOString();
      const activation = f.deskCtx();
      await activateAdmission(activation, {
        admissionId: a.admissionId,
        arrivedAt,
        expectedVersion: 1,
        requestId: activation.requestId,
      });
      const dc = () => staffContext(f.doctor, "synthetic-care");
      const nc = () => staffContext(f.nurse, "synthetic-care");
      const ac = () => staffContext(f.admin, "synthetic-assignment");
      await expect(care.getCare(nc(), a.admissionId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await nursing.assignNurse(ac(), {
        admissionId: a.admissionId,
        nurseId: f.nurse.id,
        reason: "Synthetic ward responsibility",
        authority: "Hospital administrator scheduling authority",
      });
      const request = dc();
      const input = {
        admissionId: a.admissionId,
        notes: "Synthetic signed round",
        feeScheduleId: "CARE_FEE",
        feeUnit: "visit",
        requestId: request.requestId,
        orders: [
          {
            kind: "MEDICINE",
            requestedItem: "Synthetic medicine",
            dose: "5",
            doseUnit: "mg",
            route: "oral",
            frequency: "Two explicit occurrences",
            durationDays: 1,
            schedule: {
              startsAt: arrivedAt,
              intervalMinutes: 1,
              occurrences: 2,
            },
            medicationPurpose: "BOTH",
            dispensingQuantity: "4",
            dispensingUnit: "tablet",
          },
          {
            kind: "VITALS",
            requestedItem: "Explicit clinician monitoring",
            schedule: {
              startsAt: arrivedAt,
              intervalMinutes: 1,
              occurrences: 2,
            },
          },
          {
            kind: "PROCEDURE",
            requestedItem: "Synthetic procedure",
            itemId: "CARE_PROC",
            quantity: "1",
            unit: "procedure",
          },
          {
            kind: "LAB",
            requestedItem: "Unconfigured synthetic test",
            itemId: "NO_RATE",
            quantity: "1",
            unit: "test",
          },
          { kind: "DIET", requestedItem: "Clinician diet instructions" },
        ],
      };
      const round = await care.recordRound(request, input);
      expect(await care.recordRound(request, input)).toEqual(round);
      await expect(
        care.recordRound(request, { ...input, notes: "changed" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const adminRound = ac();
      await expect(
        care.recordRound(adminRound, {
          ...input,
          requestId: adminRound.requestId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await care.addClinicalAddendum(dc(), {
        noteId: round.id,
        reason: "Synthetic correction",
        text: "Retained correction",
      });
      for (const statement of [
        "UPDATE hims.clinical_rounds SET notes='changed'",
        "DELETE FROM hims.clinical_rounds",
        "UPDATE hims.clinical_orders SET requested_item='changed'",
      ])
        await expect(runtime.query(statement)).rejects.toMatchObject({
          code: "42501",
        });
      let chart = await care.getCare(dc(), a.admissionId);
      expect(chart.rounds[0].notes).toBe(input.notes);
      expect(chart.addenda[0].text).toBe("Retained correction");
      expect(chart.orders).toHaveLength(5);
      expect(chart.tasks).toHaveLength(5);
      expect(
        chart.billing.filter((b) => b.state === "UNRESOLVED"),
      ).toHaveLength(1);
      const fee = chart.billing.find((b) => b.category === "consultation")!;
      expect(fee.tariffVersionId).toBe(consult.id);
      const procedure = chart.orders.find((o) => o.kind === "PROCEDURE")!;
      await f.setting({
        type: "billable-item",
        code: "CARE_PROC",
        name: "Changed price",
        category: "procedure",
        department: "DOCTOR",
        unit: "procedure",
        quantityScale: 0,
        amount: "999",
        active: true,
      });
      const completion = dc();
      await care.completeClinicalTask(completion, {
        orderId: procedure.id,
        reason: "Synthetic clinician performed procedure",
      });
      await care.completeClinicalTask(completion, {
        orderId: procedure.id,
        reason: "Synthetic clinician performed procedure",
      });
      const charge = (
        await runtime.query(
          "SELECT * FROM hims.charges WHERE source_event_id=$1",
          [procedure.id],
        )
      ).rows[0];
      expect(charge.tariff_version_id).toBe(proc.id);
      expect(charge.amount_paise).toBe("50000");
      const shiftContext = nc();
      const shift = await nursing.recordShift(shiftContext, {
        admissionId: a.admissionId,
        startedAt: arrivedAt,
        handover: "Synthetic incoming handover",
        requestId: shiftContext.requestId,
      });
      const futureShift = nc();
      await expect(
        nursing.recordShift(futureShift, {
          admissionId: a.admissionId,
          startedAt: new Date(Date.now() + 10000).toISOString(),
          handover: "Future attendance rejected",
          requestId: futureShift.requestId,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      chart = await care.getCare(nc(), a.admissionId);
      const medicine = chart.orders.find((o) => o.kind === "MEDICINE")!;
      const vital = chart.orders.find((o) => o.kind === "VITALS")!;
      const administration = nc();
      const marInput = {
        orderId: medicine.id,
        shiftId: shift.id,
        scheduledAt: arrivedAt,
        actualAt: new Date().toISOString(),
        actualDose: "0",
        doseUnit: "mg",
        outcome: "HELD",
        reason: "Synthetic clinician contacted",
        requestId: administration.requestId,
      };
      const wrongUnit = nc();
      await expect(
        nursing.recordAdministration(wrongUnit, {
          ...marInput,
          doseUnit: "ml",
          requestId: wrongUnit.requestId,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const futureMar = nc();
      await expect(
        nursing.recordAdministration(futureMar, {
          ...marInput,
          actualAt: new Date(Date.now() + 10000).toISOString(),
          requestId: futureMar.requestId,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const savedMar = await nursing.recordAdministration(
        administration,
        marInput,
      );
      expect(
        await nursing.recordAdministration(administration, marInput),
      ).toEqual(savedMar);
      const observation = nc();
      await nursing.recordObservation(observation, {
        admissionId: a.admissionId,
        shiftId: shift.id,
        scheduledFor: arrivedAt,
        orderId: vital.id,
        observedAt: new Date().toISOString(),
        values: {
          bpSystolic: 118,
          bpDiastolic: 76,
          pulse: 78,
          temperatureC: 37,
          spo2: 97,
          respiratoryRate: 18,
          painScore: 1,
        },
        requestId: observation.requestId,
      });
      const oldOccurrenceIds = chart.occurrences.map((o) => o.id);
      const end = new Date().toISOString();
      await nursing.endShift(nc(), {
        shiftId: shift.id,
        endedAt: end,
        handover: "Synthetic outgoing handover; next occurrence outstanding",
      });
      const next = nc();
      await nursing.recordShift(next, {
        admissionId: a.admissionId,
        startedAt: end,
        handover: "Accepted unfinished work",
        requestId: next.requestId,
      });
      chart = await care.getCare(nc(), a.admissionId);
      expect(chart.occurrences.map((o) => o.id)).toEqual(oldOccurrenceIds);
      expect(chart.administrations).toHaveLength(1);
      expect(chart.administrations[0].outcome).toBe("HELD");
      await nursing.addNursingAddendum(nc(), {
        admissionId: a.admissionId,
        recordType: "MAR",
        recordId: chart.administrations[0].id,
        reason: "Synthetic nursing correction",
        text: "Doctor contact documented without replacing MAR",
      });
      expect(
        (await care.getCare(nc(), a.admissionId)).nursingAddenda[0].text,
      ).toContain("without replacing MAR");
      expect(
        chart.occurrences.filter((o) => o.status === "PENDING"),
      ).toHaveLength(2);
      expect(
        (
          await runtime.query(
            "SELECT count(*)::int n FROM hims.charges WHERE category='medicine'",
          )
        ).rows[0].n,
      ).toBe(0);
      const summary = await care.signClinicalSummary(dc(), {
        admissionId: a.admissionId,
        expectedVersion: 0,
        diagnosis: "Synthetic diagnosis",
        course: "Synthetic course",
        condition: "Clinician entered condition",
        followUp: "Clinician entered follow up",
        advice: "Synthetic advice",
        prescriptionOrderIds: [medicine.id],
      });
      expect(summary.version).toBe(1);
      await expect(
        care.signClinicalSummary(dc(), {
          admissionId: a.admissionId,
          expectedVersion: 0,
          diagnosis: "Changed",
          course: "Synthetic",
          condition: "Synthetic",
          followUp: "Synthetic",
          advice: "Synthetic",
          prescriptionOrderIds: [medicine.id],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await care.getCare(dc(), a.admissionId)).summaries[0].prescription[0],
      ).toMatchObject({
        orderId: medicine.id,
        dispensingQuantity: "4",
        dispensingUnit: "tablet",
        dose: "5",
        doseUnit: "mg",
      });
      const medVersion = await f.setting({
        type: "billable-item",
        code: "CARE_MED",
        name: "Configured synthetic medicine",
        category: "medicine",
        department: "PHARMACY",
        unit: "tablet",
        quantityScale: 0,
        amount: "20",
        active: true,
      });
      expect(await care.clinicalMedicineCatalog(dc())).toEqual([
        {
          itemId: "CARE_MED",
          name: "Configured synthetic medicine",
          dispensingUnit: "tablet",
        },
      ]);
      const homeRound = dc();
      await care.recordRound(homeRound, {
        admissionId: a.admissionId,
        requestId: homeRound.requestId,
        notes: "Home versus ward prescribing",
        orders: [
          {
            kind: "MEDICINE",
            requestedItem: "Configured synthetic medicine",
            itemId: "CARE_MED",
            medicationPurpose: "TAKE_HOME",
            dose: "5",
            doseUnit: "mg",
            route: "oral",
            frequency: "Clinician directions",
            durationDays: 2,
            dispensingQuantity: "6",
            dispensingUnit: "tablet",
          },
          {
            kind: "MEDICINE",
            requestedItem: "Unconfigured ward medicine",
            medicationPurpose: "WARD",
            dose: "5",
            doseUnit: "mg",
            route: "oral",
            frequency: "Scheduled ward instruction",
            durationDays: 1,
            schedule: {
              startsAt: arrivedAt,
              intervalMinutes: 1,
              occurrences: 1,
            },
          },
          {
            kind: "VITALS",
            requestedItem: "Unfinished monitoring for reassignment",
            schedule: {
              startsAt: arrivedAt,
              intervalMinutes: 1,
              occurrences: 1,
            },
          },
        ],
      });
      chart = await care.getCare(dc(), a.admissionId);
      const home = chart.orders.find(
        (o) => o.details.medicationPurpose === "TAKE_HOME",
      )!;
      expect(
        chart.occurrences.filter((o) => o.orderId === home.id),
      ).toHaveLength(0);
      const homeSummary = await care.signClinicalSummary(dc(), {
        admissionId: a.admissionId,
        expectedVersion: 1,
        diagnosis: "Synthetic",
        course: "Synthetic",
        condition: "Synthetic",
        followUp: "Synthetic",
        advice: "Synthetic",
        prescriptionOrderIds: [home.id],
      });
      expect(homeSummary.prescription[0]).toMatchObject({
        medicineId: "CARE_MED",
        medicineCatalogVersionId: medVersion.id,
        medicineIdentityState: "CONFIGURED",
      });
      const wardOnly = chart.orders.find(
        (o) => o.details.medicationPurpose === "WARD",
      )!;
      await expect(
        care.signClinicalSummary(dc(), {
          admissionId: a.admissionId,
          expectedVersion: 2,
          diagnosis: "Synthetic",
          course: "Synthetic",
          condition: "Synthetic",
          followUp: "Synthetic",
          advice: "Synthetic",
          prescriptionOrderIds: [wardOnly.id],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const resolvedShift = chart.shifts.find((s) => !s.endedAt)!;
      const consumable = nc();
      const used = await nursing.recordConsumable(consumable, {
        admissionId: a.admissionId,
        shiftId: resolvedShift.id,
        usedAt: new Date().toISOString(),
        itemId: "CARE_USE",
        quantity: "2",
        unit: "piece",
        reason: "Actual synthetic use",
      });
      expect(
        (await care.getCare(nc(), a.admissionId)).billing.find(
          (b) => b.id === used.id,
        )?.state,
      ).toBe("UNRESOLVED");
      const useVersion = await f.setting({
        type: "billable-item",
        code: "CARE_USE",
        name: "Synthetic consumable",
        category: "consumable",
        department: "NURSE",
        unit: "piece",
        quantityScale: 0,
        amount: "15",
        active: true,
      });
      await care.resolveCareBilling(nc(), {
        sourceEventId: used.id,
        reason: "Configured actual persisted use",
      });
      const useCharge = (
        await runtime.query(
          "SELECT * FROM hims.charges WHERE source_event_id=$1",
          [used.id],
        )
      ).rows[0];
      expect(useCharge.tariff_version_id).toBe(useVersion.id);
      expect(useCharge.amount_paise).toBe("3000");
      const labSource = chart.billing.find((b) => b.category === "lab")!;
      await f.setting({
        type: "billable-item",
        code: "NO_RATE",
        name: "Synthetic test",
        category: "lab",
        department: "LAB",
        unit: "test",
        quantityScale: 0,
        amount: "50",
        active: true,
      });
      await care.resolveCareBilling(dc(), {
        sourceEventId: labSource.id,
        reason: "Configured persisted test order",
      });
      expect(
        (
          await runtime.query(
            "SELECT initial_status FROM hims.charges WHERE source_event_id=$1",
            [labSource.id],
          )
        ).rows[0].initial_status,
      ).toBe("PENDING");
      await expect(
        care.completeClinicalTask(dc(), {
          orderId: labSource.id,
          reason: "Doctor cannot complete laboratory work",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const { postChargeInTransaction, finalizeCharge } = await import(
        "../../src/server/billing/commands"
      );
      const { withTransaction } = await import("../../src/server/db");
      await expect(
        withTransaction((tx) =>
          postChargeInTransaction(tx, dc(), {
            admissionId: a.admissionId,
            sourceEventId: home.id,
            category: "medicine",
            itemId: "CARE_MED",
            quantity: "6",
            unit: "tablet",
            tariffVersionId: medVersion.id,
            status: "FINAL",
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const testCharge = (
        await runtime.query(
          "SELECT id FROM hims.charges WHERE source_event_id=$1",
          [labSource.id],
        )
      ).rows[0];
      const finalize = dc();
      await expect(
        finalizeCharge(finalize, {
          chargeId: testCharge.id,
          requestId: finalize.requestId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
      try {
        const overdue = await care.getCare(nc(), a.admissionId);
        expect(
          overdue.occurrences.filter(
            (o) => oldOccurrenceIds.includes(o.id) && o.status === "OVERDUE",
          ),
        ).toHaveLength(2);
      } finally {
        clock.mockRestore();
      }
      await care.stopClinicalOrder(dc(), {
        orderId: vital.id,
        reason: "Synthetic clinical monitoring stopped after prior shift",
      });
      const secondScheduled = new Date(
        Date.parse(arrivedAt) + 60000,
      ).toISOString();
      const lateActual = new Date(Date.parse(end) - 1).toISOString();
      const lateObservation = nc();
      await nursing.recordObservation(lateObservation, {
        admissionId: a.admissionId,
        shiftId: shift.id,
        orderId: vital.id,
        scheduledFor: secondScheduled,
        observedAt: lateActual,
        values: { pulse: 80 },
        requestId: lateObservation.requestId,
      });
      const postStopObservation = nc();
      await expect(
        nursing.recordObservation(postStopObservation, {
          admissionId: a.admissionId,
          shiftId: resolvedShift.id,
          orderId: vital.id,
          scheduledFor: secondScheduled,
          observedAt: new Date().toISOString(),
          values: { pulse: 81 },
          requestId: postStopObservation.requestId,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      await care.stopClinicalOrder(dc(), {
        orderId: medicine.id,
        reason: "Synthetic medicine stop after recorded old shift",
      });
      const lateMar = nc();
      await nursing.recordAdministration(lateMar, {
        orderId: medicine.id,
        shiftId: shift.id,
        scheduledAt: secondScheduled,
        actualAt: lateActual,
        actualDose: "0",
        doseUnit: "mg",
        outcome: "REFUSED",
        reason: "Late factual refusal from own prior shift before stop",
        requestId: lateMar.requestId,
      });
      const lateChart = await care.getCare(nc(), a.admissionId);
      expect(
        lateChart.administrations
          .find((m) => m.outcome === "REFUSED")!
          .signedAt.getTime(),
      ).toBeGreaterThan(Date.parse(lateActual));
      expect(
        lateChart.administrations
          .find((m) => m.outcome === "HELD")!
          .actualAt.toISOString(),
      ).toBe(marInput.actualAt);
      await expect(care.getCare(ac(), a.admissionId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const clientA = new Client({ connectionString: testRuntimeUrl });
      const clientB = new Client({ connectionString: testRuntimeUrl });
      await Promise.all([clientA.connect(), clientB.connect()]);
      try {
        expect(
          (await clientA.query("SELECT pg_backend_pid() p")).rows[0].p,
        ).not.toBe(
          (await clientB.query("SELECT pg_backend_pid() p")).rows[0].p,
        );
        const race = dc();
        const payload = {
          admissionId: a.admissionId,
          notes: "Concurrent round",
          orders: [],
          requestId: race.requestId,
        };
        const results = await Promise.all([
          drizzle(clientA, { schema }).transaction((tx) =>
            care.recordRoundInTransaction(tx, race, payload),
          ),
          drizzle(clientB, { schema }).transaction((tx) =>
            care.recordRoundInTransaction(tx, race, payload),
          ),
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(
          (
            await runtime.query(
              "SELECT count(*)::int n FROM hims.clinical_rounds WHERE notes='Concurrent round'",
            )
          ).rows[0].n,
        ).toBe(1);
        const activeShift = (
          await care.getCare(nc(), a.admissionId)
        ).shifts.find((s) => !s.endedAt)!;
        const administrationA = nc(),
          administrationB = nc();
        const refused = {
          orderId: wardOnly.id,
          shiftId: activeShift.id,
          scheduledAt: arrivedAt,
          actualAt: new Date().toISOString(),
          actualDose: "0",
          doseUnit: "mg",
          outcome: "REFUSED",
          reason: "Synthetic attributable refusal",
        };
        const marRace = await Promise.allSettled([
          drizzle(clientA, { schema }).transaction((tx) =>
            nursing.recordAdministrationInTransaction(tx, administrationA, {
              ...refused,
              requestId: administrationA.requestId,
            }),
          ),
          drizzle(clientB, { schema }).transaction((tx) =>
            nursing.recordAdministrationInTransaction(tx, administrationB, {
              ...refused,
              requestId: administrationB.requestId,
            }),
          ),
        ]);
        expect(marRace.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(marRace.find((r) => r.status === "rejected")).toMatchObject({
          status: "rejected",
          reason: { code: "CONFLICT" },
        });
        expect(
          (
            await runtime.query(
              "SELECT count(*)::int n FROM hims.medication_administrations m JOIN hims.care_occurrences o ON o.id=m.occurrence_id WHERE o.order_id=$1",
              [wardOnly.id],
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await Promise.all([clientA.end(), clientB.end()]);
      }
      const nurseGrant = (
        await nursing.assignmentWorkspace(ac())
      ).assignments.find(
        (g) => g.admissionId === a.admissionId && g.nurseId === f.nurse.id,
      )!;
      await expect(
        nursing.revokeNurseAssignment(ac(), {
          assignmentId: nurseGrant.id,
          reason: "Synthetic reassignment",
          authority: "Hospital administrator scheduling authority",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION" });
      const activeShift = (await care.getCare(nc(), a.admissionId)).shifts.find(
        (s) => !s.endedAt,
      )!;
      await nursing.endShift(nc(), {
        shiftId: activeShift.id,
        endedAt: new Date().toISOString(),
        handover: "Nurse signed reassignment handover",
      });
      await nursing.revokeNurseAssignment(ac(), {
        assignmentId: nurseGrant.id,
        reason: "Synthetic reassignment",
        authority: "Hospital administrator scheduling authority",
      });
      await expect(
        nursing.recordAdministration(administration, marInput),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(care.getCare(nc(), a.admissionId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        nursing.addNursingAddendum(nc(), {
          admissionId: a.admissionId,
          recordType: "SHIFT",
          recordId: activeShift.id,
          reason: "Revoked nurse rejected",
          text: "No current grant",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const { createStaff } = await import("../../src/server/staff");
      const nextNurse = await createStaff(f.ah, {
        name: "Synthetic incoming nurse",
        email: "incoming@care.invalid",
        password: "SyntheticOnly123!",
        role: "NURSE",
        reason: "Synthetic care handover",
      });
      await nursing.assignNurse(ac(), {
        admissionId: a.admissionId,
        nurseId: nextNurse.id,
        reason: "Synthetic new ward responsibility",
        authority: "Hospital administrator scheduling authority",
      });
      const nextContext = staffContext(
        {
          id: nextNurse.id,
          role: "NURSE",
          name: "Synthetic incoming nurse",
          email: "incoming@care.invalid",
        },
        "synthetic-care",
      );
      const inherited = await care.getCare(nextContext, a.admissionId);
      expect(
        inherited.occurrences
          .filter((o) => oldOccurrenceIds.includes(o.id))
          .map((o) => o.id),
      ).toEqual(oldOccurrenceIds);
      expect(inherited.administrations).toHaveLength(3);
      expect(inherited.occurrences.some((o) => o.status === "OVERDUE")).toBe(
        true,
      );
      expect(inherited.shifts).toHaveLength(2);
      const regrant = await nursing.assignNurse(ac(), {
        admissionId: a.admissionId,
        nurseId: f.nurse.id,
        reason: "Synthetic regrant after revocation",
        authority: "Hospital administrator scheduling authority",
      });
      expect(regrant.id).not.toBe(nurseGrant.id);
      const revokeConnection = new Client({ connectionString: testRuntimeUrl });
      const writeConnection = new Client({ connectionString: testRuntimeUrl });
      await Promise.all([
        revokeConnection.connect(),
        writeConnection.connect(),
      ]);
      try {
        const revokerPid = (
          await revokeConnection.query("SELECT pg_backend_pid() p")
        ).rows[0].p;
        const writerPid = (
          await writeConnection.query("SELECT pg_backend_pid() p")
        ).rows[0].p;
        expect(revokerPid).not.toBe(writerPid);
        let pendingWrite: Promise<{ id: string }> | undefined;
        await drizzle(revokeConnection, { schema }).transaction(async (tx) => {
          await tx.execute(
            sql`SELECT id FROM hims.admissions WHERE id=${a.admissionId} FOR UPDATE`,
          );
          pendingWrite = drizzle(writeConnection, { schema }).transaction(
            (tx) =>
              nursing.addNursingAddendumInTransaction(tx, nc(), {
                admissionId: a.admissionId,
                recordType: "SHIFT",
                recordId: activeShift.id,
                reason: "Concurrent revoked write rejected",
                text: "No stale grant may authorize this note",
              }),
          );
          void pendingWrite.catch(() => {});
          let blocked = false;
          for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
            blocked =
              (
                await runtime.query(
                  "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
                  [writerPid],
                )
              ).rows[0]?.blocked === true;
            if (!blocked)
              await new Promise((resolve) => setTimeout(resolve, 20));
          }
          expect(blocked).toBe(true);
          await nursing.revokeNurseAssignmentInTransaction(tx, ac(), {
            assignmentId: regrant.id,
            reason: "Synthetic concurrent operational revocation",
            authority: "Hospital administrator scheduling authority",
          });
        });
        await expect(pendingWrite!).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(
          (await care.getCare(nextContext, a.admissionId)).nursingAddenda,
        ).toHaveLength(1);
      } finally {
        await Promise.all([revokeConnection.end(), writeConnection.end()]);
      }
      expect(
        (await nursing.assignmentWorkspace(ac())).assignments.filter(
          (g) => g.nurseId === f.nurse.id,
        ),
      ).toHaveLength(2);
    });
  });
});
