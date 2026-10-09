import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
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
const originalUrl = process.env.DATABASE_URL;
const runtimeUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(() => { process.env.DATABASE_URL = originalUrl; vi.restoreAllMocks(); });
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticTransferOnlySecretAtLeast32Characters12345";

// Removing any transfer authority/lock/boundary guard must break these real database checks.
it("atomically splits room stays and pins tariffs, retains care sources, and rejects stale authority/retries", async () => {
  await withTestDatabase(async ({ runtime, owner }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const admission = await import("../../src/server/admissions/commands");
    const care = await import("../../src/server/clinical/commands");
    const nursing = await import("../../src/server/nursing/commands");
    const billing = await import("../../src/server/billing/commands");
    const f = await billingFixture();
    await f.setting({ type: "deposit", category: "GENERAL", route: "insured", requirement: "not-required", amount: "0" });
    await f.setting({ type: "bed-category", code: "ICU", name: "Synthetic ICU", active: true });
    const icuRate = await f.setting({ type: "tariff", category: "ICU", amount: "200", basis: "hour", rounding: "exact", graceMinutes: 0 });
    const target = await admission.createBed(staffContext(f.admin, "synthetic"), { label: "Synthetic transfer ICU", category: "ICU", reason: "Synthetic fixture" });
    const a = await f.episode("INSURED");
    const start = new Date().toISOString();
    const ac = f.deskCtx();
    await admission.activateAdmission(ac, { admissionId: a.admissionId, arrivedAt: start, expectedVersion: 1, requestId: ac.requestId });
    const dc = () => staffContext(f.doctor, "synthetic-transfer");
    const nc = () => staffContext(f.nurse, "synthetic-transfer");
    const admin = () => staffContext(f.admin, "synthetic-transfer");
    await nursing.assignNurse(admin(), { admissionId: a.admissionId, nurseId: f.nurse.id, reason: "Synthetic ward assignment", authority: "Synthetic admin authority" });
    const shiftCtx = nc();
    const shift = await nursing.recordShift(shiftCtx, { admissionId: a.admissionId, startedAt: start, handover: "Synthetic incoming care", requestId: shiftCtx.requestId });
    const round = dc();
    await care.recordRound(round, { admissionId: a.admissionId, notes: "Synthetic monitoring continues", orders: [{ kind: "VITALS", requestedItem: "Synthetic pulse monitoring", schedule: { startsAt: start, intervalMinutes: 10, occurrences: 3 } }], requestId: round.requestId });
    const use = await nursing.recordConsumable(nc(), { admissionId: a.admissionId, shiftId: shift.id, usedAt: new Date().toISOString(), itemId: "TRANSFER_USE", quantity: "2", unit: "piece", reason: "Synthetic source use" });
    const before = await care.getCare(nc(), a.admissionId);
    const oldStay = (await runtime.query("select * from hims.room_stays where admission_id=$1", [a.admissionId])).rows[0];
    const orderCtx = dc();
    const orderInput = { admissionId: a.admissionId, destinationCategory: "ICU", reason: "Clinician escalation", requestId: orderCtx.requestId };
    const order = await care.orderTransfer(orderCtx, orderInput);
    expect(await care.orderTransfer(orderCtx, orderInput)).toEqual(order);
    await expect(care.orderTransfer(admin(), { ...orderInput, requestId: admin().requestId })).rejects.toMatchObject({ code: "VALIDATION" });
    const forbidden = admin();
    await expect(care.orderTransfer(forbidden, { ...orderInput, requestId: forbidden.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const T = new Date(Date.parse(start) + 5400000);
    const clock = vi.spyOn(Date, "now").mockReturnValue(T.getTime() + 3600000);
    const ctx = nc();
    const input = { admissionId: a.admissionId, transferOrderId: order.id, targetBedId: target.id, handover: { shiftId: shift.id, notes: "Actual ICU handover; continue prescribed monitoring" }, transferredAt: T.toISOString(), requestId: ctx.requestId };
    await expect(admission.transferAdmission(ctx, { ...input, transferredAt: new Date(Date.now() + 1).toISOString() })).rejects.toMatchObject({ code: "VALIDATION" });
    const wrong = admin();
    await expect(admission.transferAdmission(wrong, { ...input, requestId: wrong.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admission.transferAdmission(ctx, { ...input, handover: { ...input.handover, shiftId: randomUUID() } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A real failure after the room delta, old stay close and target move must roll back every effect.
    await owner.query("CREATE FUNCTION hims.reject_transfer_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic transfer audit failure'; END $$; CREATE TRIGGER reject_transfer_test BEFORE INSERT ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.reject_transfer_test()");
    await expect(admission.transferAdmission(ctx, input)).rejects.toMatchObject({ cause: { message: "synthetic transfer audit failure" } });
    expect((await runtime.query("select count(*)::int n from hims.charges where admission_id=$1", [a.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select * from hims.room_stays where id=$1", [oldStay.id])).rows[0]).toMatchObject({ ended_at: null, posted_paise: "0" });
    expect((await runtime.query("select bed_id from hims.bed_holds where admission_id=$1", [a.admissionId])).rows[0].bed_id).toBe(oldStay.bed_id);
    await owner.query("DROP TRIGGER reject_transfer_test ON hims.admission_transfers; DROP FUNCTION hims.reject_transfer_test()");
    await f.setting({ type: "tariff", category: "GENERAL", amount: "999", basis: "hour", rounding: "exact", graceMinutes: 0 });
    const result = await admission.transferAdmission(ctx, input);
    expect(await admission.transferAdmission(ctx, input)).toEqual(result);
    await expect(admission.transferAdmission(ctx, { ...input, transferredAt: new Date(T.getTime() + 1).toISOString() })).rejects.toMatchObject({ code: "CONFLICT" });
    const replay = nc();
    await expect(admission.transferAdmission(replay, { ...input, requestId: replay.requestId })).rejects.toMatchObject({ code: "CONFLICT" });
    const stays = (await runtime.query("select * from hims.room_stays where admission_id=$1 order by started_at", [a.admissionId])).rows;
    expect(stays).toHaveLength(2);
    expect(result).toEqual({ oldStayId: stays[0].id, newStayId: stays[1].id });
    expect(stays[0].ended_at.toISOString()).toBe(T.toISOString());
    expect(stays[1].started_at.toISOString()).toBe(T.toISOString());
    expect(stays[0].tariff_version_id).toBe(f.room.id);
    expect(stays[1].tariff_version_id).toBe(icuRate.id);
    expect(stays[0].posted_paise).toBe("15002");
    const reconcile = f.ctx();
    await billing.reconcileBill(reconcile, { admissionId: a.admissionId, cutoff: new Date(T.getTime() + 1800000).toISOString() });
    expect((await billing.getBill(f.ctx(), a.admissionId, new Date(T.getTime() + 1800000))).netPaise).toBe(25002n);
    const chart = await care.getCare(nc(), a.admissionId);
    expect(chart.occurrences.map(o => o.id)).toEqual(before.occurrences.map(o => o.id));
    expect(chart.occurrences.every(o => o.status === "OVERDUE")).toBe(true);
    expect(chart.consumables.find(c => c.id === use.id)).toMatchObject({ stayId: oldStay.id, bedId: oldStay.bed_id, unit: "piece" });
    expect((await runtime.query("select owner_role from hims.transfer_insurance_tasks where admission_id=$1", [a.admissionId])).rows).toEqual([{ owner_role: "INSURANCE" }]);
    await expect(owner.query("update hims.admission_transfers set handover='rewritten' where admission_id=$1", [a.admissionId])).rejects.toThrow("Transfer history is immutable");
    await expect(owner.query("update hims.transfer_orders set reason='rewritten' where admission_id=$1", [a.admissionId])).rejects.toThrow("Transfer history is immutable");
    await expect(owner.query("update hims.room_stays set ended_at=ended_at+interval '1 minute' where id=$1", [oldStay.id])).rejects.toThrow("Closed room boundary is immutable");
    const grant = (await nursing.assignmentWorkspace(admin())).assignments.find(g => g.admissionId === a.admissionId && g.nurseId === f.nurse.id)!;
    await nursing.endShift(nc(), { shiftId: shift.id, endedAt: new Date(T.getTime() + 1800000).toISOString(), handover: "Synthetic complete shift" });
    await nursing.revokeNurseAssignment(admin(), { assignmentId: grant.id, reason: "Synthetic revoke", authority: "Synthetic admin authority" });
    await expect(admission.transferAdmission(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    clock.mockRestore();
  });
}, 120000);

it("orders the shared configuration lock before staff rows and reauthenticates after concurrent staff disable", async () => {
  await withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const admission = await import("../../src/server/admissions/commands");
    const care = await import("../../src/server/clinical/commands");
    const nursing = await import("../../src/server/nursing/commands");
    const f = await billingFixture();
    const admin = () => staffContext(f.admin, "synthetic-transfer-lock-order");
    const dc = () => staffContext(f.doctor, "synthetic-transfer-lock-order");
    const nc = () => staffContext(f.nurse, "synthetic-transfer-lock-order");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const a = await f.episode(), arrivedAt = new Date().toISOString(), ac = f.deskCtx();
    await admission.activateAdmission(ac, { admissionId: a.admissionId, arrivedAt, expectedVersion: 1, requestId: ac.requestId });
    await nursing.assignNurse(admin(), { admissionId: a.admissionId, nurseId: f.nurse.id, reason: "Synthetic responsibility", authority: "Synthetic hospital schedule" });
    const sc = nc();
    const shift = await nursing.recordShift(sc, { admissionId: a.admissionId, startedAt: arrivedAt, handover: "Synthetic received", requestId: sc.requestId });
    const oc = dc();
    const order = await care.orderTransfer(oc, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Synthetic clinical authority", requestId: oc.requestId });
    const target = await admission.createBed(admin(), { label: "Synthetic lock-order target", category: "GENERAL", reason: "Synthetic inventory" });
    const writer = new Client({ connectionString: runtimeUrl }), reader = new Client({ connectionString: runtimeUrl });
    await Promise.all([writer.connect(), reader.connect()]);
    try {
      const writerPid = (await writer.query("select pg_backend_pid() p")).rows[0].p;
      const readerPid = (await reader.query("select pg_backend_pid() p")).rows[0].p;
      expect(writerPid).not.toBe(readerPid);
      const writeDb = drizzle(writer, { schema }), readDb = drizzle(reader, { schema });
      for (const person of [f.doctor, f.nurse]) {
        let pending: Promise<unknown> | undefined;
        await writeDb.transaction(async tx => {
          // Exact existing updateStaff lock order, on synthetic role/disable data only.
          await tx.execute(sql`select pg_advisory_xact_lock(729104211)`);
          const ctx = person.role === "DOCTOR" ? dc() : nc();
          pending = readDb.transaction(async other => {
            if (person.role === "DOCTOR") await care.orderTransferInTransaction(other, ctx, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Concurrent doctor command", requestId: ctx.requestId });
            else await admission.transferAdmissionInTransaction(other, ctx, { admissionId: a.admissionId, transferOrderId: order.id, targetBedId: target.id, handover: { shiftId: shift.id, notes: "Concurrent actual handover" }, transferredAt: new Date().toISOString(), requestId: ctx.requestId });
          });
          void pending.catch(() => {});
          let blocked = false;
          for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
            blocked = (await runtime.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [readerPid])).rows[0]?.blocked === true;
            if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
          }
          expect(blocked).toBe(true);
          // This UPDATE would deadlock if the waiting command had already held user FOR SHARE.
          await tx.execute(sql`update hims.staff_user set banned=true where id=${person.id}`);
        });
        await expect(pending!).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect((await runtime.query("select count(*)::int n from hims.admission_transfers")).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.transfer_orders")).rows[0].n).toBe(1);
    } finally { await Promise.all([writer.end(), reader.end()]); }
  });
}, 120000);

it("rejects wrong/latest authority, current configuration, historical care and stale source occupancy without partial moves", async () => {
  await withTestDatabase(async ({ owner, runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const admission = await import("../../src/server/admissions/commands");
    const care = await import("../../src/server/clinical/commands");
    const nursing = await import("../../src/server/nursing/commands");
    const f = await billingFixture();
    const admin = () => staffContext(f.admin, "synthetic-transfer-guards");
    const dc = () => staffContext(f.doctor, "synthetic-transfer-guards");
    const nc = () => staffContext(f.nurse, "synthetic-transfer-guards");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const a = await f.episode(), b = await f.episode();
    const start = new Date().toISOString(), ac = f.deskCtx();
    await admission.activateAdmission(ac, { admissionId: a.admissionId, arrivedAt: start, expectedVersion: 1, requestId: ac.requestId });
    await nursing.assignNurse(admin(), { admissionId: a.admissionId, nurseId: f.nurse.id, reason: "Synthetic assignment", authority: "Synthetic authority" });
    const sc = nc();
    const shift = await nursing.recordShift(sc, { admissionId: a.admissionId, startedAt: start, handover: "Synthetic received", requestId: sc.requestId });
    const bed = await admission.createBed(admin(), { label: "Synthetic guard target", category: "GENERAL", reason: "Synthetic target" });
    const source = (await runtime.query("select * from hims.room_stays where admission_id=$1", [a.admissionId])).rows[0];
    const oc = dc();
    const oldOrder = await care.orderTransfer(oc, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Original clinical decision", requestId: oc.requestId });
    const superseding = dc();
    const order = await care.orderTransfer(superseding, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Revised clinical decision", requestId: superseding.requestId });
    const T = new Date(Date.now() + 3600000);
    vi.spyOn(Date, "now").mockReturnValue(T.getTime() + 3600000);
    const input = (ctx: ReturnType<typeof nc>) => ({ admissionId: a.admissionId, transferOrderId: order.id, targetBedId: bed.id, handover: { shiftId: shift.id, notes: "Actual synthetic handover" }, transferredAt: T.toISOString(), requestId: ctx.requestId });
    const expectRejected = async (changes: Record<string, unknown>, code: string) => {
      const ctx = nc();
      await expect(admission.transferAdmission(ctx, { ...input(ctx), ...changes })).rejects.toMatchObject({ code });
      expect((await runtime.query("select count(*)::int n from hims.room_stays where admission_id=$1", [a.admissionId])).rows[0].n).toBe(1);
      expect((await runtime.query("select bed_id from hims.bed_holds where admission_id=$1", [a.admissionId])).rows[0].bed_id).toBe(source.bed_id);
    };
    await expectRejected({ transferOrderId: oldOrder.id }, "CONFLICT");
    await expectRejected({ transferOrderId: randomUUID() }, "CONFLICT");
    await expectRejected({ admissionId: b.admissionId }, "FORBIDDEN");
    await expectRejected({ targetBedId: source.bed_id }, "VALIDATION");
    const reservedBed = (await runtime.query("select bed_id from hims.admissions where id=$1", [b.admissionId])).rows[0].bed_id;
    await expectRejected({ targetBedId: reservedBed }, "CONFLICT");
    await admission.disableBed(admin(), { bedId: bed.id, reason: "Synthetic target unavailable" });
    await expectRejected({}, "CONFLICT");
    // Only synthetic owner setup re-enables this test bed, never ordinary inventory.
    await owner.query("update hims.beds set active=true where id=$1", [bed.id]);
    await f.setting({ type: "bed-category", code: "ICU", name: "Synthetic no-price ICU", active: true });
    const unpriced = await admission.createBed(admin(), { label: "Synthetic unpriced ICU", category: "ICU", reason: "Synthetic fixture" });
    await expectRejected({ targetBedId: unpriced.id }, "VALIDATION");
    const ic = dc();
    const icuOrder = await care.orderTransfer(ic, { admissionId: a.admissionId, destinationCategory: "ICU", reason: "Synthetic ICU decision", requestId: ic.requestId });
    await expectRejected({ transferOrderId: icuOrder.id, targetBedId: unpriced.id }, "PRECONDITION");
    await f.setting({ type: "tariff", category: "ICU", amount: "500", basis: "hour", rounding: "exact", graceMinutes: 0 });
    await f.setting({ type: "bed-category", code: "ICU", name: "Synthetic disabled ICU", active: false });
    await expectRejected({ transferOrderId: icuOrder.id, targetBedId: unpriced.id }, "PRECONDITION");
    const restore = dc();
    const generalOrder = await care.orderTransfer(restore, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Synthetic return decision", requestId: restore.requestId });
    const usedAt = new Date(T.getTime() + 1).toISOString();
    await nursing.recordConsumable(nc(), { admissionId: a.admissionId, shiftId: shift.id, usedAt, itemId: "GUARD_USE", quantity: "1", unit: "piece", reason: "Synthetic old-unit actual use after proposed move" });
    await expectRejected({ transferOrderId: generalOrder.id }, "CONFLICT");
    await expectRejected({ transferOrderId: generalOrder.id, transferredAt: usedAt }, "CONFLICT");
    const move = nc();
    const result = await admission.transferAdmission(move, { ...input(move), transferOrderId: generalOrder.id, transferredAt: new Date(T.getTime() + 2).toISOString() });
    expect(result.oldStayId).toBe(source.id);
    expect((await runtime.query("select count(*)::int n from hims.transfer_insurance_tasks where admission_id=$1", [a.admissionId])).rows[0].n).toBe(0);
    expect((await care.getCare(nc(), a.admissionId)).stays[0]).not.toHaveProperty("postedPaise");
  });
}, 120000);

it("serializes target-bed races, consumed orders and worker cursors on distinct PostgreSQL backends", async () => {
  await withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const admission = await import("../../src/server/admissions/commands");
    const care = await import("../../src/server/clinical/commands");
    const nursing = await import("../../src/server/nursing/commands");
    const room = await import("../../src/server/billing/room-charges");
    const { lockBillingAdmission } = await import("../../src/server/billing/commands");
    const f = await billingFixture();
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const admin = () => staffContext(f.admin, "synthetic-transfer");
    const nc = () => staffContext(f.nurse, "synthetic-transfer");
    const dc = () => staffContext(f.doctor, "synthetic-transfer");
    async function active() {
      const a = await f.episode();
      const start = new Date().toISOString(), ac = f.deskCtx();
      await admission.activateAdmission(ac, { admissionId: a.admissionId, arrivedAt: start, expectedVersion: 1, requestId: ac.requestId });
      await nursing.assignNurse(admin(), { admissionId: a.admissionId, nurseId: f.nurse.id, authority: "Synthetic authority", reason: "Synthetic assignment" });
      const sc = nc();
      const shift = await nursing.recordShift(sc, { admissionId: a.admissionId, startedAt: start, handover: "Synthetic incoming", requestId: sc.requestId });
      const oc = dc();
      const order = await care.orderTransfer(oc, { admissionId: a.admissionId, destinationCategory: "GENERAL", reason: "Synthetic move", requestId: oc.requestId });
      return { a, start, shift, order };
    }
    const first = await active(), second = await active();
    const target = await admission.createBed(admin(), { label: "Synthetic shared transfer target", category: "GENERAL", reason: "Synthetic fixture" });
    const spare = await admission.createBed(admin(), { label: "Synthetic competing target", category: "GENERAL", reason: "Synthetic fixture" });
    const T = new Date(Date.now() + 3600000);
    vi.spyOn(Date, "now").mockReturnValue(T.getTime() + 3600000);
    const ca = new Client({ connectionString: runtimeUrl }), cb = new Client({ connectionString: runtimeUrl });
    await Promise.all([ca.connect(), cb.connect()]);
    try {
      const pidA = (await ca.query("select pg_backend_pid() p")).rows[0].p;
      const pidB = (await cb.query("select pg_backend_pid() p")).rows[0].p;
      expect(pidA).not.toBe(pidB);
      const ta = drizzle(ca, { schema }), tb = drizzle(cb, { schema });
      const input = (v: typeof first, ctx: ReturnType<typeof nc>, bedId = target.id) => ({ admissionId: v.a.admissionId, transferOrderId: v.order.id, targetBedId: bedId, handover: { shiftId: v.shift.id, notes: "Synthetic actual transfer handover" }, transferredAt: T.toISOString(), requestId: ctx.requestId });
      // Database now() is transaction-start time: authoritative revision must follow
      // admission-lock serialization even when timestamp order is reversed.
      let earlierCommitted: { id: string } | undefined;
      await ta.transaction(async tx => {
        await tx.execute(sql`select now()`);
        const early = dc();
        earlierCommitted = await tb.transaction(other => care.orderTransferInTransaction(other, early, { admissionId: first.a.admissionId, destinationCategory: "GENERAL", reason: "Earlier committed transfer decision", requestId: early.requestId }));
        const late = dc();
        first.order = await care.orderTransferInTransaction(tx, late, { admissionId: first.a.admissionId, destinationCategory: "GENERAL", reason: "Latest serialized transfer decision", requestId: late.requestId });
      });
      const serialized = (await runtime.query("select id, signed_at, version from hims.transfer_orders where id=ANY($1::uuid[]) order by version", [[earlierCommitted!.id, first.order.id]])).rows;
      expect(serialized[1].version).toBe(serialized[0].version + 1);
      // Compare at PostgreSQL microsecond precision; pg's JavaScript Date truncates milliseconds.
      expect((await runtime.query("select latest.signed_at < earlier.signed_at reversed from hims.transfer_orders latest join hims.transfer_orders earlier on earlier.id=$1 where latest.id=$2", [earlierCommitted!.id, first.order.id])).rows[0].reversed).toBe(true);
      const obsolete = nc();
      await expect(admission.transferAdmission(obsolete, input({ ...first, order: earlierCommitted! }, obsolete))).rejects.toMatchObject({ code: "CONFLICT" });
      const x = nc(), y = nc();
      async function assertBlocked(pid: number) {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          blocked = (await runtime.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [pid])).rows[0]?.blocked === true;
          if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      }
      let targetContender: Promise<{ oldStayId: string; newStayId: string }> | undefined;
      await ta.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
        await lockBillingAdmission(tx, first.a.admissionId);
        await tx.execute(sql`select id from hims.beds where id=${target.id} for update`);
        targetContender = tb.transaction(tx => admission.transferAdmissionInTransaction(tx, y, input(second, y)));
        void targetContender.catch(() => {});
        await assertBlocked(pidB);
        await admission.transferAdmissionInTransaction(tx, x, input(first, x));
      });
      await expect(targetContender!).rejects.toMatchObject({ code: "CONFLICT" });
      const loser = second;
      const retry = nc(), competitor = nc();
      const consumed = await Promise.allSettled([ta.transaction(tx => admission.transferAdmissionInTransaction(tx, retry, input(loser, retry, spare.id))), tb.transaction(tx => admission.transferAdmissionInTransaction(tx, competitor, input(loser, competitor, spare.id)))]);
      expect(consumed.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(consumed.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
      // A waiting worker must reread the new stay after the transfer commits.
      const oc = dc();
      const newOrder = await care.orderTransfer(oc, { admissionId: loser.a.admissionId, destinationCategory: "GENERAL", reason: "Synthetic return", requestId: oc.requestId });
      const newTarget = await admission.createBed(admin(), { label: "Synthetic worker race target", category: "GENERAL", reason: "Synthetic fixture" });
      const next = { ...loser, order: newOrder };
      const move = nc();
      const T2 = new Date(T.getTime() + 1800000);
      let worker: Promise<bigint> | undefined;
      await ta.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
        await lockBillingAdmission(tx, loser.a.admissionId);
        worker = tb.transaction(async workerTx => {
          await lockBillingAdmission(workerTx, loser.a.admissionId);
          return room.reconcileRoomChargesInTransaction(workerTx, { admissionId: loser.a.admissionId, cutoff: new Date(T2.getTime() + 900000), actorContext: { actor: { type: "system", systemId: "room-charge" }, source: "room-worker", requestId: randomUUID() } });
        });
        void worker.catch(() => {});
        await assertBlocked(pidB);
        await admission.transferAdmissionInTransaction(tx, move, { ...input(next, move, newTarget.id), transferredAt: T2.toISOString() });
      });
      await worker;
      const stays = (await runtime.query("select * from hims.room_stays where admission_id=$1 order by started_at", [loser.a.admissionId])).rows;
      expect(stays).toHaveLength(3);
      expect(stays[1].ended_at.toISOString()).toBe(T2.toISOString());
      expect(stays[2].started_at.toISOString()).toBe(T2.toISOString());
      expect(stays[2].last_reconciled_at.toISOString()).toBe(new Date(T2.getTime() + 900000).toISOString());
      expect(stays[1].posted_paise).toBe("5001");
      expect(stays[2].posted_paise).toBe("2500");
      const past = nc();
      const oldOrder = dc();
      const authority = await care.orderTransfer(oldOrder, { admissionId: loser.a.admissionId, destinationCategory: "GENERAL", reason: "Synthetic backdated rejection", requestId: oldOrder.requestId });
      await expect(admission.transferAdmission(past, { ...input({ ...loser, order: authority }, past, target.id), transferredAt: T2.toISOString() })).rejects.toMatchObject({ code: "CONFLICT" });
      // Worker wins first: the blocked transfer must see its newly committed cursor and fail.
      const T3 = new Date(T2.getTime() + 1200000), moveAfterWorker = nc();
      let blockedMove: Promise<{ oldStayId: string; newStayId: string }> | undefined;
      await ta.transaction(async tx => {
        await lockBillingAdmission(tx, loser.a.admissionId);
        blockedMove = tb.transaction(tx => admission.transferAdmissionInTransaction(tx, moveAfterWorker, { ...input({ ...loser, order: authority }, moveAfterWorker, stays[0].bed_id), transferredAt: T3.toISOString() }));
        void blockedMove.catch(() => {});
        await assertBlocked(pidB);
        await room.reconcileRoomChargesInTransaction(tx, { admissionId: loser.a.admissionId, cutoff: new Date(T3.getTime() + 600000), actorContext: { actor: { type: "system", systemId: "room-charge" }, source: "room-worker", requestId: randomUUID() } });
      });
      await expect(blockedMove!).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await runtime.query("select count(*)::int n from hims.room_stays where admission_id=$1", [loser.a.admissionId])).rows[0].n).toBe(3);
    } finally { await Promise.all([ca.end(), cb.end()]); }
  });
}, 120000);
