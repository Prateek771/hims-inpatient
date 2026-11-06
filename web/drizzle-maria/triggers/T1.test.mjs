// T1.test.mjs: accepted-row / rejected-row tests for every trigger in T1.sql (plain node + mysql2, no framework).
// Usage: node web/drizzle-maria/triggers/T1.test.mjs [name-filter]
// Needs: local MariaDB (credentials from tmp/mariadb-local/root.env), scratch database port_t1 with 0001_tables.sql,
//        0002_helpers.sql and 0003_views.sql already applied (the script creates the database if it is missing and
//        applies those files itself when it is empty). Drops nothing but the triggers it manages.
// Foreign keys are switched off in the test session so fixtures can use minimal synthetic rows; each trigger is tested
// alone (all other triggers are dropped while it is under test and restored afterwards).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const SCRATCH = process.env.MYSQL2_FROM ?? "C:/Users/prate/AppData/Local/Temp/claude/8e4d92b4015353d0/4cd94459-c906-4532-8635-f6f792ea0f87/scratchpad/probe/";
const mysql = createRequire(SCRATCH)("mysql2/promise");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, "tmp/mariadb-local/root.env"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const DB = "port_t1";
const conn = { host: env.MARIADB_HOST, port: +env.MARIADB_PORT, user: env.MARIADB_ROOT_USER, password: env.MARIADB_ROOT_PASSWORD };
const filter = process.argv[2] ?? "";

// ---- bootstrap: database + schema files ---------------------------------------------------------------------
{
  const admin = await mysql.createConnection(conn);
  const [r] = await admin.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ?", [DB]);
  if (r[0].n === 0) {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
    for (const f of ["0001_tables.sql", "0002_helpers.sql", "0003_views.sql"]) {
      execFileSync("C:/Program Files/MariaDB 11.8/bin/mariadb.exe", ["-h", conn.host, "-P", String(conn.port), "-u", conn.user, DB], {
        input: fs.readFileSync(path.join(root, "web/drizzle-maria", f)),
        env: { ...process.env, MYSQL_PWD: conn.password },
        stdio: ["pipe", "ignore", "inherit"],
      });
    }
  }
  await admin.end();
}
const c = await mysql.createConnection({ ...conn, database: DB });
await c.query("SET time_zone = '+00:00'");
await c.query("SET SESSION foreign_key_checks = 0");

// ---- trigger blocks -----------------------------------------------------------------------------------------
const blocks = fs.readFileSync(path.join(here, "T1.sql"), "utf8").split(/^-- TRIGGER /m).slice(1).map((b) => {
  const body = b.split(/^-- END TRIGGER/m)[0];
  const lines = body.split("\n");
  const hdr = Object.fromEntries(lines.shift().split(" ").map((x) => x.split("=")));
  const drop = lines.shift();
  return { ...hdr, drop, create: lines.join("\n").trim() };
});
const present = new Set();
async function install(b) { await c.query(b.drop); await c.query(b.create); present.add(b.name); }
async function only(names) {
  const want = new Set(names);
  for (const n of [...present]) if (!want.has(n)) { await c.query(`DROP TRIGGER IF EXISTS \`${n}\``); present.delete(n); }
  for (const b of blocks) if (want.has(b.name) && !present.has(b.name)) await install(b);
}
const [existing] = await c.query("SELECT trigger_name n FROM information_schema.triggers WHERE trigger_schema = ?", [DB]);
for (const r of existing) present.add(r.n);

// ---- fixtures ------------------------------------------------------------------------------------------------
const [colRows] = await c.query(
  "SELECT table_name t, column_name n, data_type d, is_nullable nl, column_default df, extra x FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position", [DB]);
const cols = {};
for (const r of colRows) (cols[r.t] ??= []).push(r);
const rid = () => randomUUID();
const bc = () => "SMP-" + randomUUID().replace(/-/g, "").toUpperCase();
const rs = (p = "v") => `${p}${randomUUID().slice(0, 12)}`;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const ts = (min) => new Date(T0 + min * 60000).toISOString().replace("T", " ").replace("Z", "000");
const filler = (d) => {
  switch (d) {
    case "uuid": return rid();
    case "varchar": case "text": return rs();
    case "longtext": return "{}";
    case "int": case "bigint": case "smallint": return 1;
    case "tinyint": return 0;
    case "decimal": return 1;
    case "datetime": return ts(0);
    case "date": return "2026-01-01";
    case "longblob": return Buffer.from("x");
    default: return null;
  }
};
const TABLE_DEFAULTS = { care_billing_events: { state: "READY" }, nursing_addenda: { record_type: "MAR" } };
async function ins(table, vals = {}) {
  const row = { ...(TABLE_DEFAULTS[table] ?? {}), ...vals };
  for (const col of cols[table]) {
    if (col.n in row) continue;
    if (col.n === "id") { row.id = rid(); continue; }
    if (col.x.includes("GENERATED")) continue;
    if (col.nl === "YES" || col.df !== null) continue;
    row[col.n] = filler(col.d);
  }
  const names = Object.keys(row);
  await c.query(`INSERT INTO \`${table}\` (${names.map((n) => `\`${n}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`, names.map((n) => row[n]));
  return row;
}
const staff = (role, o = {}) => ins("staff_user", { role, email: `${rs("e")}@t.t`, ...o }).then((r) => r.id);
async function admission(o = {}) {
  const v2 = o.workflow_version === 2;
  const doc = v2 ? null : (o.admitting_doctor_id ?? (await staff("DOCTOR")));
  const status = o.status ?? "ADMITTED";
  const row = await ins("admissions", {
    status, admitted_at: ["ADMITTED", "DISCHARGED"].includes(status) ? ts(0) : null, payment_route: "SELF_PAY", expected_stay_days: 3,
    admitting_doctor_id: doc, clinician_assessment: v2 ? null : "{}", external_doctor_id: v2 ? rid() : null,
    cancelled_at: status === "CANCELLED" ? ts(0) : null, cancellation_reason: status === "CANCELLED" ? "reason" : null, ...o,
  });
  return row;
}
const shift = (adm, nurse, o = {}) => ins("nursing_shifts", { admission_id: adm, nurse_id: nurse, started_at: ts(0), ...o });
const stay = (adm, o = {}) => ins("room_stays", { admission_id: adm, started_at: ts(0), ended_at: null, ...o });
const assign = (adm, nurse) => ins("nurse_assignments", { admission_id: adm, nurse_id: nurse });
const evidence = (adm, o = {}) => ins("exception_evidence", { admission_id: adm, role: "DOCTOR", kind: "DEATH", actual_at: ts(10), signed_at: ts(10), ...o });
const adminEx = (adm, o = {}) => ins("admin_exceptions", {
  admission_id: adm, type: "DEATH", disposition: "FOLLOW_UP", authority: "authority", reason: "reasons", evidence: "evidence",
  evidence_ids: "[]", snapshot: "{}", ...o });

// ---- harness -------------------------------------------------------------------------------------------------
const results = [];
let cur;
const MSG_ERRNO = 1644;
async function ok(label, fn) {
  try { await fn(); cur.pass.push(`ok:${label}`); } catch (e) { cur.fail.push(`ok:${label} -> unexpected error ${e.errno} ${e.sqlMessage ?? e.message}`); }
}
async function bad(label, msg, fn) {
  try { await fn(); cur.fail.push(`bad:${label} -> accepted, expected "${msg}"`); }
  catch (e) {
    if (e.errno === MSG_ERRNO && e.sqlMessage === msg) cur.pass.push(`bad:${label}`);
    else cur.fail.push(`bad:${label} -> got ${e.errno} "${e.sqlMessage ?? e.message}", expected "${msg}"`);
  }
}
/** groups: trigger names to install together for this test (default: just the named one). */
async function test(name, fn, groupNames = [name]) {
  if (filter && !name.includes(filter)) return;
  cur = { name, pass: [], fail: [] };
  try { await only(groupNames); await fn(); } catch (e) { cur.fail.push(`harness error: ${e.errno ?? ""} ${e.sqlMessage ?? e.stack ?? e.message}`); }
  results.push(cur);
}
const noRaise = (label) => cur.pass.push(`n/a:${label} (trigger has no RAISE branch; only the accepted path and its lock exist)`);

