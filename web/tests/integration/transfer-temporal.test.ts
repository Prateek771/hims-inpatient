import { afterEach, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as schema from "../../src/server/schema";
loadLocalEnvironment();
const originalUrl = process.env.DATABASE_URL;
const runtimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticTemporalOnlySecretAtLeast32Characters12345";
afterEach(() => { process.env.DATABASE_URL = originalUrl; vi.restoreAllMocks(); });

async function temporalFixture(runtime: Client) {
  const admission = await import("../../src/server/admissions/commands");
  const care = await import("../../src/server/clinical/commands");
  const nursing = await import("../../src/server/nursing/commands");
  const f = await billingFixture();
  await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
  const admin = () => staffContext(f.admin, "synthetic-transfer-temporal");
  const dc = () => staffContext(f.doctor, "synthetic-transfer-temporal");
  const nc = () => staffContext(f.nurse, "synthetic-transfer-temporal");
  async function active() {
    const episode = await f.episode(), start = new Date().toISOString(), ac = f.deskCtx();
    await admission.activateAdmission(ac, { admissionId: episode.admissionId, arrivedAt: start, expectedVersion: 1, requestId: ac.requestId });
    await nursing.assignNurse(admin(), { admissionId: episode.admissionId, nurseId: f.nurse.id, authority: "Synthetic administrator schedule", reason: "Synthetic temporal case" });
    const sc = nc();
    const shift = await nursing.recordShift(sc, { admissionId: episode.admissionId, startedAt: start, handover: "Synthetic received", requestId: sc.requestId });
    const oc = dc();
    const order = await care.orderTransfer(oc, { admissionId: episode.admissionId, destinationCategory: "GENERAL", reason: "Synthetic authorized move", requestId: oc.requestId });
    const source = (await runtime.query("select * from hims.room_stays where admission_id=$1", [episode.admissionId])).rows[0];
    return { episode, shift, order, source };
  }
  const spare = await admission.createBed(admin(), { label: "Synthetic temporal spare", category: "GENERAL", reason: "Synthetic temporal inventory" });
  const input = (which: Awaited<ReturnType<typeof active>>, targetBedId: string, T: Date, ctx: ReturnType<typeof nc>) => ({ admissionId: which.episode.admissionId, transferOrderId: which.order.id, targetBedId, handover: { shiftId: which.shift.id, notes: "Actual synthetic temporal handover" }, transferredAt: T.toISOString(), requestId: ctx.requestId });
  return { f, admission, nursing, admin, nc, active, spare, input };
}

it("rejects target overlap and uncleaned vacancy without changing history, then accepts recorded cleaning", async () => {
  await withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const f = await temporalFixture(runtime), a = await f.active(), b = await f.active();
    const tooEarly=new Date();await new Promise(resolve=>setTimeout(resolve,20));const exit=new Date();
    const leave = f.nc();
    await f.admission.transferAdmission(leave, f.input(a, f.spare.id, exit, leave));
    async function bState() {
      return {
        episode: (await runtime.query("select * from hims.admissions where id=$1", [b.episode.admissionId])).rows,
        stays: (await runtime.query("select * from hims.room_stays where admission_id=$1", [b.episode.admissionId])).rows,
        hold: (await runtime.query("select * from hims.bed_holds where admission_id=$1", [b.episode.admissionId])).rows,
        charges: (await runtime.query("select * from hims.charges where admission_id=$1", [b.episode.admissionId])).rows,
        transfers: (await runtime.query("select * from hims.admission_transfers where admission_id=$1", [b.episode.admissionId])).rows,
      };
    }
    const before = await bState(), move = f.nc();
    await expect(f.admission.transferAdmission(move, f.input(b, a.source.bed_id, tooEarly, move))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await bState()).toEqual(before);
    // Physical non-overlap alone is insufficient until actual housekeeping completes.
    const equal = f.nc();
    await expect(f.admission.transferAdmission(equal,f.input(b,a.source.bed_id,exit,equal))).rejects.toMatchObject({code:"CONFLICT"});
    expect(await bState()).toEqual(before);
    const {completeBedTurnover}=await import("../../src/server/discharge/commands");
    const turnover=(await runtime.query("select id from hims.bed_turnovers where stay_id=$1",[a.source.id])).rows[0];const cleanedAt=new Date(),clean=f.admin();
    await completeBedTurnover(clean,{turnoverId:turnover.id,completedAt:cleanedAt.toISOString(),evidence:"Actual synthetic housekeeping confirmation",requestId:clean.requestId});
    const result = await f.admission.transferAdmission(equal, f.input(b, a.source.bed_id, cleanedAt, equal));
    const next = (await runtime.query("select * from hims.room_stays where id=$1", [result.newStayId])).rows[0];
    expect(next.started_at.toISOString()).toBe(cleanedAt.toISOString());
    expect((await runtime.query("select count(*)::int n from hims.room_stays x join hims.room_stays y on x.bed_id=y.bed_id and x.id<y.id where tstzrange(x.started_at,x.ended_at,'[)') && tstzrange(y.started_at,y.ended_at,'[)')")).rows[0].n).toBe(0);
  });
}, 120000);

