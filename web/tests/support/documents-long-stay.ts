import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { assertTestDatabasePair } from "../../scripts/test-database-guard";
import type { billingFixture } from "./billing-fixture";
import { staffContext } from "../../src/server/access";
import { createBed, transferAdmission } from "../../src/server/admissions/commands";
import { fingerprint, roomPolicyInput } from "../../src/server/billing/commands";
import { roomDue } from "../../src/server/billing/money";
/** Guarded native fixture stores the exact deltas produced by seven days of minute cutoffs.
 * It batches INSERTs, not money/statement rows; real transfer/departure commands still run. */
export async function sevenDayRoomHistory(runtime: Client, f: Awaited<ReturnType<typeof billingFixture>>, admissionId: string, shiftId: string) {
  // Outer withTestDatabase checked the ordinary URL before switching the application
  // module to the test runtime; recheck this actual connection, without resetting.
  assertTestDatabasePair(process.env.TEST_DATABASE_URL!, process.env.TEST_RUNTIME_DATABASE_URL!);
  const identity = (await runtime.query("select current_database() name,current_user role")).rows[0];
  if (identity.name !== decodeURIComponent(new URL(process.env.TEST_RUNTIME_DATABASE_URL!).pathname.slice(1)) || identity.role !== "hims_test_runtime") throw Error("Synthetic runtime required");
  const ctx = (role: "admin" | "doctor" | "nurse") => staffContext(f[role], "synthetic-seven-day-documents");
  await f.setting({ type: "bed-category", code: "DOC_ICU", name: "Synthetic long-stay ICU", active: true });
  await f.setting({ type: "tariff", category: "DOC_ICU", amount: "120", basis: "hour", rounding: "exact", graceMinutes: 0 });
  await f.setting({ type: "billable-item", code: "DOC_LONG_FEE", name: "Separate actual clinical department charge", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1234.56", active: true });
  const target = await createBed(ctx("admin"), { label: `Synthetic seven-day ICU ${randomUUID()}`, category: "DOC_ICU", reason: "Actual distinct physical transfer source" });
  async function postMinutes(stay: { id: string; bed_id: string; tariff_version_id: string; started_at: Date }) {
    const policy = roomPolicyInput.parse((await runtime.query("select payload from hims.setting_versions where id=$1", [stay.tariff_version_id])).rows[0].payload);
    const rows = Array.from({ length: 5040 }, (_, index) => {
      const minute = index + 1, due = roomDue(policy, minute * 60000), previous = roomDue(policy, index * 60000), cutoff = new Date(stay.started_at.getTime() + minute * 60000);
      return { source: `room:${stay.id}:${due}`, payload: fingerprint({ stayId: stay.id, cutoff: cutoff.toISOString(), due: due.toString() }), quantity: String(minute * 60000), amount: String(due - previous), created: cutoff.toISOString() };
    });
    for (let i = 0; i < rows.length; i += 250) await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id,created_at) select $1,x.source,x.payload,'room',$2,$3,x.quantity,'elapsed-ms-cumulative',$4,$5,x.amount::bigint,'FINAL','system','room-charge',x.created::timestamptz from jsonb_to_recordset($6::jsonb) x(source text,payload text,quantity text,amount text,created text)", [admissionId, stay.bed_id, `Room · ${policy.category}`, stay.tariff_version_id, policy.amount, JSON.stringify(rows.slice(i, i + 250))]);
    const cutoff = new Date(stay.started_at.getTime() + 5040 * 60000);
    await runtime.query("update hims.room_stays set posted_paise=$2,last_reconciled_at=$3 where id=$1", [stay.id, roomDue(policy, 5040 * 60000).toString(), cutoff]);
    await runtime.query("update hims.admissions set bill_revision=bill_revision+5040 where id=$1", [admissionId]);
    return cutoff;
  }
  const first = (await runtime.query("select * from hims.room_stays where admission_id=$1", [admissionId])).rows[0];
  const boundary = await postMinutes(first);
  const order = (await runtime.query("insert into hims.transfer_orders(admission_id,source_stay_id,version,destination_category,reason,signed_by,signed_at) values($1,$2,1,'DOC_ICU','Synthetic historical Doctor transfer source',$3,$4) returning id", [admissionId, first.id, f.doctor.id, first.started_at])).rows[0];
  const nurse = ctx("nurse"); await transferAdmission(nurse, { admissionId, transferOrderId: order.id, targetBedId: target.id, transferredAt: boundary.toISOString(), handover: { shiftId, notes: "Actual continuous nursing transfer handover" }, requestId: nurse.requestId });
  const second = (await runtime.query("select * from hims.room_stays where admission_id=$1 and ended_at is null", [admissionId])).rows[0];
  const end = await postMinutes(second);
  return { startedAt: first.started_at.toISOString(), endedAt: end.toISOString(), firstStayId: first.id, secondStayId: second.id };
}