// =================================================================================================================
await test("admin_exception_authority", async () => {
  const mk = async (admO, o) => {
    const adm = await admission(admO);
    const admin = await staff("ADMIN");
    const owner = await staff("NURSE");
    return { adm, admin, owner, o: { admission_id: adm.id, signed_by: admin, follow_up_owner_id: owner, ...o } };
  };
  await ok("URGENT_ADMISSION on PENDING", async () => { const f = await mk({ status: "PENDING" }, { type: "URGENT_ADMISSION", disposition: "ACTIVATE" }); await adminEx(f.adm.id, f.o); });
  await bad("signer not Admin", "Current Admin and active follow-up owner required", async () => {
    const f = await mk({ status: "PENDING" }, { type: "URGENT_ADMISSION", disposition: "ACTIVATE" }); await adminEx(f.adm.id, { ...f.o, signed_by: f.owner }); });
  await bad("inactive follow-up owner", "Current Admin and active follow-up owner required", async () => {
    const f = await mk({ status: "PENDING" }, { type: "URGENT_ADMISSION", disposition: "ACTIVATE" });
    const banned = await staff("NURSE", { banned: 1 }); await adminEx(f.adm.id, { ...f.o, follow_up_owner_id: banned }); });
  await bad("URGENT_ADMISSION on ADMITTED", "Named exception does not authorize this episode disposition", async () => {
    const f = await mk({}, { type: "URGENT_ADMISSION", disposition: "ACTIVATE" }); await adminEx(f.adm.id, f.o); });
  await bad("unknown type", "Named exception does not authorize this episode disposition", async () => {
    const f = await mk({}, { type: "MYSTERY", disposition: "FOLLOW_UP" }); await adminEx(f.adm.id, f.o); });
  await bad("evidence from another admission", "Exception evidence must belong to the original admission", async () => {
    const f = await mk({}, { type: "DELAYED_TRANSFER", disposition: "TRANSFER", evidence_ids: JSON.stringify([rid()]) }); await adminEx(f.adm.id, f.o); });
  await ok("evidence of this admission", async () => {
    const f = await mk({}, { type: "DELAYED_TRANSFER", disposition: "TRANSFER" });
    const ev = await evidence(f.adm.id, { kind: "DEATH" });
    await adminEx(f.adm.id, { ...f.o, evidence_ids: JSON.stringify([ev.id]) }); });
  await bad("DEATH exit without Doctor disposition", "Proper signed Doctor disposition required", async () => {
    const f = await mk({}, { type: "DEATH", disposition: "EXCEPTIONAL_EXIT" }); await adminEx(f.adm.id, f.o); });
  await ok("DEATH exit with Doctor disposition", async () => {
    const f = await mk({}, { type: "DEATH", disposition: "EXCEPTIONAL_EXIT" });
    const ev = await evidence(f.adm.id, { kind: "DEATH" });
    await adminEx(f.adm.id, { ...f.o, evidence_ids: JSON.stringify([ev.id]) }); });
  await bad("insurance delay on self-pay", "Actual same-episode insurance case required", async () => {
    const f = await mk({}, { type: "INSURANCE_DELAY", disposition: "FOLLOW_UP", source_id: rid() }); await adminEx(f.adm.id, f.o); });
  await ok("insurance delay with case", async () => {
    const f = await mk({ payment_route: "INSURED" }, { type: "INSURANCE_DELAY", disposition: "FOLLOW_UP" });
    const ic = await ins("insurance_cases", { admission_id: f.adm.id }); await adminEx(f.adm.id, { ...f.o, source_id: ic.id }); });
  await bad("insurance denial not rejected", "Actual current external denial required", async () => {
    const f = await mk({ payment_route: "INSURED" }, { type: "INSURANCE_DENIAL", disposition: "FOLLOW_UP" });
    const ic = await ins("insurance_cases", { admission_id: f.adm.id }); await adminEx(f.adm.id, { ...f.o, source_id: ic.id }); });
  await ok("insurance denial rejected", async () => {
    const f = await mk({ payment_route: "INSURED" }, { type: "INSURANCE_DENIAL", disposition: "FOLLOW_UP" });
    const ic = await ins("insurance_cases", { admission_id: f.adm.id });
    await ins("insurance_decisions", { case_id: ic.id, case_version: 1, status: "REJECTED", kind: "PREAUTH", approved_paise: 0, co_pay_bps: 0, allocation: "{}", document_ids: "[]" });
    await adminEx(f.adm.id, { ...f.o, source_id: ic.id }); });
  await bad("reverse-charge authority without original charge", "Closed reversal authority must bind original non-room charge", async () => {
    const f = await mk({ status: "DISCHARGED" }, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "REVERSE_CHARGE", source_id: rid(), snapshot: '{"billVersion":1}' }); await adminEx(f.adm.id, f.o); });
  await ok("reverse-charge authority", async () => {
    const f = await mk({ status: "DISCHARGED" }, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "REVERSE_CHARGE", snapshot: '{"billVersion":1}' });
    const ch = await ins("charges", { admission_id: f.adm.id, category: "pharmacy", source_event_id: rid(), actor_type: "staff", actor_id: "a", initial_status: "FINAL" });
    await adminEx(f.adm.id, { ...f.o, source_id: ch.id }); });
  await bad("stale bill version", "New financial authority requires current bill version", async () => {
    const f = await mk({ status: "DISCHARGED" }, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "REVERSE_CHARGE", snapshot: '{"billVersion":7}' });
    const ch = await ins("charges", { admission_id: f.adm.id, category: "pharmacy", source_event_id: rid(), actor_type: "staff", actor_id: "a", initial_status: "FINAL" });
    await adminEx(f.adm.id, { ...f.o, source_id: ch.id }); });
  await bad("care-billing authority without source", "Closed care authority requires retained performed original source", async () => {
    const f = await mk({ status: "DISCHARGED" }, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "CARE_BILLING", source_id: rid(), snapshot: '{"billVersion":1}' }); await adminEx(f.adm.id, f.o); });
  await ok("delayed room cutoff correction", async () => {
    const f = await mk({}, { type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND" });
    const st = await stay(f.adm.id, { ended_at: ts(60) }); await adminEx(f.adm.id, { ...f.o, source_id: st.id }); });
  await bad("room cutoff correction on open stay", "Named exception does not authorize this episode disposition", async () => {
    const f = await mk({}, { type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND" });
    const st = await stay(f.adm.id); await adminEx(f.adm.id, { ...f.o, source_id: st.id }); });
});

await test("amended_cutoff_witness", async () => {
  const setup = async () => {
    const adm = await admission(); const nurse = await staff("NURSE"); const sh = await shift(adm.id, nurse);
    const st = await stay(adm.id, { ended_at: ts(30) });
    const ev = await evidence(adm.id, { role: "NURSE", kind: "ROOM_CUTOFF", shift_id: sh.id, signed_by: nurse, actual_at: ts(40), signed_at: ts(60) });
    return { adm, nurse, sh, st, ev };
  };
  const am = (f, o) => ins("stay_boundary_amendments", { admission_id: f.adm.id, stay_id: f.st.id, evidence_id: f.ev.id, version: 1, started_at: ts(0), ended_at: ts(30), ...o });
  await ok("cutoff within Nurse attendance", async () => { const f = await setup(); await am(f); });
  await bad("cutoff after witness signature", "Changed bed cutoff must fit its actual Nurse witness attendance and signature", async () => { const f = await setup(); await am(f, { ended_at: ts(90) }); });
  await bad("cutoff before shift start", "Changed bed cutoff must fit its actual Nurse witness attendance and signature", async () => { const f = await setup(); await am(f, { ended_at: ts(-5), started_at: ts(-10) }); });
  await ok("cutoff equal to recorded vacancy is exempt", async () => {
    const f = await setup(); await ins("room_vacations", { stay_id: f.st.id, admission_id: f.adm.id, vacated_at: ts(95) }); await am(f, { ended_at: ts(95) }); });
});

// ---- bed turnover -------------------------------------------------------------------------------------------------
async function turnoverFixture() {
  const adm = await admission(); const bed = rid(); const st = await stay(adm.id, { bed_id: bed, ended_at: ts(60) });
  const tn = await ins("bed_turnovers", { bed_id: bed, stay_id: st.id, admission_id: adm.id, vacated_at: ts(60) });
  return { adm, bed, st, tn };
}
await test("bed_hold_turnover_guard", async () => {
  await ok("bed without turnover", async () => { const adm = await admission(); await ins("bed_holds", { bed_id: rid(), admission_id: adm.id, held_at: ts(70) }); });
  await bad("turnover not completed", "Actual housekeeping completion required before bed reuse", async () => {
    const f = await turnoverFixture(); await ins("bed_holds", { bed_id: f.bed, admission_id: f.adm.id, held_at: ts(70) }); });
  await ok("turnover completed before hold", async () => {
    const f = await turnoverFixture(); await ins("bed_turnover_completions", { turnover_id: f.tn.id, completed_at: ts(65) });
    await ins("bed_holds", { bed_id: f.bed, admission_id: f.adm.id, held_at: ts(70) }); });
  await bad("completion after hold", "Actual housekeeping completion required before bed reuse", async () => {
    const f = await turnoverFixture(); await ins("bed_turnover_completions", { turnover_id: f.tn.id, completed_at: ts(80) });
    await ins("bed_holds", { bed_id: f.bed, admission_id: f.adm.id, held_at: ts(70) }); });
});
await test("bed_turnover_source_guard", async () => {
  await ok("turnover of the actual closed stay", async () => {
    const adm = await admission(); const bed = rid(); const st = await stay(adm.id, { bed_id: bed, ended_at: ts(60) });
    await ins("bed_turnovers", { bed_id: bed, stay_id: st.id, admission_id: adm.id, vacated_at: ts(60) }); });
  await bad("wrong vacated_at", "Turnover must reference the actual closed physical stay", async () => {
    const adm = await admission(); const bed = rid(); const st = await stay(adm.id, { bed_id: bed, ended_at: ts(60) });
    await ins("bed_turnovers", { bed_id: bed, stay_id: st.id, admission_id: adm.id, vacated_at: ts(61) }); });
  await bad("wrong bed", "Turnover must reference the actual closed physical stay", async () => {
    const adm = await admission(); const st = await stay(adm.id, { ended_at: ts(60) });
    await ins("bed_turnovers", { bed_id: rid(), stay_id: st.id, admission_id: adm.id, vacated_at: ts(60) }); });
});
await test("bed_turnover_completion_guard", async () => {
  await ok("completion after vacancy", async () => { const f = await turnoverFixture(); await ins("bed_turnover_completions", { turnover_id: f.tn.id, completed_at: ts(65) }); });
  await bad("completion before vacancy", "Cleaning completion must follow actual bed vacancy", async () => {
    const f = await turnoverFixture(); await ins("bed_turnover_completions", { turnover_id: f.tn.id, completed_at: ts(30) }); });
  await bad("completion in the future", "Cleaning completion must follow actual bed vacancy", async () => {
    const f = await turnoverFixture(); await ins("bed_turnover_completions", { turnover_id: f.tn.id, completed_at: "2099-01-01 00:00:00.000000" }); });
});

// ---- current return instruction -------------------------------------------------------------------------------
async function vacationFixture(admO = {}) {
  const adm = await admission(admO); const nurse = await staff("NURSE"); const doc = adm.admitting_doctor_id;
  const sh = await shift(adm.id, nurse); const st = await stay(adm.id, { ended_at: ts(30) });
  const vac = await ins("room_vacations", { admission_id: adm.id, stay_id: st.id, shift_id: sh.id, vacated_at: ts(30), signed_by: nurse });
  return { adm, nurse, doc, sh, st, vac };
}
const instruction = (f, o = {}) => evidence(f.adm.id, { kind: "RETURN_TO_BED", role: "DOCTOR", source_id: f.vac.id, signed_by: f.doc, actual_at: ts(40), signed_at: ts(41), ...o });
await test("exception_instruction_current", async () => {
  await ok("unrelated kind", async () => { const adm = await admission(); await evidence(adm.id, { kind: "DEATH" }); });
  await ok("first RETURN_TO_BED instruction", async () => { const f = await vacationFixture(); await instruction(f); });
  await bad("second instruction before review", "Review existing return instruction before another", async () => {
    const f = await vacationFixture(); await instruction(f); await instruction(f, { actual_at: ts(50), signed_at: ts(51) }); });
  await bad("instruction without a factual vacancy", "Return evidence requires current same-episode factual vacancy", async () => {
    const f = await vacationFixture(); await instruction(f, { source_id: rid() }); });
  await bad("instruction on discharged admission", "Return evidence requires current same-episode factual vacancy", async () => {
    const f = await vacationFixture({ status: "DISCHARGED" }); await instruction(f); });
  await bad("handover without instruction", "Actual return handover requires current Doctor instruction", async () => {
    const f = await vacationFixture(); await evidence(f.adm.id, { kind: "RETURN_HANDOVER", role: "NURSE", shift_id: f.sh.id, source_id: f.vac.id, signed_by: f.nurse, actual_at: ts(45) }); });
  await ok("handover after instruction", async () => {
    const f = await vacationFixture(); await instruction(f);
    await evidence(f.adm.id, { kind: "RETURN_HANDOVER", role: "NURSE", shift_id: f.sh.id, source_id: f.vac.id, signed_by: f.nurse, actual_at: ts(45) }); });
  await ok("cancellation of an open instruction", async () => {
    const f = await vacationFixture(); const d = await instruction(f); await evidence(f.adm.id, { kind: "RETURN_CANCELLED", role: "DOCTOR", source_id: d.id, signed_by: f.doc, actual_at: ts(50), signed_at: ts(51) }); });
  await bad("cancellation of an instruction already followed by a return handover", "Doctor reconsideration requires an unconsumed unwitnessed current return instruction; record actual return first", async () => {
    const f = await vacationFixture(); const d = await instruction(f);
    await evidence(f.adm.id, { kind: "RETURN_HANDOVER", role: "NURSE", shift_id: f.sh.id, source_id: f.vac.id, signed_by: f.nurse, actual_at: ts(45) });
    await evidence(f.adm.id, { kind: "RETURN_CANCELLED", role: "DOCTOR", source_id: d.id, signed_by: f.doc, actual_at: ts(50), signed_at: ts(51) }); });
});
await test("exception_authority_instruction", async () => {
  const mk = async (f, o) => adminEx(f.adm.id, { type: "RETURN_TO_BED", disposition: "RETURN_TO_BED", ...o });
  await ok("non-return type", async () => { const adm = await admission(); await adminEx(adm.id, { type: "DEATH" }); });
  await ok("RETURN_TO_BED with current instruction", async () => {
    const f = await vacationFixture(); const d = await instruction(f); await mk(f, { evidence_ids: JSON.stringify([d.id]) }); });
  await bad("RETURN_TO_BED without instruction", "Return authority requires current unsuperseded Doctor instruction", async () => {
    const f = await vacationFixture(); await mk(f, {}); });
  await bad("RETURN_TO_BED with cancelled instruction", "Return authority requires current unsuperseded Doctor instruction", async () => {
    const f = await vacationFixture(); const d = await instruction(f);
    await evidence(f.adm.id, { kind: "RETURN_CANCELLED", role: "DOCTOR", source_id: d.id, signed_by: f.doc, actual_at: ts(50), signed_at: ts(51) });
    await mk(f, { evidence_ids: JSON.stringify([d.id]) }); });
});
await test("room_return_instruction", async () => {
  await ok("return on an uncancelled instruction", async () => {
    const f = await vacationFixture(); const d = await instruction(f); await ins("room_returns", { admission_id: f.adm.id, vacation_id: f.vac.id, doctor_evidence_id: d.id }); });
  await bad("return on a cancelled instruction", "Superseded Doctor instruction cannot authorize return", async () => {
    const f = await vacationFixture(); const d = await instruction(f);
    await evidence(f.adm.id, { kind: "RETURN_CANCELLED", role: "DOCTOR", source_id: d.id, signed_by: f.doc, actual_at: ts(50), signed_at: ts(51) });
    await ins("room_returns", { admission_id: f.adm.id, vacation_id: f.vac.id, doctor_evidence_id: d.id }); });
});
await test("clearance_instruction_current", async () => {
  const seal = (adm, o) => ins("clearance_seals", { admission_id: adm, gate: "DOCTOR", role: "DOCTOR", inputs: "{}", ...o });
  await ok("DOCTOR seal without open instruction", async () => { const adm = await admission(); await seal(adm.id); });
  await ok("NURSING seal ignores open instruction", async () => { const f = await vacationFixture(); await instruction(f); await seal(f.adm.id, { gate: "NURSING", role: "NURSE" }); });
  await bad("DOCTOR seal with open instruction", "Current return instruction requires actual return or explicit Doctor reconsideration", async () => {
    const f = await vacationFixture(); await instruction(f); await seal(f.adm.id); });
});
await test("current_room_vacation", async () => {
  await ok("first vacancy", async () => { const adm = await admission(); const st = await stay(adm.id, { ended_at: ts(30) }); await ins("room_vacations", { admission_id: adm.id, stay_id: st.id, vacated_at: ts(30) }); });
  await bad("second vacancy", "Current bed vacancy already exists; explicit return supersession required", async () => {
    const f = await vacationFixture(); const st = await stay(f.adm.id, { ended_at: ts(40) }); await ins("room_vacations", { admission_id: f.adm.id, stay_id: st.id, vacated_at: ts(40) }); });
});

// ---- discharge document ---------------------------------------------------------------------------------------
await test("discharge_document_source", async () => {
  const H = "a".repeat(64);
  const setup = async () => {
    const admin = await staff("ADMIN"); const adm = await admission({ status: "DISCHARGED" });
    const dep = await ins("departures", { admission_id: adm.id, departed_at: ts(100), bill_version: 1 });
    return { admin, adm, dep };
  };
  const doc = async (f, { snapshot = {}, ...o } = {}) => {
    const id = rid(); const created = "2026-02-01 10:00:00.123000";
    const snap = { admission: { id: f.adm.id }, documentId: id, version: 1, sourceHash: H, money: { bill: { revision: 1 } }, createdAt: "2026-02-01T10:00:00.123Z", departure: { kind: "ORDINARY", record: { id: f.dep.id } }, ...snapshot };
    return ins("discharge_documents", { id, admission_id: f.adm.id, version: 1, source_hash: H, hash: H, pdf_hash: H, snapshot: JSON.stringify(snap), created_by: f.admin, created_at: created, schema_version: 1, kind: "FINAL", size_bytes: 10, ...o });
  };
  await ok("first coherent final copy", async () => { const f = await setup(); await doc(f); });
  await ok("second sequential copy", async () => {
    const f = await setup(); const first = await doc(f); await doc(f, { snapshot: { version: 2 }, version: 2, replaces_document_id: first.id }); });
  await bad("non-delivery staff", "Current final-copy delivery staff required", async () => { const f = await setup(); f.admin = await staff("NURSE"); await doc(f); });
  await bad("banned staff", "Current final-copy delivery staff required", async () => { const f = await setup(); f.admin = await staff("ADMIN", { banned: 1 }); await doc(f); });
  await bad("admission not discharged", "Coherent actual departure document source required", async () => { const f = await setup(); await c.query("UPDATE admissions SET status='ADMITTED' WHERE id=?", [f.adm.id]); await doc(f); });
  await bad("stale bill revision in snapshot", "Coherent actual departure document source required", async () => { const f = await setup(); await doc(f, { snapshot: { money: { bill: { revision: 9 } } } }); });
  await bad("createdAt mismatch", "Coherent actual departure document source required", async () => { const f = await setup(); await doc(f, { snapshot: { createdAt: "2026-02-01T10:00:00.124Z" } }); });
  await bad("wrong departure record", "Original ordinary departure source required", async () => { const f = await setup(); await doc(f, { snapshot: { departure: { kind: "ORDINARY", record: { id: rid() } } } }); });
  await bad("no departure at all", "Original exceptional departure source required", async () => {
    const admin = await staff("ADMIN"); const adm = await admission({ status: "DISCHARGED" }); await doc({ admin, adm, dep: { id: rid() } }); });
  await bad("version gap", "Sequential immutable document predecessor required", async () => { const f = await setup(); await doc(f, { snapshot: { version: 2 }, version: 2 }); });
  await ok("schema_version 2 skips the guard", async () => { const f = await setup(); await doc(f, { schema_version: 2, snapshot: { version: 99 } }); });
});

// ---- guard_discharge_sources -----------------------------------------------------------------------------------
await test("allocation_cancel_source_guard", async () => {
  await ok("allocation cancellation", async () => {
    const adm = await admission(); const rc = await ins("receipts", { admission_id: adm.id, party: "PATIENT", kind: "DEPOSIT", amount_paise: 1000, mode: "CASH", actor_type: "staff" });
    const al = await ins("receipt_allocations", { receipt_id: rc.id, amount_paise: 100, actor_type: "staff" });
    await ins("allocation_cancellations", { allocation_id: al.id, actor_type: "staff" }); });
  noRaise("allocation_cancel_source_guard");
});
await test("refund_source_guard", async () => {
  const receipt = async (kind = "DEPOSIT") => {
    const adm = await admission(); const rc = await ins("receipts", { admission_id: adm.id, party: "PATIENT", kind, amount_paise: 1000, mode: "CASH", actor_type: "staff", actor_id: "a", created_at: ts(0) });
    return { adm, rc };
  };
  const refund = (f, o = {}) => ins("receipt_refunds", { admission_id: f.adm.id, hospital_id: f.rc.hospital_id, receipt_id: f.rc.id, amount_paise: 100, mode: "CASH", actor_type: "staff", refunded_at: ts(10), ...o });
  await ok("partial refund", async () => { const f = await receipt(); await refund(f); });
  await bad("refund exceeds receipt", "Refund exceeds original receipt", async () => { const f = await receipt(); await refund(f, { amount_paise: 1001 }); });
  await bad("cumulative refunds exceed receipt", "Refund exceeds original receipt", async () => { const f = await receipt(); await refund(f, { amount_paise: 900 }); await refund(f, { amount_paise: 101 }); });
  await bad("refund of another admission's receipt", "Refund must link this admission original receipt", async () => { const f = await receipt(); const o = await admission(); await refund({ ...f, adm: o }); });
  await bad("refund before the receipt", "Refund actual time outside receipt history", async () => { const f = await receipt(); await refund(f, { refunded_at: ts(-10) }); });
  await bad("refund in the future", "Refund actual time outside receipt history", async () => { const f = await receipt(); await refund(f, { refunded_at: "2099-01-01 00:00:00.000000" }); });
  await bad("deposit still allocated", "Cancel allocated deposit before refund", async () => {
    const f = await receipt(); await ins("receipt_allocations", { receipt_id: f.rc.id, amount_paise: 600, actor_type: "staff" }); await refund(f, { amount_paise: 500 }); });
  await ok("deposit allocation cancelled", async () => {
    const f = await receipt(); const al = await ins("receipt_allocations", { receipt_id: f.rc.id, amount_paise: 600, actor_type: "staff" });
    await ins("allocation_cancellations", { allocation_id: al.id, actor_type: "staff" }); await refund(f, { amount_paise: 500 }); });
  await ok("PAYMENT receipt ignores allocations", async () => {
    const f = await receipt("PAYMENT"); await ins("receipt_allocations", { receipt_id: f.rc.id, amount_paise: 600, actor_type: "staff" }); await refund(f, { amount_paise: 500 }); });
});
await test("clearance_source_guard", async () => {
  const seal = (adm, o) => ins("clearance_seals", { admission_id: adm, inputs: "{}", ...o });
  await ok("DOCTOR seal by a current Doctor", async () => { const adm = await admission(); const d = await staff("DOCTOR"); await seal(adm.id, { gate: "DOCTOR", role: "DOCTOR", signed_by: d }); });
  await bad("seal role differs from staff role", "Current actual seal role required", async () => { const adm = await admission(); const n = await staff("NURSE"); await seal(adm.id, { gate: "DOCTOR", role: "DOCTOR", signed_by: n }); });
  await bad("banned signer", "Current actual seal role required", async () => { const adm = await admission(); const d = await staff("DOCTOR", { banned: 1 }); await seal(adm.id, { gate: "DOCTOR", role: "DOCTOR", signed_by: d }); });
  const chain = async () => {
    const adm = await admission(); const d = await staff("DOCTOR"); const ph = await staff("PHARMACY");
    const s1 = await seal(adm.id, { gate: "DOCTOR", role: "DOCTOR", signed_by: d }); return { adm, d, ph, s1 };
  };
  await ok("PHARMACY seal on current DOCTOR predecessor", async () => { const f = await chain(); await seal(f.adm.id, { gate: "PHARMACY", role: "PHARMACY", signed_by: f.ph, predecessor_id: f.s1.id }); });
  await bad("predecessor of another admission", "Current same-episode predecessor required", async () => {
    const f = await chain(); const o = await admission(); await seal(o.id, { gate: "PHARMACY", role: "PHARMACY", signed_by: f.ph, predecessor_id: f.s1.id }); });
  await bad("predecessor skips a gate", "Current same-episode predecessor required", async () => {
    const f = await chain(); const n = await staff("NURSE"); await seal(f.adm.id, { gate: "NURSING", role: "NURSE", signed_by: n, predecessor_id: f.s1.id }); });
  await bad("predecessor invalidated", "Current same-episode predecessor required", async () => {
    const f = await chain(); await ins("clearance_invalidations", { seal_id: f.s1.id, change_kind: "x", changed_record_ids: "[]" });
    await seal(f.adm.id, { gate: "PHARMACY", role: "PHARMACY", signed_by: f.ph, predecessor_id: f.s1.id }); });
  await bad("missing predecessor", "Current same-episode predecessor required", async () => { const f = await chain(); await seal(f.adm.id, { gate: "PHARMACY", role: "PHARMACY", signed_by: f.ph, predecessor_id: rid() }); });
});
for (const [name, table, mkRow] of [
  ["departure_source_guard", "departures", (adm, st) => ({ admission_id: adm, stay_id: st, departed_at: ts(100), bill_version: 1 })],
  ["vacation_source_guard", "room_vacations", (adm, st) => ({ admission_id: adm, stay_id: st, vacated_at: ts(30) })],
]) {
  await test(name, async () => {
    await ok("stay of the same admission", async () => { const adm = await admission(); const st = await stay(adm.id); await ins(table, mkRow(adm.id, st.id)); });
    await bad("stay of another admission", "Same episode stay required", async () => { const adm = await admission(); const o = await admission(); const st = await stay(o.id); await ins(table, mkRow(adm.id, st.id)); });
    await bad("unknown stay", "Same episode stay required", async () => { const adm = await admission(); await ins(table, mkRow(adm.id, rid())); });
  });
}

// ---- effective attendance (8 tables) ---------------------------------------------------------------------------
const attRow = {
  admission_transfers: (f, o) => ins("admission_transfers", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, transferred_at: ts(30), mvp_authority_id: rid(), ...o }),
  exception_evidence: (f, o) => evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(30), signed_at: ts(30), ...o }),
  medication_administrations: (f, o) => ins("medication_administrations", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(30), outcome: "GIVEN", ...o }),
  nursing_consumables: (f, o) => ins("nursing_consumables", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, used_at: ts(30), ...o }),
  nursing_observations: (f, o) => ins("nursing_observations", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, observed_at: ts(30), ...o }),
  room_vacations: (f, o) => ins("room_vacations", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, vacated_at: ts(30), ...o }),
};
const attTime = { admission_transfers: "transferred_at", exception_evidence: "actual_at", medication_administrations: "actual_at", nursing_consumables: "used_at", nursing_observations: "observed_at", room_vacations: "vacated_at" };
const attFixture = async () => { const adm = await admission(); const nurse = await staff("NURSE"); const sh = await shift(adm.id, nurse); return { adm, nurse, sh }; };
for (const [table, mk] of Object.entries(attRow)) {
  await test(`effective_attendance_guard_${table}`, async () => {
    const tcol = attTime[table];
    await ok("care within the Nurse attendance", async () => { const f = await attFixture(); await mk(f, {}); });
    await ok("shift unknown: guard skipped", async () => { const f = await attFixture(); await mk({ ...f, sh: { id: rid() } }, {}); });
    await bad("signed by a different Nurse", "Actual care must fit original Nurse attendance", async () => { const f = await attFixture(); await mk(f, { signed_by: await staff("NURSE") }); });
    await bad("before the shift started", "Actual care must fit original Nurse attendance", async () => { const f = await attFixture(); await mk(f, { [tcol]: ts(-20), ...(table === "exception_evidence" ? { signed_at: ts(-20) } : {}) }); });
    await bad("after the attendance ended", "Actual care must fit original Nurse attendance", async () => {
      const f = await attFixture(); await ins("nursing_shift_ends", { shift_id: f.sh.id, ended_at: ts(60), signed_by: f.nurse }); await mk(f, { [tcol]: ts(90), ...(table === "exception_evidence" ? { signed_at: ts(90) } : {}) }); });
    if (table === "exception_evidence") {
      await bad("evidence in the future", "Actual attendance evidence cannot be in future", async () => { const f = await attFixture(); await mk(f, { actual_at: "2099-01-01 00:00:00.000000", signed_at: "2099-01-01 00:00:00.000000" }); });
    }
  }, [`effective_attendance_guard_${table}`]);
}
await test("effective_attendance_guard_nursing_shift_ends", async () => {
  const end = (f, o) => ins("nursing_shift_ends", { shift_id: f.sh.id, signed_by: f.nurse, ended_at: ts(60), ...o });
  await ok("Nurse ends own shift", async () => { const f = await attFixture(); await end(f); });
  await ok("shift unknown: guard skipped", async () => { const f = await attFixture(); await end({ ...f, sh: { id: rid() } }); });
  await bad("another Nurse", "Only original Nurse signs professional attendance", async () => { const f = await attFixture(); await end(f, { signed_by: await staff("NURSE") }); });
  await bad("second end", "Attendance already has a retained factual end", async () => { const f = await attFixture(); await end(f); await end(f, { ended_at: ts(70) }); });
  await bad("end before start", "Attendance end outside actual episode", async () => { const f = await attFixture(); await end(f, { ended_at: ts(-1) }); });
  await bad("end after departure", "Attendance end outside actual episode", async () => { const f = await attFixture(); await ins("departures", { admission_id: f.adm.id, departed_at: ts(40), bill_version: 1 }); await end(f); });
  await bad("end before actual care", "Attendance cannot end before actual care or physical handover", async () => {
    const f = await attFixture(); await ins("medication_administrations", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(90), outcome: "GIVEN" }); await end(f); });
});
await test("effective_attendance_guard_administrative_shift_ends", async () => {
  const setup = async () => {
    const f = await attFixture(); const admin = await staff("ADMIN");
    const x = await adminEx(f.adm.id, { type: "UNAVAILABLE_APPROVER", disposition: "CLOSE_ATTENDANCE", source_id: f.sh.id, signed_by: admin });
    return { ...f, admin, x };
  };
  const end = (f, o) => ins("administrative_shift_ends", { admission_id: f.adm.id, shift_id: f.sh.id, exception_id: f.x.id, ended_at: ts(60), signed_by: f.admin, ...o });
  await ok("Admin closes attendance under exception", async () => { const f = await setup(); await end(f); });
  await bad("exception for another shift", "Original shift and actual Admin exception authority required", async () => { const f = await setup(); await c.query("UPDATE admin_exceptions SET source_id=? WHERE id=?", [rid(), f.x.id]); await end(f); });
  await bad("signer is not an Admin", "Original shift and actual Admin exception authority required", async () => { const f = await setup(); await end(f, { signed_by: f.nurse }); });
  await bad("end in the future", "Actual attendance evidence cannot be in future", async () => { const f = await setup(); await end(f, { ended_at: "2099-01-01 00:00:00.000000" }); });
  await bad("second end", "Attendance already has a retained factual end", async () => { const f = await setup(); await end(f); await end(f, { ended_at: ts(70) }); });
});