it("prevents closing attendance before a signed transfer and rejects transfer after an already recorded early close", async () => {
  await withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const f = await temporalFixture(runtime), a = await f.active(), b = await f.active();
    const base = Date.now(), T = new Date(base + 7200000), early = new Date(base + 5400000);
    vi.spyOn(Date, "now").mockReturnValue(base + 10800000);
    const move = f.nc();
    await f.admission.transferAdmission(move, f.input(a, f.spare.id, T, move));
    await expect(f.nursing.endShift(f.nc(), { shiftId: a.shift.id, endedAt: early.toISOString(), handover: "Synthetic impossible early close" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1", [a.shift.id])).rows[0].n).toBe(0);
    await f.nursing.endShift(f.nc(), { shiftId: a.shift.id, endedAt: T.toISOString(), handover: "Exact transfer attendance boundary" });
    await f.nursing.endShift(f.nc(), { shiftId: b.shift.id, endedAt: early.toISOString(), handover: "Actual earlier shift end" });
    const late = f.nc();
    await expect(f.admission.transferAdmission(late, f.input(b, a.source.bed_id, T, late))).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await runtime.query("select count(*)::int n from hims.admission_transfers where admission_id=$1", [b.episode.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.admission_transfers t join hims.nursing_shift_ends e on e.shift_id=t.shift_id where t.transferred_at>e.ended_at")).rows[0].n).toBe(0);
  });
}, 120000);

it("guards physical-bed temporal ranges on separate database connections, including exact adjacency", async () => {
  await withTestDatabase(async ({ runtime, owner }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const f = await temporalFixture(runtime), a = await f.active();
    const pending = await f.f.episode(), next = await f.f.episode();
    const start = new Date(Date.now() + 3600000), end = new Date(start.getTime() + 3600000);
    await expect(runtime.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [pending.admissionId, a.source.bed_id, f.f.room.id, start])).rejects.toMatchObject({ code: "23P01" });
    // Exercise the actual additive migration preflight against inconsistent synthetic
    // history, with transactional DDL rollback restoring every existing guard afterward.
    const migration = await readFile(new URL("../../drizzle/0015_physical_bed_timeline.sql", import.meta.url), "utf8");
    await owner.query("begin");
    try {
      await owner.query("drop trigger physical_bed_timeline_guard on hims.room_stays");
      await owner.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [pending.admissionId, a.source.bed_id, f.f.room.id, start]);
      await expect(owner.query(migration)).rejects.toThrow("Existing physical bed occupancy overlaps");
    } finally { await owner.query("rollback"); }
    expect((await runtime.query("select count(*)::int n from hims.room_stays where admission_id=$1", [pending.admissionId])).rows[0].n).toBe(0);
    const ca = new Client({ connectionString: runtimeUrl }), cb = new Client({ connectionString: runtimeUrl });
    await Promise.all([ca.connect(), cb.connect()]);
    try {
      const pa = (await ca.query("select pg_backend_pid() p")).rows[0].p, pb = (await cb.query("select pg_backend_pid() p")).rows[0].p;
      expect(pa).not.toBe(pb);
      await ca.query("begin");
      await ca.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,ended_at,last_reconciled_at) values($1,$2,$3,$4,$5,$4)", [pending.admissionId, f.spare.id, f.f.room.id, start, end]);
      const waiting = cb.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [next.admissionId, f.spare.id, f.f.room.id, new Date(start.getTime() + 1800000)]);
      void waiting.catch(() => {});
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        blocked = (await runtime.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [pb])).rows[0]?.blocked === true;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await ca.query("commit");
      await expect(waiting).rejects.toMatchObject({ code: "23P01" });
      await cb.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [next.admissionId, f.spare.id, f.f.room.id, end]);
      expect((await runtime.query("select count(*)::int n from hims.room_stays where bed_id=$1", [f.spare.id])).rows[0].n).toBe(2);
      // A mere SELECT FOR UPDATE would allow a repeatable-read writer to inspect an
      // obsolete interval snapshot. The guard's unchanged-value bed update rejects it.
      const rrBed = await f.admission.createBed(f.admin(), { label: "Synthetic repeatable-read timeline", category: "GENERAL", reason: "Synthetic native temporal guard" });
      const rrFirst = await f.f.episode(), rrNext = await f.f.episode();
      await ca.query("begin isolation level repeatable read");
      await ca.query("select id from hims.beds where id=$1", [rrBed.id]);
      await cb.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,ended_at,last_reconciled_at) values($1,$2,$3,$4,$5,$4)", [rrFirst.admissionId, rrBed.id, f.f.room.id, start, end]);
      await expect(ca.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [rrNext.admissionId, rrBed.id, f.f.room.id, new Date(start.getTime() + 1800000)])).rejects.toMatchObject({ code: "40001" });
      await ca.query("rollback");
      expect((await runtime.query("select count(*)::int n from hims.room_stays where bed_id=$1", [rrBed.id])).rows[0].n).toBe(1);
    } finally { await ca.query("rollback"); await Promise.all([ca.end(), cb.end()]); }
  });
}, 120000);

