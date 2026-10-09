import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
loadLocalEnvironment();
const appUrl = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = appUrl; });
const runtimeUrl = getTestDatabaseConfig().runtimeUrl;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticBillingOnlySecretAtLeast32Characters12345";
describe("billing with actual PostgreSQL transactions", () => {
  it("separates cash identities, retries and allocation; activates only with explicit policy", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const { billingFixture } = await import("../support/billing-fixture");
      const { recordReceipt, allocateDeposit, refundReceipt, getBill, getDepositSummary, billingWorkspace } = await import("../../src/server/billing/commands");
      const { activateAdmission, cancelAdmission } = await import("../../src/server/admissions/commands");
      const { staffContext } = await import("../../src/server/access");
      const f = await billingFixture();
      const a = await f.episode();
      const now = new Date().toISOString();
      const activation = {
        admissionId: a.admissionId, arrivedAt: now, expectedVersion: 1, requestId: randomUUID()
      };
      await expect(activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, activation)).rejects.toMatchObject({ code: "PRECONDITION" });
      await f.setting({
        type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "500"
      });
      await expect(activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, activation)).rejects.toMatchObject({ code: "PRECONDITION" });
      const ctx = f.ctx();
      const input = {
        admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "30000", mode: "CASH", channel: "Synthetic cashier book 1", sourceReference: "0001", reference: "Staff receipt 0001", requestId: ctx.requestId
      };
      const receipts = await Promise.all([recordReceipt(ctx, input), recordReceipt(ctx, input)]);
      expect(receipts[0].id).toBe(receipts[1].id);
      await expect(recordReceipt(ctx, { ...input, amountPaise: "30001" })).rejects.toMatchObject({ code: "CONFLICT" });
      const newKey = f.ctx();
      expect((await recordReceipt(newKey, { ...input, requestId: newKey.requestId })).id).toBe(receipts[0].id);
      await expect(recordReceipt(f.ctx(), { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
      const conflict = f.ctx();
      await expect(recordReceipt(conflict, { ...input, amountPaise: "1", requestId: conflict.requestId })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await getDepositSummary(f.deskCtx(), a.admissionId)).paidPaise).toBe(30000n);
      await expect(activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, activation)).rejects.toMatchObject({ code: "PRECONDITION" });
      expect((await runtime.query("select status from hims.admissions where id=$1", [a.admissionId])).rows[0].status).toBe("PENDING");
      expect((await runtime.query("select count(*)::int n from hims.room_stays")).rows[0].n).toBe(0);
      const topCtx = f.deskCtx();
      await recordReceipt(topCtx, {
        ...input, kind: "TOP_UP", amountPaise: "20000", sourceReference: "0002", reference: "Staff receipt 0002", requestId: topCtx.requestId
      });
      await expect(activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, { ...activation, exceptionId: randomUUID() })).rejects.toMatchObject({ code: "PRECONDITION" });
      for (const arrivedAt of [new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 30000).toISOString()]) {
        const occupancy = f.deskCtx();
        await expect(activateAdmission(occupancy, { ...activation, arrivedAt, requestId: occupancy.requestId })).rejects.toMatchObject({ code: "VALIDATION" });
      }
      expect((await runtime.query("select count(*)::int n from hims.room_stays")).rows[0].n).toBe(0);
      await expect(activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, { ...activation, expectedVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
      const activated = await Promise.all([activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, activation), activateAdmission({ ...f.deskCtx(), requestId: activation.requestId }, activation)]);
      expect(activated[0]).toEqual(activated[1]);
      expect((await runtime.query("select count(*)::int n from hims.room_stays")).rows[0].n).toBe(1);
      const wrong = staffContext(f.nurse, "synthetic");
      await expect(recordReceipt(wrong, { ...input, requestId: wrong.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getBill(f.deskCtx(), a.admissionId, new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getBill(f.ctx(), randomUUID(), new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
      const deposit = await getDepositSummary(f.deskCtx(), a.admissionId);
      expect(deposit).not.toHaveProperty("receipts");
      expect(deposit).not.toHaveProperty("clinicianAssessment");
      const refund = f.ctx();
      await expect(refundReceipt(refund, {
        receiptId: receipts[0].id, amountPaise: "1", reason: "Synthetic refund", requestId: refund.requestId
      })).rejects.toMatchObject({ code: "PRECONDITION" });
      const worker = { actor: { type: "system" as const, systemId: "room-charge" as const }, source: "worker", requestId: randomUUID() };
      await expect(recordReceipt(worker, { ...input, requestId: worker.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const insurer = f.ctx();
      await recordReceipt(insurer, {
        ...input, party: "INSURER", kind: "PAYMENT", amountPaise: "1000", sourceReference: "0003", requestId: insurer.requestId
      });
      const before = await getBill(f.ctx(), a.admissionId, new Date(now));
      expect(before.patientCashPaise).toBe(50000n);
      expect(before.insurerCashPaise).toBe(1000n);
      expect(before).not.toHaveProperty("phone");
      expect(before).not.toHaveProperty("clinicianAssessment");
      await expect(allocateDeposit(f.ctx(), {
        receiptId: receipts[0].id, amountPaise: "30000", reason: "Synthetic allocation", requestId: randomUUID()
      })).rejects.toMatchObject({ code: "VALIDATION" });
      const cancelled = await f.episode();
      const cancelledReceipt = f.ctx();
      await recordReceipt(cancelledReceipt, { ...input, admissionId: cancelled.admissionId, amountPaise: "250", sourceReference: "CANCELLED-001", reference: "Synthetic cancelled pending deposit", requestId: cancelledReceipt.requestId });
      await cancelAdmission(f.deskCtx(), { admissionId: cancelled.admissionId, reason: "Synthetic pending cancellation after deposit" });
      expect((await billingWorkspace(f.ctx())).find((row) => row.id === cancelled.admissionId)).toMatchObject({ status: "CANCELLED", heldCashPaise: 250n, requiresCashReview: true });
      const cancelledBill = await getBill(f.ctx(), cancelled.admissionId);
      expect(cancelledBill.status).toBe("CANCELLED");
      expect(cancelledBill.unallocatedDepositPaise).toBe(250n);
      expect(cancelledBill.charges).toHaveLength(0);
      expect((await runtime.query("select admitted_at from hims.admissions where id=$1", [cancelled.admissionId])).rows[0].admitted_at).toBeNull();
      await owner.query("update hims.staff_user set banned=true where id=$1", [f.cashier.id]);
      await expect(getBill(f.ctx(), a.admissionId, new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }, 120000);
  it("pins server rates, preserves immutable history and serializes reversals/allocations", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const { billingFixture } = await import("../support/billing-fixture");
      const { postCharge, postChargeInTransaction, resolveBillableRate, listBillableItems, finalizeCharge, reverseCharge, allocateDeposit, cancelAllocation, recordReceipt, getBill } = await import("../../src/server/billing/commands");
      const { activateAdmission } = await import("../../src/server/admissions/commands");
      const { withTransaction } = await import("../../src/server/db");
      const { admissions } = await import("../../src/server/admissions/schema");
      const f = await billingFixture();
      await f.setting({
        type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0"
      });
      const a = await f.episode();
      const ctx = f.deskCtx();
      await activateAdmission(ctx, {
        admissionId: a.admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: ctx.requestId
      });
      const item = await f.setting({
        type: "billable-item", code: "TEST_A", name: "Synthetic test", category: "lab", department: "LAB", unit: "test", quantityScale: 0, amount: "120000", active: true
      });
      const event = randomUUID();
      const data = {
        admissionId: a.admissionId, sourceEventId: event, category: "lab", itemId: "TEST_A", quantity: "1", unit: "test", tariffVersionId: item.id, status: "PENDING"
      };
      await expect(postCharge(f.ctx(), data)).rejects.toMatchObject({ code: "PRECONDITION" });
      await expect(postCharge(f.ctx(), { ...data, amountPaise: "1" })).rejects.toThrow();
      const backendIds = new Set<number>();
      const post = (input = data) => withTransaction(async (tx) => {
        const backend = await tx.execute(sql `select pg_backend_pid() as pid`);
        backendIds.add(Number(backend.rows[0].pid));
        await tx.select().from(admissions).where(eq(admissions.id, a.admissionId)).for("update");
        return postChargeInTransaction(tx, f.ctx(), input);
      });
      const posted = await Promise.all([post(), post()]);
      expect(backendIds.size).toBe(2);
      expect(posted[0].id).toBe(posted[1].id);
      const doctorCtx = { ...f.ctx(), actor: { type: "staff" as const, staffId: f.doctor.id } };
      expect(await listBillableItems(doctorCtx, "lab")).toMatchObject([{ itemId: "TEST_A", tariffVersionId: item.id }]);
      const doctorOrder = { ...data, sourceEventId: randomUUID() };
      const doctorPending = await withTransaction((tx) => postChargeInTransaction(tx, doctorCtx, doctorOrder));
      expect(doctorPending.initialStatus).toBe("PENDING");
      await expect(withTransaction((tx) => postChargeInTransaction(tx, doctorCtx, { ...doctorOrder, status: "FINAL" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await getBill(f.ctx(), a.admissionId)).pendingPaise).toBe(24000000n);
      await expect(post({ ...data, quantity: "2" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(withTransaction((tx) => resolveBillableRate(tx, {
        itemId: "TEST_A", eventKind: "medicine", unit: "test", quantity: "1"
      }))).rejects.toMatchObject({ code: "PRECONDITION" });
      await expect(withTransaction((tx) => resolveBillableRate(tx, {
        itemId: "UNKNOWN", eventKind: "lab", unit: "test", quantity: "1"
      }))).rejects.toMatchObject({ code: "PRECONDITION" });
      await expect(withTransaction((tx) => resolveBillableRate(tx, {
        itemId: "TEST_A", eventKind: "lab", unit: "ml", quantity: "1"
      }))).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(withTransaction((tx) => postChargeInTransaction(tx, { ...f.ctx(), actor: { type: "staff", staffId: f.nurse.id } }, { ...data, sourceEventId: randomUUID() }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(post({ ...data, sourceEventId: randomUUID(), quantity: "0.5" })).rejects.toMatchObject({ code: "VALIDATION" });
      await f.setting({ ...item.payload, amount: "130000" });
      // Public clients cannot select a historic price; a retry preserves the already-pinned source.
      expect((await post()).amountPaise).toBe(12000000n);
      await expect(post({ ...data, sourceEventId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
      const fc = f.ctx();
      await expect(finalizeCharge(fc, { chargeId: posted[0].id, requestId: fc.requestId })).rejects.toMatchObject({ code: "PRECONDITION" });
      const adminFinal = { ...f.ctx(), actor: { type: "staff" as const, staffId: f.admin.id } };
      await expect(finalizeCharge(adminFinal, { chargeId: posted[0].id, requestId: adminFinal.requestId })).rejects.toMatchObject({ code: "PRECONDITION" });
      expect((await runtime.query("select count(*)::int n from hims.charge_finalizations")).rows[0].n).toBe(0);
      const finalizeSource = () => withTransaction((tx) => postChargeInTransaction(tx, { ...f.ctx(), actor: { type: "staff", staffId: f.lab.id } }, { ...data, status: "FINAL" }));
      const finalized = await Promise.all([finalizeSource(), finalizeSource()]);
      expect(finalized[0].id).toBe(posted[0].id);
      expect(finalized[1].id).toBe(posted[0].id);
      expect((await runtime.query("select count(*)::int n from hims.charge_finalizations where charge_id=$1", [posted[0].id])).rows[0].n).toBe(1);
      expect((await runtime.query("select count(*)::int n from hims.charges")).rows[0].n).toBe(2);
      const reversal = f.ctx();
      await reverseCharge(reversal, {
        chargeId: posted[0].id, amountPaise: "500000", reason: "Synthetic return correction", requestId: reversal.requestId
      });
      const bill = await getBill(f.ctx(), a.admissionId, new Date());
      expect(bill.netPaise).toBe(11500000n);
      const labFinal = await withTransaction((tx) => postChargeInTransaction(tx, { ...f.ctx(), actor: { type: "staff", staffId: f.lab.id } }, { ...doctorOrder, status: "FINAL" }));
      expect(labFinal.id).toBe(doctorPending.id);
      expect(labFinal.amountPaise).toBe(12000000n);
      expect((await getBill(f.ctx(), a.admissionId)).pendingPaise).toBe(0n);
      const race = await Promise.allSettled([1, 2].map(() => { const c = f.ctx(); return reverseCharge(c, {
        chargeId: posted[0].id, amountPaise: "6000000", reason: "Synthetic concurrent reversal", requestId: c.requestId
      }); }));
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(race.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "PRECONDITION" } });
      const rc = f.ctx();
      const receipt = await recordReceipt(rc, {
        admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "100000", mode: "UPI", channel: "Synthetic UPI account", sourceReference: "synthetic-bank-001", reference: "Synthetic manual UPI", requestId: rc.requestId
      });
      const allocate = () => { const c = f.ctx(); return allocateDeposit(c, {
        receiptId: receipt.id, amountPaise: "60000", reason: "Synthetic bill allocation", requestId: c.requestId
      }); };
      const allocations = await Promise.allSettled([allocate(), allocate()]);
      expect(allocations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const paid = await getBill(f.ctx(), a.admissionId, new Date());
      expect(paid.patientCashPaise).toBe(100000n);
      expect(paid.depositAllocatedPaise).toBe(60000n);
      expect(paid.unallocatedDepositPaise).toBe(40000n);
      expect(paid.billPaidPaise).toBe(60000n);
      const allocated = allocations.find((r) => r.status === "fulfilled");
      if (allocated?.status !== "fulfilled")
        throw new Error("Expected allocation");
      const cancel = f.ctx();
      await expect(cancelAllocation(cancel, { allocationId: allocated.value.id, reason: "Synthetic cancellation", requestId: cancel.requestId })).rejects.toMatchObject({ code: "PRECONDITION" });
      for (const table of ["charges", "receipts", "charge_reversals", "receipt_allocations", "charge_finalizations", "billing_requests"]) {
        await expect(runtime.query(`update hims.${table} set id=id`)).rejects.toMatchObject({ code: "42501" });
        await expect(runtime.query(`delete from hims.${table}`)).rejects.toMatchObject({ code: "42501" });
      }
      await owner.query("update hims.staff_user set role='NURSE' where id=$1", [f.cashier.id]);
      await expect(reverseCharge(f.ctx(), {
        chargeId: posted[0].id, amountPaise: "1", reason: "Synthetic role denial", requestId: f.ctx().requestId
      })).rejects.toThrow();
    });
  }, 120000);
  it("recovers room cursor atomically, snapshots prices and survives concurrent workers/final cutoffs", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const { billingFixture } = await import("../support/billing-fixture");
      const { activateAdmission } = await import("../../src/server/admissions/commands");
      const { getBill, reconcileBill } = await import("../../src/server/billing/commands");
      const { postDueRoomCharges } = await import("../../src/server/billing/room-worker");
      const f = await billingFixture();
      await f.setting({
        type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0"
      });
      const a = await f.episode();
      const start = new Date(Date.now() - 7200000);
      // Explicit synthetic historic reservation, not a production backdate command.
      await owner.query("update hims.admissions set registered_at=$1 where id=$2", [new Date(start.getTime() - 60000), a.admissionId]);
      await owner.query("update hims.bed_holds set held_at=$1 where admission_id=$2", [new Date(start.getTime() - 60000), a.admissionId]);
      const c = f.deskCtx();
      await activateAdmission(c, {
        admissionId: a.admissionId, arrivedAt: start.toISOString(), expectedVersion: 1, requestId: c.requestId
      });
      const financialState = async () => (await runtime.query("select a.bill_revision,s.last_reconciled_at,s.posted_paise,(select count(*)::int from hims.charges where admission_id=a.id) charge_count from hims.admissions a join hims.room_stays s on s.admission_id=a.id where a.id=$1", [a.admissionId])).rows;
      const unchanged = await financialState();
      const future = new Date(Date.now() + 30000);
      await expect(reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: future.toISOString() })).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await financialState()).toEqual(unchanged);
      await expect(postDueRoomCharges(future)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await financialState()).toEqual(unchanged);
      await expect(getBill(f.ctx(), a.admissionId, future)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await financialState()).toEqual(unchanged);
      const half = new Date(start.getTime() + 1800000), hour = new Date(start.getTime() + 3600000), twoHours = new Date(start.getTime() + 7200000);
      const estimate = await getBill(f.ctx(), a.admissionId, hour);
      expect(estimate.netPaise).toBe(0n);
      expect(estimate.unpostedRoomPaise).toBe(10001n);
      expect((await runtime.query("select count(*)::int n from hims.charges")).rows[0].n).toBe(0);
      await postDueRoomCharges(half);
      await f.setting({
        type: "tariff", category: "GENERAL", amount: "999", basis: "hour", rounding: "started-unit", graceMinutes: 0
      });
      await Promise.all([postDueRoomCharges(hour), postDueRoomCharges(hour)]);
      expect((await getBill(f.ctx(), a.admissionId, hour)).netPaise).toBe(10001n);
      expect((await runtime.query("select count(*)::int n from hims.charges")).rows[0].n).toBe(2);
      await owner.query("CREATE FUNCTION hims.synthetic_fail_billing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='billing.room-reconciled' THEN RAISE EXCEPTION 'Synthetic room audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_billing_audit_failure BEFORE INSERT ON hims.audit_events FOR EACH ROW EXECUTE FUNCTION hims.synthetic_fail_billing_audit()");
      try {
        await expect(postDueRoomCharges(twoHours)).rejects.toThrow();
      }
      finally {
        await owner.query("DROP TRIGGER synthetic_billing_audit_failure ON hims.audit_events; DROP FUNCTION hims.synthetic_fail_billing_audit()");
      }
      expect((await getBill(f.ctx(), a.admissionId, twoHours)).netPaise).toBe(10001n);
      await Promise.all([postDueRoomCharges(twoHours), reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: twoHours.toISOString() })]);
      const final = await getBill(f.ctx(), a.admissionId, twoHours);
      expect(final.netPaise).toBe(20002n);
      expect(final.unpostedRoomPaise).toBe(0n);
      expect(final.revision).toBeGreaterThan(1);
      await expect(reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: half.toISOString() })).rejects.toMatchObject({ code: "CONFLICT" });
      const rows = (await runtime.query("select last_reconciled_at,posted_paise from hims.room_stays where admission_id=$1", [a.admissionId])).rows;
      expect(rows[0].last_reconciled_at.toISOString()).toBe(twoHours.toISOString());
      expect(rows[0].posted_paise).toBe("20002");
      const current = new Date();
      await reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: current.toISOString() });
      expect(await postDueRoomCharges(current)).toBe(0n);
      expect((await getBill(f.ctx(), a.admissionId, current)).unpostedRoomPaise).toBe(0n);
    });
  }, 120000);
  it("blocks ambiguous/absent policy and insurer cash as patient deposit; uses exact transfer segments", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const { billingFixture } = await import("../support/billing-fixture");
      const { activateAdmission } = await import("../../src/server/admissions/commands");
      const { recordReceipt, getBill, getDepositSummary, reconcileBill, resolveBillableRate, listBillableItems, postChargeInTransaction, reverseChargeInTransaction } = await import("../../src/server/billing/commands");
      const { withTransaction } = await import("../../src/server/db");
      const f = await billingFixture();
      await f.setting({
        type: "deposit", category: "GENERAL", route: "insured", requirement: "required", amount: "500"
      });
      const a = await f.episode("INSURED");
      const start = new Date(Date.now() - 10800000);
      await owner.query("update hims.admissions set registered_at=$1 where id=$2", [new Date(start.getTime() - 60000), a.admissionId]);
      await owner.query("update hims.bed_holds set held_at=$1 where admission_id=$2", [new Date(start.getTime() - 60000), a.admissionId]);
      const receiptDetails = {
        admissionId: a.admissionId, party: "INSURER", kind: "PAYMENT", amountPaise: "60000", mode: "BANK", channel: "Synthetic insurer account", sourceReference: "001", reference: "Synthetic partial insurer receipt"
      };
      const ic = f.ctx();
      await recordReceipt(ic, { ...receiptDetails, requestId: ic.requestId });
      const activate = () => { const c = f.deskCtx(); return activateAdmission(c, {
        admissionId: a.admissionId, arrivedAt: start.toISOString(), expectedVersion: 1, requestId: c.requestId
      }); };
      await expect(activate()).rejects.toMatchObject({ code: "PRECONDITION" });
      expect((await getDepositSummary(f.deskCtx(), a.admissionId)).paidPaise).toBe(0n);
      const first = f.ctx(), second = f.ctx();
      const patientDetails = {
        ...receiptDetails, party: "PATIENT", kind: "DEPOSIT", amountPaise: "50000", mode: "CASH", channel: "Synthetic cash book", sourceReference: "001", reference: "Synthetic patient deposit"
      };
      const paymentRace = await Promise.all([recordReceipt(first, { ...patientDetails, requestId: first.requestId }), recordReceipt(second, { ...patientDetails, requestId: second.requestId })]);
      expect(paymentRace[0].id).toBe(paymentRace[1].id);
      const otherBook = f.ctx();
      await recordReceipt(otherBook, {
        ...patientDetails, channel: "Another synthetic cash book", amountPaise: "1", requestId: otherBook.requestId
      });
      await expect(f.setting({
        type: "tariff", category: "GENERAL", amount: "100", basis: "hour", rounding: "exact", graceMinutes: 10
      })).rejects.toThrow();
      // Simulate a pre-existing nonzero legacy payload without assigning it invented semantics.
      await owner.query("insert into hims.setting_versions(hospital_id,kind,version,payload,actor_type,actor_id,reason) select hospital_id,'tariff',version+1,jsonb_set(payload,'{graceMinutes}','10'),'staff',actor_id,'Synthetic legacy ambiguity' from hims.setting_versions where id=$1", [f.room.id]);
      await expect(activate()).rejects.toMatchObject({ code: "PRECONDITION" });
      // The fixture helper's cached counter intentionally rejects the stale edit; explicit refresh follows.
      await expect(f.setting({
        type: "tariff", category: "GENERAL", amount: "100.01", basis: "hour", rounding: "exact", graceMinutes: 0
      })).rejects.toMatchObject({ code: "CONFLICT" });
      const { saveSetting, listSettings } = await import("../../src/server/settings");
      const latest = (await listSettings(f.ah)).versions.filter((v) => v.kind === "tariff").reduce((n, v) => Math.max(n, v.version), 0);
      const replacement = await saveSetting(f.ah, { expectedVersion: latest, reason: "Synthetic explicit zero grace", value: {
          type: "tariff", category: "GENERAL", amount: "100.01", basis: "hour", rounding: "exact", graceMinutes: 0
        } });
      const { postDueRoomCharges } = await import("../../src/server/billing/room-worker");
      await Promise.all([activate(), postDueRoomCharges(start)]);
      expect((await runtime.query("select count(*)::int n from hims.charges")).rows[0].n).toBe(0);
      const [stay] = (await runtime.query("select * from hims.room_stays where admission_id=$1", [a.admissionId])).rows;
      const boundary = new Date(stay.started_at.getTime() + 3600000);
      await reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: boundary.toISOString() });
      const newPrice = await saveSetting(f.ah, { expectedVersion: replacement.version, reason: "Synthetic transfer tariff", value: {
          type: "tariff", category: "GENERAL", amount: "999", basis: "hour", rounding: "exact", graceMinutes: 0
        } });
      // Synthetic future-transfer source fixture: exact close/open at T, composed in a single transaction.
      await owner.query("begin");
      try {
        await owner.query("update hims.room_stays set ended_at=$1 where id=$2", [boundary, stay.id]);
        await owner.query("insert into hims.room_stays(admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values($1,$2,$3,$4,$4)", [a.admissionId, stay.bed_id, newPrice.id, boundary]);
        await owner.query("commit");
      }
      catch (error) {
        await owner.query("rollback");
        throw error;
      }
      const cutoff = new Date(boundary.getTime() + 3600000);
      await reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: cutoff.toISOString() });
      const bill = await getBill(f.ctx(), a.admissionId, cutoff);
      expect(bill.netPaise).toBe(109901n);
      expect(bill.insurerCashPaise).toBe(60000n);
      expect(bill.patientCashPaise).toBe(50001n);
      expect(bill.payerResponsibility).toBe("UNAVAILABLE");
      const item = await saveSetting(f.ah, { expectedVersion: newPrice.version, reason: "Synthetic inactive item", value: {
          type: "billable-item", code: "INACTIVE", name: "Synthetic inactive medicine", category: "medicine", department: "PHARMACY", unit: "tablet", quantityScale: 0, amount: "2", active: false
        } });
      await expect(withTransaction((tx) => resolveBillableRate(tx, {
        itemId: "INACTIVE", eventKind: "medicine", unit: "tablet", quantity: "1"
      }))).rejects.toMatchObject({ code: "PRECONDITION" });
      await expect(saveSetting(f.ah, { expectedVersion: item.version, reason: "Synthetic wrong department", value: {
          ...item.payload, active: true, department: "LAB", amount: "2"
        } })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(saveSetting(f.ah, { expectedVersion: item.version, reason: "Synthetic unit identity change", value: {
          ...item.payload, active: true, unit: "strip", amount: "2"
        } })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await listBillableItems(f.ctx(), "medicine")).toEqual([]);
      await expect(listBillableItems(f.deskCtx(), "medicine")).rejects.toMatchObject({ code: "FORBIDDEN" });
      const activeItem = await saveSetting(f.ah, { expectedVersion: item.version, reason: "Synthetic active medicine price", value: { ...item.payload, amount: "3", active: true } });
      expect(await listBillableItems(f.ctx(), "medicine")).toMatchObject([{ itemId: "INACTIVE", unit: "tablet", quantityScale: 0, tariffVersionId: activeItem.id, unitPricePaise: 300n }]);
      const issue = await withTransaction((tx) => postChargeInTransaction(tx, f.ctx(), { admissionId: a.admissionId, sourceEventId: randomUUID(), itemId: "INACTIVE", category: "medicine", quantity: "2", unit: "tablet", tariffVersionId: activeItem.id, status: "FINAL" }));
      await saveSetting(f.ah, { expectedVersion: activeItem.version, reason: "Synthetic later medicine price", value: { ...item.payload, amount: "5", active: true } });
      await withTransaction(async (tx) => {
        const originalReturnPrice = await resolveBillableRate(tx, { itemId: issue.itemId, eventKind: "medicine", unit: "tablet", quantity: "1", pinnedVersionId: issue.tariffVersionId });
        expect(originalReturnPrice.amountPaise).toBe(300n);
        await reverseChargeInTransaction(tx, f.ctx(), { chargeId: issue.id, amountPaise: originalReturnPrice.amountPaise.toString(), reason: "Synthetic one-tablet return at original issue price" });
      });
      expect((await getBill(f.ctx(), a.admissionId, cutoff)).netPaise).toBe(110201n);
    });
  }, 120000);
  it("preserves explicit configured zero room/item rates without treating absent policy as zero", async () => {
    await withTestDatabase(async ({ runtime, owner }) => {
      process.env.DATABASE_URL = runtimeUrl;
      const { billingFixture } = await import("../support/billing-fixture");
      const { activateAdmission } = await import("../../src/server/admissions/commands");
      const { postChargeInTransaction, getBill, reconcileBill, getDepositSummary } = await import("../../src/server/billing/commands");
      const { withTransaction } = await import("../../src/server/db");
      const f = await billingFixture();
      await f.setting({ type: "tariff", category: "GENERAL", amount: "0", basis: "hour", rounding: "exact", graceMinutes: 0 });
      const a = await f.episode();
      expect((await getDepositSummary(f.deskCtx(), a.admissionId)).requiredPaise).toBeNull();
      const start = new Date(Date.now() - 3600000);
      await owner.query("update hims.admissions set registered_at=$1 where id=$2", [new Date(start.getTime()-60000), a.admissionId]);
      await owner.query("update hims.bed_holds set held_at=$1 where admission_id=$2", [new Date(start.getTime()-60000), a.admissionId]);
      const activate = () => { const c = f.deskCtx(); return activateAdmission(c, { admissionId: a.admissionId, arrivedAt: start.toISOString(), expectedVersion: 1, requestId: c.requestId }); };
      await expect(activate()).rejects.toMatchObject({ code: "PRECONDITION" });
      await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
      await activate();
      const cutoff = new Date();
      await reconcileBill(f.ctx(), { admissionId: a.admissionId, cutoff: cutoff.toISOString() });
      expect((await getBill(f.ctx(), a.admissionId, cutoff)).netPaise).toBe(0n);
      expect((await runtime.query("select posted_paise,last_reconciled_at from hims.room_stays where admission_id=$1", [a.admissionId])).rows[0]).toMatchObject({ posted_paise: "0", last_reconciled_at: cutoff });
      const item = await f.setting({ type: "billable-item", code: "ZERO_ITEM", name: "Synthetic explicit zero consultation", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "0", active: true });
      const source = { admissionId: a.admissionId, sourceEventId: randomUUID(), itemId: "ZERO_ITEM", category: "consultation", quantity: "1", unit: "session", tariffVersionId: item.id, status: "FINAL" };
      const results = await Promise.all([withTransaction((tx) => postChargeInTransaction(tx, f.ctx(), source)), withTransaction((tx) => postChargeInTransaction(tx, f.ctx(), source))]);
      expect(results[0].id).toBe(results[1].id);
      expect(results[0].amountPaise).toBe(0n);
      const bill = await getBill(f.ctx(), a.admissionId, cutoff);
      expect(bill.netPaise).toBe(0n);
      expect(bill.charges).toHaveLength(1);
      expect(bill.charges[0].tariffVersionId).toBe(item.id);
    });
  }, 120000);
});