await test("effective_consumable_source", async () => {
  const mk = async (o) => { const adm = await admission(); const bed = rid(); const st = await stay(adm.id, { bed_id: bed }); return ins("nursing_consumables", { admission_id: adm.id, stay_id: st.id, bed_id: bed, used_at: ts(30), ...o }); };
  await ok("use within the open stay", async () => { await mk({}); });
  await bad("use before the stay", "Consumable must retain its actual effective physical source unit", async () => { await mk({ used_at: ts(-30) }); });
  await bad("other bed", "Consumable must retain its actual effective physical source unit", async () => { await mk({ bed_id: rid() }); });
});
await test("exception_attendance_end", async () => {
  const mk = async () => { const adm = await admission(); const nurse = await staff("NURSE"); const sh = await shift(adm.id, nurse); return { adm, nurse, sh }; };
  await ok("end after witnessed evidence", async () => { const f = await mk(); await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(30) }); await ins("nursing_shift_ends", { shift_id: f.sh.id, ended_at: ts(60), signed_by: f.nurse }); });
  await bad("end before witnessed evidence", "Attendance cannot end before witnessed physical exception evidence", async () => {
    const f = await mk(); await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(90) }); await ins("nursing_shift_ends", { shift_id: f.sh.id, ended_at: ts(60), signed_by: f.nurse }); });
});