it("serializes transfer versus shift closure in both orders without placing signed care outside attendance", async () => {
  await withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = runtimeUrl;
    const f = await temporalFixture(runtime), a = await f.active(), b = await f.active();
    const otherBed = await f.admission.createBed(f.admin(), { label: "Synthetic closure race target", category: "GENERAL", reason: "Synthetic temporal contention" });
    const base = Date.now(), T = new Date(base + 7200000), early = new Date(base + 5400000);
    vi.spyOn(Date, "now").mockReturnValue(base + 10800000);
    const ca = new Client({ connectionString: runtimeUrl }), cb = new Client({ connectionString: runtimeUrl });
    await Promise.all([ca.connect(), cb.connect()]);
    try {
      const pa = (await ca.query("select pg_backend_pid() p")).rows[0].p, pb = (await cb.query("select pg_backend_pid() p")).rows[0].p;
      expect(pa).not.toBe(pb);
      const ta = drizzle(ca, { schema }), tb = drizzle(cb, { schema });
      async function assertBlocked() {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          blocked = (await runtime.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [pb])).rows[0]?.blocked === true;
          if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      }
      let closing: Promise<{ id: string }> | undefined;
      await ta.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
        await tx.execute(sql`select id from hims.admissions where id=${a.episode.admissionId} for update`);
        closing = tb.transaction(other => f.nursing.endShiftInTransaction(other, f.nc(), { shiftId: a.shift.id, endedAt: early.toISOString(), handover: "Concurrent early closure" }));
        void closing.catch(() => {});
        await assertBlocked();
        const move = f.nc();
        await f.admission.transferAdmissionInTransaction(tx, move, f.input(a, f.spare.id, T, move));
      });
      await expect(closing!).rejects.toMatchObject({ code: "VALIDATION" });
      let moving: Promise<{ oldStayId: string; newStayId: string }> | undefined;
      await ta.transaction(async tx => {
        await tx.execute(sql`select id from hims.admissions where id=${b.episode.admissionId} for update`);
        const move = f.nc();
        moving = tb.transaction(other => f.admission.transferAdmissionInTransaction(other, move, f.input(b, otherBed.id, T, move)));
        void moving.catch(() => {});
        await assertBlocked();
        await f.nursing.endShiftInTransaction(tx, f.nc(), { shiftId: b.shift.id, endedAt: early.toISOString(), handover: "Actual earlier close commits first" });
      });
      await expect(moving!).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await runtime.query("select count(*)::int n from hims.admission_transfers where admission_id=$1", [b.episode.admissionId])).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1", [a.shift.id])).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.admission_transfers t join hims.nursing_shift_ends e on e.shift_id=t.shift_id where t.transferred_at>e.ended_at")).rows[0].n).toBe(0);
    } finally { await Promise.all([ca.end(), cb.end()]); }
  });
}, 120000);