await test("exception_evidence_source", async () => {
  const mk = async (admO = {}) => { const adm = await admission(admO); return { adm, doc: adm.admitting_doctor_id }; };
  await ok("assigned Doctor evidence", async () => { const f = await mk(); await evidence(f.adm.id, { signed_by: f.doc, actual_at: ts(10), signed_at: ts(11) }); });
  await bad("signer role differs", "Current professional evidence with factual episode time required", async () => { const f = await mk(); const n = await staff("NURSE"); await evidence(f.adm.id, { signed_by: n }); });
  await bad("evidence before admission", "Current professional evidence with factual episode time required", async () => { const f = await mk(); await evidence(f.adm.id, { signed_by: f.doc, actual_at: ts(-5), signed_at: ts(-4) }); });
  await bad("evidence in the future", "Current professional evidence with factual episode time required", async () => { const f = await mk(); await evidence(f.adm.id, { signed_by: f.doc, actual_at: "2099-01-01 00:00:00.000000", signed_at: "2099-01-01 00:00:00.000000" }); });
  await bad("signed before it happened", "Current professional evidence with factual episode time required", async () => { const f = await mk(); await evidence(f.adm.id, { signed_by: f.doc, actual_at: ts(10), signed_at: ts(5) }); });
  await bad("discharged admission, ordinary kind", "Current professional evidence with factual episode time required", async () => { const f = await mk({ status: "DISCHARGED" }); await evidence(f.adm.id, { signed_by: f.doc }); });
  await bad("not the assigned Doctor", "Assigned Doctor evidence required", async () => { const f = await mk(); const other = await staff("DOCTOR"); await evidence(f.adm.id, { signed_by: other }); });
  await bad("professional review without authority", "Professional follow-up requires specific retained departure authority", async () => {
    const f = await mk({ status: "DISCHARGED" }); await evidence(f.adm.id, { kind: "PROFESSIONAL_REVIEW", signed_by: f.doc, exception_id: rid(), source_id: rid() }); });
  await bad("room cutoff without authority", "Cutoff witness must bind retained original authority", async () => {
    const f = await mk(); const n = await staff("NURSE"); const sh = await shift(f.adm.id, n); await assign(f.adm.id, n);
    await evidence(f.adm.id, { role: "NURSE", kind: "ROOM_CUTOFF", shift_id: sh.id, signed_by: n, exception_id: rid(), source_id: rid() }); });
  await ok("Nurse witness with assignment and attendance", async () => {
    const f = await mk(); const n = await staff("NURSE"); const sh = await shift(f.adm.id, n); await assign(f.adm.id, n);
    await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: sh.id, signed_by: n, actual_at: ts(30), signed_at: ts(31) }); });
  await bad("Nurse without assignment", "Current assigned Nurse and actual attendance required", async () => {
    const f = await mk(); const n = await staff("NURSE"); const sh = await shift(f.adm.id, n);
    await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: sh.id, signed_by: n }); });
  await bad("Nurse with revoked assignment", "Current assigned Nurse and actual attendance required", async () => {
    const f = await mk(); const n = await staff("NURSE"); const sh = await shift(f.adm.id, n); const a = await assign(f.adm.id, n);
    await ins("nurse_assignment_revocations", { assignment_id: a.id });
    await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: sh.id, signed_by: n }); });
  await bad("vacancy after the exit", "Physical vacancy must precede hospital exit", async () => {
    const f = await mk(); const n = await staff("NURSE"); const sh = await shift(f.adm.id, n); await assign(f.adm.id, n);
    await evidence(f.adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: sh.id, signed_by: n, actual_at: ts(30), signed_at: ts(31), vacated_at: ts(40) }); });
});

await test("exception_followups_source", async () => {
  const setup = async () => {
    const adm = await admission(); const admin = await staff("ADMIN"); const owner = await staff("NURSE");
    const x = await adminEx(adm.id, { signed_by: admin, follow_up_owner_id: owner }); return { adm, admin, owner, x };
  };
  const fu = (f, o) => ins("exception_followups", { exception_id: f.x.id, admission_id: f.adm.id, owner_id: f.owner, signed_by: f.owner, ...o });
  await ok("owner records follow-up", async () => { const f = await setup(); await fu(f); });
  await ok("Admin reassigns owner", async () => { const f = await setup(); const o2 = await staff("NURSE"); await fu(f, { signed_by: f.admin, owner_id: o2 }); });
  await bad("owner reassigns to someone else", "Current accountable owner or Admin must record follow-up", async () => { const f = await setup(); const o2 = await staff("NURSE"); await fu(f, { owner_id: o2 }); });
  await bad("stranger records", "Current accountable owner or Admin must record follow-up", async () => { const f = await setup(); await fu(f, { signed_by: await staff("NURSE") }); });
  await bad("banned signer", "Current accountable owner or Admin must record follow-up", async () => { const f = await setup(); await fu(f, { signed_by: await staff("ADMIN", { banned: 1 }) }); });
  await bad("exception of another admission", "Current accountable owner or Admin must record follow-up", async () => { const f = await setup(); const o = await admission(); await fu({ ...f, adm: o }); });
  await bad("banned new owner", "Current accountable owner or Admin must record follow-up", async () => { const f = await setup(); await fu(f, { signed_by: f.admin, owner_id: await staff("NURSE", { banned: 1 }) }); });
  await ok("current owner after reassignment", async () => {
    const f = await setup(); const o2 = await staff("NURSE"); await fu(f, { signed_by: f.admin, owner_id: o2 }); await fu(f, { signed_by: o2, owner_id: o2 }); });
});

// ---- exceptional departure & exit chronology ------------------------------------------------------------------
async function exitFixture(o = {}) {
  const adm = await admission(); const nurse = await staff("NURSE"); const admin = await staff("ADMIN"); const doc = adm.admitting_doctor_id;
  const sh = await shift(adm.id, nurse); const st = await stay(adm.id, { ended_at: ts(60) });
  const phys = await evidence(adm.id, { role: "NURSE", kind: "PHYSICAL_EXIT", shift_id: sh.id, signed_by: nurse, actual_at: ts(61), signed_at: ts(62), vacated_at: ts(60) });
  const dis = await evidence(adm.id, { role: "DOCTOR", kind: "DEATH", signed_by: doc, actual_at: ts(50), signed_at: ts(51), ...o.dis });
  const x = await adminEx(adm.id, { type: "DEATH", disposition: "EXCEPTIONAL_EXIT", signed_by: admin, evidence_ids: JSON.stringify([phys.id, dis.id]), ...o.x });
  return { adm, nurse, admin, doc, sh, st, phys, dis, x };
}
const departure = (f, o = {}) => ins("exceptional_departures", { admission_id: f.adm.id, exception_id: f.x.id, physical_evidence_id: f.phys.id, stay_id: f.st.id, departed_at: ts(61), snapshot: "{}", signed_by: f.admin, ...o });
await test("exceptional_departure_source", async () => {
  await ok("source-linked departure", async () => { await departure(await exitFixture()); });
  await bad("departed_at differs from witness", "Actual source-linked exceptional departure required", async () => { await departure(await exitFixture(), { departed_at: ts(70) }); });
  await bad("signer not Admin", "Actual source-linked exceptional departure required", async () => { const f = await exitFixture(); await departure(f, { signed_by: f.nurse }); });
  await bad("not an exceptional-exit authority", "Actual source-linked exceptional departure required", async () => { await departure(await exitFixture({ x: { disposition: "FOLLOW_UP" } })); });
  await bad("ordinary departure already exists", "Actual source-linked exceptional departure required", async () => { const f = await exitFixture(); await ins("departures", { admission_id: f.adm.id, departed_at: ts(61), bill_version: 1 }); await departure(f); });
  await bad("witness not part of the authority", "Actual departure witness must be included in authority", async () => { await departure(await exitFixture({ x: { evidence_ids: "[]" } })); });
  await bad("care recorded after the claimed departure", "Recorded actual care or attendance continues after claimed departure", async () => {
    const f = await exitFixture(); await ins("medication_administrations", { admission_id: f.adm.id, shift_id: f.sh.id, signed_by: f.nurse, actual_at: ts(80), outcome: "GIVEN" }); await departure(f); });
});
await test("actual_doctor_exit_chronology", async () => {
  await ok("Doctor disposition before any exit", async () => { const adm = await admission(); await evidence(adm.id, { kind: "DEATH" }); });
  await ok("non-disposition kind after exit", async () => { const adm = await admission(); await ins("departures", { admission_id: adm.id, departed_at: ts(5), bill_version: 1 }); await evidence(adm.id, { kind: "RETURN_TO_BED" }); });
  await bad("Doctor disposition after ordinary exit", "Actual professional disposition cannot occur after actual hospital exit", async () => {
    const adm = await admission(); await ins("departures", { admission_id: adm.id, departed_at: ts(5), bill_version: 1 }); await evidence(adm.id, { kind: "DEATH", actual_at: ts(10) }); });
  await bad("Doctor disposition after exceptional exit", "Actual professional disposition cannot occur after actual hospital exit", async () => {
    const adm = await admission(); await ins("exceptional_departures", { admission_id: adm.id, departed_at: ts(5) }); await evidence(adm.id, { kind: "PLANNED_EXIT", actual_at: ts(10) }); });
});
await test("planned_exception_instruction", async () => {
  await ok("non-planned type", async () => { const adm = await admission(); await adminEx(adm.id, { type: "DEATH", disposition: "EXCEPTIONAL_EXIT" }); });
  await ok("CREDIT exit with no open return", async () => { const adm = await admission(); await adminEx(adm.id, { type: "CREDIT", disposition: "EXCEPTIONAL_EXIT" }); });
  await ok("CREDIT follow-up skips the check", async () => { const f = await vacationFixture(); await instruction(f); await adminEx(f.adm.id, { type: "CREDIT", disposition: "FOLLOW_UP" }); });
  await bad("open return instruction", "Planned departure requires actual return or source-bound Doctor reconsideration", async () => {
    const f = await vacationFixture(); await instruction(f); await adminEx(f.adm.id, { type: "CREDIT", disposition: "EXCEPTIONAL_EXIT" }); });
  await bad("returned but no fresh exit disposition", "Actual return requires fresh appropriate Doctor exit disposition", async () => {
    const f = await vacationFixture(); const d = await instruction(f); await ins("room_returns", { admission_id: f.adm.id, vacation_id: f.vac.id, doctor_evidence_id: d.id, returned_at: ts(60) });
    await adminEx(f.adm.id, { type: "INSURANCE_DELAY", disposition: "EXCEPTIONAL_EXIT" }); });
  await ok("returned and fresh planned exit selected", async () => {
    const f = await vacationFixture(); const d = await instruction(f); await ins("room_returns", { admission_id: f.adm.id, vacation_id: f.vac.id, doctor_evidence_id: d.id, returned_at: ts(60) });
    const pe = await evidence(f.adm.id, { kind: "PLANNED_EXIT", signed_by: f.doc, actual_at: ts(70), signed_at: ts(71) });
    await adminEx(f.adm.id, { type: "CREDIT", disposition: "EXCEPTIONAL_EXIT", evidence_ids: JSON.stringify([pe.id]) }); });
});
await test("selected_doctor_exit_chronology", async () => {
  await ok("selected disposition precedes the exit", async () => { await departure(await exitFixture()); });
  await bad("selected disposition after the exit", "Selected actual Doctor disposition cannot follow the witnessed hospital exit", async () => {
    await departure(await exitFixture({ dis: { actual_at: ts(70), signed_at: ts(71) } })); });
  await bad("authority selects no matching disposition", "Selected actual Doctor disposition cannot follow the witnessed hospital exit", async () => {
    const f = await exitFixture({ x: {} }); await c.query("UPDATE admin_exceptions SET evidence_ids=? WHERE id=?", [JSON.stringify([f.phys.id]), f.x.id]); await departure(f); });
  await ok("authority needing no Doctor kind (EARLY_EXIT)", async () => { await departure(await exitFixture({ x: { type: "EARLY_EXIT" } })); });
  await bad("PLANNED_EXIT with open return instruction", "Planned departure requires actual return or source-bound Doctor reconsideration", async () => {
    const f = await exitFixture({ dis: { kind: "PLANNED_EXIT" }, x: { type: "CREDIT" } });
    const vac = await ins("room_vacations", { admission_id: f.adm.id, stay_id: f.st.id, shift_id: f.sh.id, vacated_at: ts(30), signed_by: f.nurse });
    await evidence(f.adm.id, { kind: "RETURN_TO_BED", source_id: vac.id, signed_by: f.doc, actual_at: ts(40), signed_at: ts(41) });
    await departure(f); });
});

// ---- final financial source ----------------------------------------------------------------------------------------
async function setting(hospital, payload) { return ins("setting_versions", { hospital_id: hospital, kind: "tariff", version: 1, actor_type: "staff", actor_id: "a", reason: "r", payload: JSON.stringify(payload) }); }
async function closedFixture() {
  const adm = await admission({ status: "DISCHARGED" });
  const pol = await setting(adm.hospital_id, { type: "billable-item", code: "XR1", category: "lab", unit: "test", amount: "100" });
  return { adm, pol };
}
const chargeRow = (f, o = {}) => ({ admission_id: f.adm.id, category: "lab", item_id: "XR1", quantity: "2", unit: "test", tariff_version_id: f.pol?.id ?? rid(), rate_paise: 100, amount_paise: 200, initial_status: "FINAL", actor_type: "staff", actor_id: "u", ...o });
await test("final_charge_source", async () => {
  await ok("charge on an open admission", async () => { const adm = await admission(); await ins("charges", chargeRow({ adm })); });
  await ok("closed room charge by the system", async () => { const adm = await admission({ status: "DISCHARGED" }); await ins("charges", chargeRow({ adm }, { category: "room", actor_type: "system", actor_id: "room-charge" })); });
  await bad("closed non-room charge without authority", "Closed non-room money requires exact source-bound amendment authority", async () => { const f = await closedFixture(); await ins("charges", chargeRow(f)); });
  const lab = async (xO = {}, bO = {}, snapshot = '{"billVersion":1}') => {
    const f = await closedFixture(); const labUser = await staff("LAB"); const admin = await staff("ADMIN");
    const order = rid(); const b = await ins("care_billing_events", { admission_id: f.adm.id, order_id: order, category: "lab", item_id: "XR1", quantity: "2", unit: "test", tariff_version_id: f.pol.id, ...bO });
    await ins("lab_processing", { order_id: order, admission_id: f.adm.id });
    const x = await adminEx(f.adm.id, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "LAB_BILLING", source_id: order, signed_by: admin, snapshot, ...xO });
    return { ...f, labUser, b, x };
  };
  const post = (f, o = {}) => ins("charges", chargeRow(f, { source_event_id: f.b.id, actor_id: f.labUser, correction_exception_id: f.x.id, ...o }));
  await ok("closed diagnostic fee from original Lab source", async () => { const f = await lab(); await post(f); });
  await bad("stale bill version", "Closed financial effect needs fresh exact Admin authority", async () => { const f = await lab({}, {}, '{"billVersion":9}'); await post(f); });
  await bad("wrong rate or quantity", "Closed charge must retain the exact configured rate and original quantity", async () => { const f = await lab(); await post(f, { amount_paise: 201 }); });
  await bad("not the Lab role", "Closed diagnostic fee requires original performed Lab source", async () => { const f = await lab(); await post(f, { actor_id: await staff("NURSE") }); });
  await bad("authority kind without charge path", "No authority for this closed charge", async () => { const f = await lab({ correction_kind: "RECEIPT" }); await post(f); });
  await bad("actor not staff", "Closed financial effect needs fresh exact Admin authority", async () => { const f = await lab(); await post(f, { actor_id: rid() }); });
  const care = async (cat, admO, extra = {}) => {
    const f = await closedFixture(); const admin = await staff("ADMIN"); const actor = extra.actor; const round = rid();
    await c.query("UPDATE setting_versions SET payload = JSON_SET(payload, '$.category', ?) WHERE id = ?", [cat, f.pol.id]);
    if (cat === "consultation") await ins("clinical_rounds", { id: round, admission_id: f.adm.id });
    const b = await ins("care_billing_events", { admission_id: f.adm.id, category: cat, item_id: "XR1", quantity: "2", unit: "test", tariff_version_id: f.pol.id, round_id: cat === "consultation" ? round : null, created_at: ts(10) });
    await ins("departures", { admission_id: f.adm.id, departed_at: ts(100), signed_at: ts(110), bill_version: 1 });
    const x = await adminEx(f.adm.id, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "CARE_BILLING", source_id: b.id, signed_by: admin, snapshot: '{"billVersion":1}' });
    return { ...f, b, x, actor };
  };
  await ok("closed consultation fee by the assigned Doctor", async () => {
    const doc = await staff("DOCTOR"); const f = await care("consultation"); await c.query("UPDATE admissions SET admitting_doctor_id=? WHERE id=?", [doc, f.adm.id]);
    await ins("charges", chargeRow(f, { category: "consultation", source_event_id: f.b.id, actor_id: doc, correction_exception_id: f.x.id })); });
  await bad("closed consultation fee by another Doctor", "Closed care fee requires original performed source quantity pin and current proper role", async () => {
    const doc = await staff("DOCTOR"); const f = await care("consultation");
    await ins("charges", chargeRow(f, { category: "consultation", source_event_id: f.b.id, actor_id: doc, correction_exception_id: f.x.id })); });
  await bad("closed care fee priced for work done after the exit", "Closed care pricing cannot create new retrospective clinical work", async () => {
    const doc = await staff("DOCTOR"); const f = await care("consultation"); await c.query("UPDATE admissions SET admitting_doctor_id=? WHERE id=?", [doc, f.adm.id]);
    await c.query("UPDATE care_billing_events SET created_at=? WHERE id=?", [ts(500), f.b.id]);
    await ins("charges", chargeRow(f, { category: "consultation", source_event_id: f.b.id, actor_id: doc, correction_exception_id: f.x.id })); });
});

await test("final_reversal_source", async () => {
  const base = async (admO = {}) => {
    const adm = await admission(admO); const ch = await ins("charges", chargeRow({ adm }, { category: "pharmacy", amount_paise: 500, rate_paise: 500, quantity: "1" }));
    return { adm, ch };
  };
  const rev = (f, o = {}) => ins("charge_reversals", { charge_id: f.ch.id, amount_paise: 100, actor_type: "staff", actor_id: "u", ...o });
  await ok("reversal on an open admission", async () => { await rev(await base()); });
  await bad("reversal exceeds the source", "Reversal exceeds remaining original source", async () => { const f = await base(); await rev(f, { amount_paise: 300 }); await rev(f, { amount_paise: 201 }); });
  await bad("closed non-room reversal without authority", "Closed non-room money requires exact source-bound amendment authority", async () => { await rev(await base({ status: "DISCHARGED" })); });
  await bad("physical amendment on a non-room charge", "Physical amendment only corrects its original room source", async () => { await rev(await base(), { physical_amendment_id: rid() }); });
  const closed = async (xO = {}, role = "ADMIN") => {
    const f = await base({ status: "DISCHARGED" }); const admin = await staff("ADMIN"); const actor = await staff(role);
    const x = await adminEx(f.adm.id, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "REVERSE_CHARGE", source_id: f.ch.id, signed_by: admin, snapshot: '{"billVersion":1}', ...xO });
    return { ...f, x, actor };
  };
  await ok("closed reversal by Billing under exact authority", async () => { const f = await closed({}, "BILLING"); await rev(f, { actor_id: f.actor, correction_exception_id: f.x.id }); });
  await bad("closed reversal by a Nurse", "Closed reversal requires proper Billing role and original non-room charge", async () => { const f = await closed({}, "NURSE"); await rev(f, { actor_id: f.actor, correction_exception_id: f.x.id }); });
  await bad("authority bound to another charge", "Closed reversal requires proper Billing role and original non-room charge", async () => { const f = await closed({ source_id: rid() }); await rev(f, { actor_id: f.actor, correction_exception_id: f.x.id }); });
  await bad("authority for a stale bill", "Closed financial effect needs fresh exact Admin authority", async () => { const f = await closed({ snapshot: '{"billVersion":4}' }); await rev(f, { actor_id: f.actor, correction_exception_id: f.x.id }); });
  // room reversals: stay of 2 days, tariff 100/day started-unit => due 200; room charges total 500
  const room = async () => {
    const adm = await admission({ status: "DISCHARGED" }); const admin = await staff("ADMIN");
    const pol = await setting(adm.hospital_id, { amount: "100", basis: "day", rounding: "started-unit", graceMinutes: 0 });
    const st = await stay(adm.id, { tariff_version_id: pol.id, started_at: ts(0), ended_at: ts(2 * 24 * 60) });
    const am = await ins("stay_boundary_amendments", { admission_id: adm.id, stay_id: st.id, version: 1, started_at: ts(0), ended_at: ts(2 * 24 * 60), signed_by: admin });
    const ch = await ins("charges", chargeRow({ adm }, { category: "room", source_event_id: `room:${st.id}:1`, amount_paise: 500, rate_paise: 100, actor_type: "system", actor_id: "room-charge" }));
    return { adm, admin, st, am, ch };
  };
  await ok("room reversal leaving the pinned rate for occupied time", async () => { const f = await room(); await rev(f, { amount_paise: 300, actor_id: f.admin, physical_amendment_id: f.am.id }); });
  await bad("room reversal waiving occupied time", "Physical correction cannot waive occupied time or double-credit the pinned room rate", async () => { const f = await room(); await rev(f, { amount_paise: 301, actor_id: f.admin, physical_amendment_id: f.am.id }); });
  await bad("room reversal without the amendment", "Room reversal requires the current original-source physical amendment", async () => { const f = await room(); await rev(f, { amount_paise: 100, actor_id: f.admin }); });
  await bad("room reversal by non-Admin", "Room reversal requires the current original-source physical amendment", async () => { const f = await room(); await rev(f, { amount_paise: 100, actor_id: await staff("BILLING"), physical_amendment_id: f.am.id }); });
});

// ---- insurance ------------------------------------------------------------------------------------------------
const insCase = async () => { const adm = await admission({ payment_route: "INSURED" }); const ic = await ins("insurance_cases", { admission_id: adm.id }); return { adm, ic }; };
await test("insurance_document_source", async () => {
  const doc = (f, o = {}) => ins("insurance_documents", { case_id: f.ic.id, set_revision: 1, mime: "application/pdf", size_bytes: 5, sha256: "b".repeat(64), ...o });
  await ok("first document", async () => { await doc(await insCase()); });
  await ok("replacement within the case", async () => { const f = await insCase(); const d = await doc(f); await doc(f, { replaces_document_id: d.id, set_revision: 2 }); });
  await bad("replacement from another case", "Document replacement requires same case", async () => { const f = await insCase(); const g = await insCase(); const d = await doc(g); await doc(f, { replaces_document_id: d.id }); });
  await bad("replacement of unknown document", "Document replacement requires same case", async () => { const f = await insCase(); await doc(f, { replaces_document_id: rid() }); });
});
await test("insurance_decision_source", async () => {
  const dec = (f, ev) => ins("insurance_decisions", { case_id: f.ic.id, case_version: 1, policy_event_id: ev, status: "PENDING", kind: "PREAUTH", approved_paise: 0, co_pay_bps: 0, allocation: "{}", document_ids: "[]" });
  await ok("decision on same-case POLICY event", async () => { const f = await insCase(); const ev = await ins("insurance_events", { case_id: f.ic.id, case_version: 1, kind: "POLICY", payload: "{}" }); await dec(f, ev.id); });
  await bad("policy event of another case", "Decision requires same-case external policy evidence", async () => { const f = await insCase(); const g = await insCase(); const ev = await ins("insurance_events", { case_id: g.ic.id, case_version: 1, kind: "POLICY", payload: "{}" }); await dec(f, ev.id); });
  await bad("event is not a POLICY", "Decision requires same-case external policy evidence", async () => { const f = await insCase(); const ev = await ins("insurance_events", { case_id: f.ic.id, case_version: 1, kind: "FOLLOWUP", payload: "{}" }); await dec(f, ev.id); });
});
await test("insurance_resolution_source", async () => {
  const res = (f, o) => ins("insurance_transfer_resolutions", { case_id: f.ic.id, verified_at: ts(0), ...o });
  const task = (f) => ins("transfer_insurance_tasks", { admission_id: f.adm.id });
  await ok("resolution with same-case decision", async () => {
    const f = await insCase(); const t = await task(f); const d = await ins("insurance_decisions", { case_id: f.ic.id, case_version: 1, status: "PENDING", kind: "PREAUTH", approved_paise: 0, co_pay_bps: 0, allocation: "{}", document_ids: "[]" });
    await res(f, { task_id: t.id, decision_id: d.id }); });
  await ok("resolution with same-case conversion", async () => {
    const f = await insCase(); const t = await task(f); const cv = await ins("insurance_conversions", { case_id: f.ic.id, case_version: 1, verified_at: ts(0), allocation: "{}" });
    await res(f, { task_id: t.id, conversion_id: cv.id }); });
  await bad("task of another episode", "Transfer resolution requires same episode", async () => {
    const f = await insCase(); const g = await insCase(); const t = await task(g); const d = await ins("insurance_decisions", { case_id: f.ic.id, case_version: 1, status: "PENDING", kind: "PREAUTH", approved_paise: 0, co_pay_bps: 0, allocation: "{}", document_ids: "[]" });
    await res(f, { task_id: t.id, decision_id: d.id }); });
  await bad("decision of another case", "Transfer resolution requires same-case evidence", async () => {
    const f = await insCase(); const g = await insCase(); const t = await task(f); const d = await ins("insurance_decisions", { case_id: g.ic.id, case_version: 1, status: "PENDING", kind: "PREAUTH", approved_paise: 0, co_pay_bps: 0, allocation: "{}", document_ids: "[]" });
    await res(f, { task_id: t.id, decision_id: d.id }); });
  await bad("conversion of another case", "Transfer resolution requires same-case evidence", async () => {
    const f = await insCase(); const g = await insCase(); const t = await task(f); const cv = await ins("insurance_conversions", { case_id: g.ic.id, case_version: 1, verified_at: ts(0), allocation: "{}" });
    await res(f, { task_id: t.id, conversion_id: cv.id }); });
});

// ---- lab -------------------------------------------------------------------------------------------------------
const diag = async (kind = "LAB") => { const adm = await admission(); const order = await ins("clinical_orders", { admission_id: adm.id, kind, details: "{}" }); return { adm, order }; };
const stopped = (f) => ins("clinical_task_events", { order_id: f.order.id, status: "STOPPED" });
await test("lab_disposition_source", async () => {
  const disp = (f, ev, o = {}) => ins("lab_dispositions", { order_id: f.order.id, admission_id: f.adm.id, stop_event_id: ev.id, reason: "not performed", ...o });
  await ok("stopped order, no charge", async () => { const f = await diag(); const ev = await stopped(f); await disp(f, ev); });
  await bad("order not stopped", "Disposition requires actual stopped diagnostic source", async () => { const f = await diag(); const ev = await ins("clinical_task_events", { order_id: f.order.id, status: "COMPLETED" }); await disp(f, ev); });
  await bad("non-diagnostic order", "Disposition requires actual stopped diagnostic source", async () => { const f = await diag("DIET"); const ev = await stopped(f); await disp(f, ev); });
  await bad("sample already taken", "Performed diagnostic work cannot be cancelled as unperformed", async () => {
    const f = await diag(); const ev = await stopped(f); await ins("lab_samples", { order_id: f.order.id, admission_id: f.adm.id, barcode: bc() }); await disp(f, ev); });
  await bad("reversal without a charge", "Disposition cannot reverse a missing source", async () => { const f = await diag(); const ev = await stopped(f); await disp(f, ev, { reversal_id: rid() }); });
  const withCharge = async (amount) => {
    const f = await diag(); const ev = await stopped(f); const b = await ins("care_billing_events", { id: rid(), admission_id: f.adm.id, order_id: f.order.id, category: "lab" });
    const ch = await ins("charges", chargeRow({ adm: f.adm }, { source_event_id: b.id, initial_status: "PENDING", amount_paise: amount }));
    return { ...f, ev, ch };
  };
  await ok("charged order, exact reversal", async () => { const f = await withCharge(200); const r = await ins("charge_reversals", { charge_id: f.ch.id, amount_paise: 200, actor_type: "staff" }); await disp(f, f.ev, { reversal_id: r.id }); });
  await bad("charged order, short reversal", "Disposition must reverse the exact original source amount", async () => { const f = await withCharge(200); const r = await ins("charge_reversals", { charge_id: f.ch.id, amount_paise: 100, actor_type: "staff" }); await disp(f, f.ev, { reversal_id: r.id }); });
  await bad("charged order, no reversal", "Disposition must reverse the exact original source amount", async () => { const f = await withCharge(200); await disp(f, f.ev); });
  await bad("finalized charge", "Only original pending source can receive unperformed disposition", async () => { const f = await withCharge(200); await ins("charge_finalizations", { charge_id: f.ch.id, actor_type: "staff" }); await disp(f, f.ev); });
  await ok("zero-price charge, no reversal", async () => { const f = await withCharge(0); await disp(f, f.ev); });
  await bad("zero-price charge with fake reversal", "Zero-price source needs no fake reversal", async () => { const f = await withCharge(0); await disp(f, f.ev, { reversal_id: rid() }); });
});
await test("lab_samples_source", async () => {
  const smp = (f, o = {}) => ins("lab_samples", { order_id: f.order.id, admission_id: f.adm.id, patient_id: f.adm.patient_id, barcode: bc(), ...o });
  await ok("sample for a LAB order", async () => { await smp(await diag()); });
  await bad("order of another episode", "Diagnostic order/episode mismatch", async () => { const f = await diag(); const o = await admission(); await smp(f, { admission_id: o.id }); });
  await bad("RADIOLOGY order", "Sample patient/order mismatch or stopped source", async () => { await smp(await diag("RADIOLOGY")); });
  await bad("other patient", "Sample patient/order mismatch or stopped source", async () => { const f = await diag(); await smp(f, { patient_id: rid() }); });
  await bad("stopped order", "Sample patient/order mismatch or stopped source", async () => { const f = await diag(); await stopped(f); await smp(f); });
  await bad("disposed order", "Unperformed diagnostic order was disposed", async () => { const f = await diag(); await ins("lab_dispositions", { order_id: f.order.id, admission_id: f.adm.id, stop_event_id: rid(), reason: "not performed" }); await smp(f); });
});
await test("lab_processing_source", async () => {
  const proc = (f, o = {}) => ins("lab_processing", { order_id: f.order.id, admission_id: f.adm.id, ...o });
  await ok("processing bound to the sample", async () => { const f = await diag(); const s = await ins("lab_samples", { order_id: f.order.id, admission_id: f.adm.id, patient_id: f.adm.patient_id, barcode: bc() }); await proc(f, { sample_id: s.id }); });
  await ok("RADIOLOGY without sample", async () => { await proc(await diag("RADIOLOGY"), {}); });
  await bad("LAB without sample", "Diagnostic sample binding mismatch", async () => { await proc(await diag(), {}); });
  await bad("RADIOLOGY with a sample", "Diagnostic sample binding mismatch", async () => { await proc(await diag("RADIOLOGY"), { sample_id: rid() }); });
  await bad("stopped order", "Doctor-stopped work cannot begin processing", async () => { const f = await diag("RADIOLOGY"); await stopped(f); await proc(f); });
  await bad("order of another episode", "Diagnostic order/episode mismatch", async () => { const f = await diag(); const o = await admission(); await proc(f, { admission_id: o.id }); });
});
await test("lab_reports_source", async () => {
  const rep = (f, o = {}) => ins("lab_reports", { order_id: f.order.id, admission_id: f.adm.id, result: "normal", ...o });
  await ok("report after processing (RADIOLOGY)", async () => { const f = await diag("RADIOLOGY"); await ins("lab_processing", { order_id: f.order.id, admission_id: f.adm.id }); await rep(f); });
  await ok("report after processing (LAB)", async () => {
    const f = await diag(); const s = await ins("lab_samples", { order_id: f.order.id, admission_id: f.adm.id, patient_id: f.adm.patient_id, barcode: bc() });
    await ins("lab_processing", { order_id: f.order.id, admission_id: f.adm.id, sample_id: s.id }); await rep(f, { sample_id: s.id }); });
  await bad("report before processing", "Actual processing is required before reporting", async () => { const f = await diag("RADIOLOGY"); await rep(f); });
  await bad("report with another sample", "Diagnostic sample binding mismatch", async () => {
    const f = await diag(); const s = await ins("lab_samples", { order_id: f.order.id, admission_id: f.adm.id, patient_id: f.adm.patient_id, barcode: bc() });
    await ins("lab_processing", { order_id: f.order.id, admission_id: f.adm.id, sample_id: s.id }); await rep(f, { sample_id: rid() }); });
});

// ---- legacy workflow guard (22 tables) -------------------------------------------------------------------------
const legacyRow = {
  care_billing_events: (a) => ({ admission_id: a, state: "READY" }),
  care_occurrences: (a) => ({ admission_id: a }),
  care_tasks: (a) => ({ admission_id: a }),
  clinical_addenda: (a, extra) => ({ note_id: extra.round }),
  clinical_orders: (a) => ({ admission_id: a, kind: "LAB", details: "{}" }),
  clinical_rounds: (a) => ({ admission_id: a }),
  clinical_summaries: (a) => ({ admission_id: a, prescription: "{}" }),
  clinical_task_events: (a, extra) => ({ order_id: extra.order, status: "STOPPED" }),
  exception_evidence: (a) => ({ admission_id: a, role: "DOCTOR", kind: "DEATH" }),
  lab_dispositions: (a) => ({ admission_id: a }),
  lab_processing: (a) => ({ admission_id: a }),
  lab_report_addenda: (a, extra) => ({ report_id: extra.report }),
  lab_reports: (a) => ({ admission_id: a }),
  lab_samples: (a) => ({ admission_id: a, barcode: bc() }),
  medication_administrations: (a) => ({ admission_id: a, outcome: "GIVEN" }),
  nursing_addenda: (a) => ({ admission_id: a, record_type: "MAR" }),
  nursing_consumables: (a) => ({ admission_id: a }),
  nursing_observations: (a) => ({ admission_id: a }),
  pharmacy_movements: (a) => ({ admission_id: a, batch_id: rid(), kind: "ISSUE", quantity: -1, reference: rs(), purpose: "WARD", order_id: rid(), charge_id: rid() }),
  pharmacy_preparations: (a) => ({ admission_id: a }),
  transfer_order_cancellations: (a) => ({ admission_id: a }),
  transfer_orders: (a) => ({ admission_id: a }),
};
for (const table of Object.keys(legacyRow)) {
  await test(`aa_mvp_legacy_workflow_${table}`, async () => {
    const mkRow = async (adm) => {
      const extra = {};
      if (table === "clinical_addenda") extra.round = (await ins("clinical_rounds", { admission_id: adm.id })).id;
      if (table === "clinical_task_events") extra.order = (await ins("clinical_orders", { admission_id: adm.id, kind: "LAB", details: "{}" })).id;
      if (table === "lab_report_addenda") extra.report = (await ins("lab_reports", { admission_id: adm.id })).id;
      return legacyRow[table](adm.id, extra);
    };
    const v1 = await admission(); const v2 = await admission({ workflow_version: 2 });
    await ok("version 1 episode", async () => { await ins(table, await mkRow(v1)); });
    await bad("version 2 episode", "Legacy chart, Doctor-login and native department sources require a version 1 episode", async () => { await ins(table, await mkRow(v2)); });
    if (table === "pharmacy_movements") {
      await ok("movement without episode or order", async () => { await ins(table, { batch_id: rid(), kind: "RECEIPT", quantity: 1, reference: rs() }); });
    }
  });
}

// ---- constraint-trigger replacement queries (docs/agent/MARIADB_PORT_GAPS.md) ----------------------------------------
await only([]);
const gapQueries = {
  stock: (ids) => c.query(`SELECT b.id FROM pharmacy_batches b WHERE b.id IN (?) AND NOT EXISTS (SELECT 1 FROM pharmacy_batches x WHERE x.id = b.id AND x.available_quantity = COALESCE((SELECT SUM(m.quantity) FROM pharmacy_movements m WHERE m.batch_id = x.id), 0))`, [ids]),
  chargeResult: (ids) => c.query(`SELECT ch.id FROM charges ch WHERE ch.id IN (?) AND ch.correction_exception_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id WHERE a.id = ch.correction_exception_id AND m.kind = a.correction_kind AND m.source_id = a.source_id AND m.signed_by = ch.actor_id AND ((m.kind = 'CARE_BILLING' AND CAST(m.result_id AS CHAR) = ch.source_event_id) OR (m.kind IN ('LAB_REPORT','LAB_BILLING') AND EXISTS (SELECT 1 FROM lab_reports r WHERE r.id = m.result_id AND r.order_id = a.source_id))))`, [ids]),
  reversalResult: (ids) => c.query(`SELECT cr.id FROM charge_reversals cr WHERE cr.id IN (?) AND cr.correction_exception_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id WHERE a.id = cr.correction_exception_id AND m.kind = 'REVERSE_CHARGE' AND m.source_id = cr.charge_id AND m.result_id = cr.id AND m.signed_by = cr.actor_id)`, [ids]),
};
if (!filter || "gap".includes(filter) || filter === "gap") {
  cur = { name: "gap:pharmacy_stock_matches_ledger + pharmacy_movement_matches_stock (detection query)", pass: [], fail: [] };
  const exp = (label, rows, n) => (rows[0].length === n ? cur.pass.push(label) : cur.fail.push(`${label}: got ${rows[0].length} rows, expected ${n}`));
  const b1 = await ins("pharmacy_batches", { available_quantity: 5 }); await ins("pharmacy_movements", { batch_id: b1.id, kind: "RECEIPT", quantity: 5, reference: rs() });
  exp("balanced batch is not reported", await gapQueries.stock([b1.id]), 0);
  const b2 = await ins("pharmacy_batches", { available_quantity: 7 }); await ins("pharmacy_movements", { batch_id: b2.id, kind: "RECEIPT", quantity: 5, reference: rs() });
  exp("unbalanced batch is reported", await gapQueries.stock([b2.id]), 1);
  const b3 = await ins("pharmacy_batches", { available_quantity: 0 }); exp("batch with no movements and zero stock passes", await gapQueries.stock([b3.id]), 0);
  results.push(cur);

  cur = { name: "gap:closed_charge_result + closed_reversal_result (detection queries)", pass: [], fail: [] };
  const adm = await admission({ status: "DISCHARGED" }); const admin = await staff("ADMIN"); const order = rid();
  const x = await adminEx(adm.id, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "LAB_BILLING", source_id: order, signed_by: admin });
  const lr = await ins("lab_reports", { order_id: order, admission_id: adm.id });
  const goodCh = await ins("charges", chargeRow({ adm }, { correction_exception_id: x.id, actor_id: admin, source_event_id: rid() }));
  exp("charge without persisted amendment is reported", await gapQueries.chargeResult([goodCh.id]), 1);
  await ins("post_discharge_amendments", { admission_id: adm.id, exception_id: x.id, kind: "LAB_BILLING", source_id: order, result_id: lr.id, signed_by: admin, before_snapshot: "{}", after_snapshot: "{}" });
  exp("charge with exact amendment passes", await gapQueries.chargeResult([goodCh.id]), 0);
  const plain = await ins("charges", chargeRow({ adm })); exp("charge without correction exception is out of scope", await gapQueries.chargeResult([plain.id]), 0);
  const x2 = await adminEx(adm.id, { type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correction_kind: "REVERSE_CHARGE", source_id: plain.id, signed_by: admin });
  const rv = await ins("charge_reversals", { charge_id: plain.id, amount_paise: 1, actor_type: "staff", actor_id: admin, correction_exception_id: x2.id });
  exp("reversal without persisted amendment is reported", await gapQueries.reversalResult([rv.id]), 1);
  await ins("post_discharge_amendments", { admission_id: adm.id, exception_id: x2.id, kind: "REVERSE_CHARGE", source_id: plain.id, result_id: rv.id, signed_by: admin, before_snapshot: "{}", after_snapshot: "{}" });
  exp("reversal with exact amendment passes", await gapQueries.reversalResult([rv.id]), 0);
  results.push(cur);
}

// ---- idempotency + final state -------------------------------------------------------------------------------------
if (!filter) {
  cur = { name: "T1.sql applies twice (idempotent) and installs every trigger", pass: [], fail: [] };
  for (let pass = 1; pass <= 2; pass++) { present.clear(); for (const b of blocks) await install(b); }
  const [[{ n }]] = await c.query("SELECT COUNT(*) n FROM information_schema.triggers WHERE trigger_schema = ?", [DB]);
  n === blocks.length ? cur.pass.push(`${n} triggers present after two applications`) : cur.fail.push(`expected ${blocks.length}, found ${n}`);
  results.push(cur);
}

let failed = 0;
for (const r of results) {
  const status = r.fail.length ? "FAIL" : "PASS";
  if (r.fail.length) failed++;
  console.log(`${status} ${r.name}  (${r.pass.length} checks passed${r.fail.length ? `, ${r.fail.length} failed` : ""})`);
  for (const f of r.fail) console.log(`    - ${f}`);
}
console.log(`\n${results.length - failed} of ${results.length} trigger groups PASS`);
await c.end();
process.exit(failed ? 1 : 0);
