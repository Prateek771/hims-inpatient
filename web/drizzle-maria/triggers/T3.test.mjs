// T3.test.mjs - validates web/drizzle-maria/triggers/T3.sql against a scratch MariaDB database (port_t3).
// Plain node + mysql2, no framework.  Run:  node web/drizzle-maria/triggers/T3.test.mjs
// Env: MYSQL2_DIR (directory containing node_modules/mysql2; default = session scratchpad probe),
//      T3_KEEP=1 keeps the scratch database afterwards.  Credentials come from tmp/mariadb-local/root.env (never printed).
// Method: every test installs ONLY the trigger(s) under test (all others dropped) so fixtures can be inserted with
// FOREIGN_KEY_CHECKS=0 / check_constraint_checks=0 and each trigger body is exercised in isolation.  Each trigger needs at
// least one accepted case and one rejected case (SIGNAL 45000 with the original message, or - for invalidation triggers -
// a "no effect" case) to PASS.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const mysqlDir = process.env.MYSQL2_DIR ?? 'C:/Users/prate/AppData/Local/Temp/claude/8e4d92b4015353d0/4cd94459-c906-4532-8635-f6f792ea0f87/scratchpad/probe';
const mysql = createRequire(mysqlDir.replace(/[\\/]*$/, '/') + 'x.js')('mysql2/promise');
const env = Object.fromEntries(fs.readFileSync(path.join(repo, 'tmp/mariadb-local/root.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const DB = 'port_t3';
const conn = async (db) => {
  const x = await mysql.createConnection({ host: env.MARIADB_HOST, port: +env.MARIADB_PORT, user: env.MARIADB_ROOT_USER, password: env.MARIADB_ROOT_PASSWORD, database: db, dateStrings: true });
  await x.query("SET time_zone='+00:00'");
  return x;
};

function splitSql(text) {
  const out = []; let delim = ';'; let buf = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^DELIMITER\s+(\S+)\s*$/i.exec(line); if (m) { delim = m[1]; continue; }
    if (/^\s*--/.test(line) && !buf.trim()) continue;
    buf += line + '\n';
    if (buf.trimEnd().endsWith(delim)) { const st = buf.trimEnd().slice(0, -delim.length).trim(); if (st) out.push(st); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
const applyFile = async (c, f) => { for (const st of splitSql(fs.readFileSync(path.join(repo, 'web/drizzle-maria', f), 'utf8'))) await c.query(st); };

// ------------------------------------------------------------------ database + trigger blocks
{
  const r = await mysql.createConnection({ host: env.MARIADB_HOST, port: +env.MARIADB_PORT, user: env.MARIADB_ROOT_USER, password: env.MARIADB_ROOT_PASSWORD });
  await r.query(`DROP DATABASE IF EXISTS ${DB}`);
  await r.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
  await r.end();
}
const c = await conn(DB);
for (const f of ['0001_tables.sql', '0002_helpers.sql', '0003_views.sql']) await applyFile(c, f);
await c.query('SET FOREIGN_KEY_CHECKS=0');
await c.query('SET check_constraint_checks=0');

const t3 = fs.readFileSync(path.join(here, 'T3.sql'), 'utf8');
const blocks = new Map();
for (const m of t3.matchAll(/^-- TRIGGER (.*)\n([\s\S]*?)^-- END TRIGGER$/gm)) {
  const meta = Object.fromEntries(m[1].trim().split(/\s+/).map((kv) => kv.split('=')));
  const body = m[2].trim(); const i = body.indexOf('\n');
  blocks.set(meta.name, { ...meta, drop: body.slice(0, i).replace(/;$/, ''), create: body.slice(i + 1) });
}

// ------------------------------------------------------------------ test framework
const cov = new Map(); // trigger -> {acc, rej, fails[]}
const entry = (n) => { if (!cov.has(n)) cov.set(n, { acc: 0, rej: 0, fails: [] }); return cov.get(n); };
const names = (x) => (Array.isArray(x) ? x : [x]);
function record(ns, kind, ok, desc, detail) {
  for (const n of names(ns)) {
    if (!blocks.has(n)) { entry(n).fails.push(`unknown trigger in test: ${desc}`); continue; }
    const e = entry(n);
    if (ok) e[kind]++; else e.fails.push(`${desc}: ${detail}`);
  }
}
const installed = new Set();
async function uninstallAll() { for (const n of installed) await c.query(blocks.get(n).drop); installed.clear(); }
async function install(ns) { await uninstallAll(); for (const n of names(ns)) { await c.query(blocks.get(n).create); installed.add(n); } }
/** run fn with only the listed triggers installed */
async function only(ns, fn) { await install(ns); try { return await fn(); } finally { await uninstallAll(); } }
/** fixtures are built by `setup` with no triggers; `act` runs with the triggers installed */
async function accept(ns, desc, setup, act) {
  try { const w = await setup(); await only(ns, () => act(w)); record(ns, 'acc', true, desc); } catch (e) { record(ns, 'acc', false, desc, `${e.errno ?? ''} ${e.message}`.slice(0, 300)); }
}
async function reject(ns, desc, message, setup, act) {
  try {
    const w = await setup();
    let err = null;
    await only(ns, async () => { try { await act(w); } catch (e) { err = e; } });
    if (!err) throw new Error('no error raised');
    if (err.errno !== 1644 || err.sqlMessage !== message) throw new Error(`wrong error ${err.errno}: ${err.sqlMessage}`);
    record(ns, 'rej', true, desc);
  } catch (e) { record(ns, 'rej', false, desc, e.message.slice(0, 300)); }
}
/** negative effect test for invalidation triggers: act must succeed and `check` must hold */
async function noEffect(ns, desc, setup, act, check) {
  try { const w = await setup(); await only(ns, () => act(w)); if (!(await check(w))) throw new Error('unexpected effect'); record(ns, 'rej', true, desc); } catch (e) { record(ns, 'rej', false, desc, e.message.slice(0, 300)); }
}
const q = async (sql, p) => (await c.query(sql, p))[0];

// ------------------------------------------------------------------ fixture helpers
const U = () => randomUUID();
const BASE = Date.now();
const ts = (min) => new Date(BASE + min * 60000).toISOString().replace('T', ' ').replace('Z', '000');
let seq = 0;
const meta = new Map();
const jsonCols = new Set();
for (const r of await q("SELECT check_clause cl FROM information_schema.check_constraints WHERE constraint_schema=DATABASE()")) {
  const m = /json_valid\(`?(\w+)`?\)/i.exec(r.cl); if (m) jsonCols.add(m[1]);
}
async function tmeta(t) {
  if (!meta.has(t)) {
    const rows = await q("SELECT column_name n,data_type dt,is_nullable nl,column_default d,generation_expression g FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position", [t]);
    meta.set(t, rows);
  }
  return meta.get(t);
}
function gen(col) {
  const dt = col.dt;
  if (dt === 'uuid') return U();
  if (dt === 'datetime') return ts(-5000);
  if (dt === 'date') return '2030-01-01';
  if (['int', 'bigint', 'smallint', 'decimal'].includes(dt)) return ++seq;
  if (dt === 'tinyint') return 0;
  if (dt.includes('blob')) return Buffer.from('');
  if (jsonCols.has(col.n)) return '{}';
  return `${col.n}_${++seq}`;
}
async function ins(table, ov = {}) {
  const cols = await tmeta(table);
  const o = { ...ov };
  const idc = cols.find((x) => x.n === 'id');
  if (idc && idc.dt === 'uuid' && o.id === undefined) o.id = U();
  const names_ = [], vals = [];
  for (const col of cols) {
    if (col.g) continue;
    if (col.n in o) { names_.push(col.n); const v = o[col.n]; vals.push(v !== null && typeof v === 'object' && !Buffer.isBuffer(v) ? JSON.stringify(v) : v); continue; }
    if (col.d !== null || col.nl === 'YES') continue;
    names_.push(col.n); vals.push(gen(col));
  }
  await c.query(`INSERT INTO \`${table}\` (${names_.map((x) => `\`${x}\``).join(',')}) VALUES (${names_.map(() => '?').join(',')})`, vals);
  return o.id;
}
const staff = (role, ov = {}) => { const id = `u_${role}_${++seq}`; return ins('staff_user', { id, name: id, email: `${id}@x.test`, role, banned: 0, ...ov }).then(() => id); };
const admission = (ov = {}) => ins('admissions', { status: 'ADMITTED', admitted_at: ts(-3000), bill_revision: 3, workflow_version: 1, admitting_doctor_id: `doc_${++seq}`, ...ov });
const GATES = ['DOCTOR', 'PHARMACY', 'NURSING', 'BILLING'];
const fromGate = (g) => GATES.slice(GATES.indexOf(g));

// ------------------------------------------------------------------ 0. idempotent application of the whole file
{
  const t0 = Date.now();
  try {
    for (let pass = 0; pass < 2; pass++) for (const b of blocks.values()) { await c.query(b.drop); await c.query(b.create); installed.add(b.name); }
    const [r] = await c.query("SELECT COUNT(*) n FROM information_schema.triggers WHERE trigger_schema=DATABASE()");
    if (r[0].n !== blocks.size) throw new Error(`expected ${blocks.size} triggers, found ${r[0].n}`);
    console.log(`PASS apply T3.sql twice (${blocks.size} triggers, ${Date.now() - t0} ms)`);
  } catch (e) { console.log('FAIL apply T3.sql twice:', e.message); process.exitCode = 1; }
  await uninstallAll();
}

// ------------------------------------------------------------------ 1. preserve_* (append-only) triggers
const MSG = {
  billing: 'Billing history is immutable; append a linked correction',
  staff: 'Staff directory and availability history is append only',
  transfer: 'Transfer history is immutable; append attributable correction evidence',
};
const preserveGroups = new Map(); // table -> {msg, names[]}
for (const b of blocks.values()) {
  const m = Object.entries(MSG).find(([, v]) => b.create.includes(`'${v}'`));
  if (!m) continue;
  const g = preserveGroups.get(b.table) ?? { msg: m[1], names: [] };
  g.names.push(b.name); preserveGroups.set(b.table, g);
}
for (const [table, g] of preserveGroups) {
  const cols = await tmeta(table);
  const first = cols.find((x) => !x.g).n;
  const setup = async () => ({ id: await ins(table) });
  await accept(g.names, `${table}: INSERT stays allowed`, setup, () => ins(table));
  for (const n of g.names) {
    const ev = blocks.get(n).event;
    const act = ev === 'UPDATE' ? () => q(`UPDATE \`${table}\` SET \`${first}\` = \`${first}\` LIMIT 1`) : () => q(`DELETE FROM \`${table}\` LIMIT 1`);
    await reject(n, `${table}: ${ev} rejected`, g.msg, setup, act);
  }
}

// ------------------------------------------------------------------ 2. preserve_room_boundary (room_stays BEFORE UPDATE)
{
  const N = 'immutable_room_boundary_preserved';
  const M1 = 'Closed room boundary is immutable; use attributable correction';
  const M2 = 'Room source, tariff pin and committed cursor are immutable';
  const open = async () => { const adm = U(); const id = await ins('room_stays', { admission_id: adm, started_at: ts(-100), ended_at: null, last_reconciled_at: ts(-90), posted_paise: 10 }); return { id, adm }; };
  const closed = async () => { const w = await open(); await q('UPDATE room_stays SET ended_at=? WHERE id=?', [ts(-50), w.id]); return w; };
  await accept(N, 'close an open stay and advance cursor', open, (w) => q('UPDATE room_stays SET ended_at=?, posted_paise=20, last_reconciled_at=? WHERE id=?', [ts(-50), ts(-40), w.id]));
  await reject(N, 'changing the end of a closed stay', M1, closed, (w) => q('UPDATE room_stays SET ended_at=? WHERE id=?', [ts(-10), w.id]));
  await reject(N, 'moving the bed', M2, open, (w) => q('UPDATE room_stays SET bed_id=? WHERE id=?', [U(), w.id]));
  await reject(N, 'changing the tariff pin', M2, open, (w) => q('UPDATE room_stays SET tariff_version_id=? WHERE id=?', [U(), w.id]));
  await reject(N, 'lowering posted_paise', M2, open, (w) => q('UPDATE room_stays SET posted_paise=1 WHERE id=?', [w.id]));
  await reject(N, 'moving the reconciled cursor back', M2, open, (w) => q('UPDATE room_stays SET last_reconciled_at=? WHERE id=?', [ts(-95), w.id]));
}

// ------------------------------------------------------------------ 3. physical_bed_timeline_guard (room_stays INSERT / UPDATE)
{
  const MSGO = 'Effective physical room stays cannot overlap';
  const [NI, NU] = ['physical_bed_timeline_guard_ins', 'physical_bed_timeline_guard_upd'];
  const world = async () => { const adm = await admission(); const bed = U(); await ins('beds', { id: bed }); const s1 = await ins('room_stays', { admission_id: adm, bed_id: bed, started_at: ts(-500), ended_at: ts(-300) }); return { adm, bed, s1 }; };
  await accept(NI, 'adjacent stay on same bed', world, (w) => ins('room_stays', { admission_id: w.adm, bed_id: w.bed, started_at: ts(-300), ended_at: null }));
  await accept(NI, 'other bed other admission', world, (w) => ins('room_stays', { admission_id: U(), bed_id: w.bed, started_at: ts(-300), ended_at: ts(-200) }));
  await reject(NI, 'same bed overlap', MSGO, world, (w) => ins('room_stays', { admission_id: U(), bed_id: w.bed, started_at: ts(-400), ended_at: null }));
  await reject(NI, 'same admission on another bed overlap', MSGO, world, (w) => ins('room_stays', { admission_id: w.adm, bed_id: U(), started_at: ts(-400), ended_at: ts(-350) }));
  await accept(NI, 'empty range overlaps nothing', world, (w) => ins('room_stays', { admission_id: w.adm, bed_id: w.bed, started_at: ts(-400), ended_at: ts(-400) }));
  await reject(NI, 'overlap with an amended (effective) end', MSGO, async () => {
    const w = await world(); const P = U(); await ins('stay_boundary_amendments', { admission_id: w.adm, stay_id: w.s1, version: 1, started_at: ts(-500), ended_at: ts(-100) }); return { ...w, P };
  }, (w) => ins('room_stays', { admission_id: U(), bed_id: w.bed, started_at: ts(-200), ended_at: null }));
  const open = async () => { const w = await world(); const s2 = await ins('room_stays', { admission_id: w.adm, bed_id: w.bed, started_at: ts(-300), ended_at: null }); return { ...w, s2 }; };
  await accept(NU, 'update to a non-overlapping end', open, (w) => q('UPDATE room_stays SET ended_at=? WHERE id=?', [ts(-100), w.s2]));
  await accept(NU, 'update of an unlisted column is ignored', open, (w) => q('UPDATE room_stays SET posted_paise=5 WHERE id=?', [w.s2]));
  await reject(NU, 'update start back into the earlier stay', MSGO, open, (w) => q('UPDATE room_stays SET started_at=? WHERE id=?', [ts(-400), w.s2]));
}

// ------------------------------------------------------------------ 4. physical discharge guards (room_vacations / departures)
const E1 = 'Physical transition requires active episode and closed attributable stay';
async function vacationWorld(o = {}) {
  const nurse = await staff('NURSE', { banned: o.banned ? 1 : 0 });
  const adm = await admission({ status: o.status ?? 'ADMITTED' });
  const T = ts(-120);
  const stay = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-1000), ended_at: o.openStay ? null : T, last_reconciled_at: o.recon ?? T });
  const shift = await ins('nursing_shifts', { admission_id: adm, nurse_id: o.shiftNurse ?? nurse, started_at: ts(-900) });
  const seal = await ins('clearance_seals', { admission_id: adm, gate: o.gate ?? 'NURSING', signed_at: ts(-130) });
  if (o.invalidated) await ins('clearance_invalidations', { seal_id: seal });
  const asg = await ins('nurse_assignments', { admission_id: adm, nurse_id: nurse });
  if (o.revoked) await ins('nurse_assignment_revocations', { assignment_id: asg });
  if (o.shiftEnd) await ins('nursing_shift_ends', { shift_id: shift, ended_at: ts(-200) });
  return { nurse, adm, stay, shift, seal, row: { admission_id: adm, stay_id: stay, nursing_seal_id: seal, shift_id: shift, vacated_at: o.vacated ?? T, signed_by: nurse, signed_at: ts(-100) } };
}
{
  const N = 'room_vacation_physical_guard';
  const run = (w) => ins('room_vacations', w.row);
  await accept(N, 'valid vacancy', () => vacationWorld(), run);
  await accept(N, 'readiness/exception-backed vacancy bypasses guard (WHEN)', () => vacationWorld({ status: 'PENDING' }), (w) => ins('room_vacations', { ...w.row, mvp_readiness_id: U() }));
  await reject(N, 'episode not active', E1, () => vacationWorld({ status: 'PENDING' }), run);
  await reject(N, 'stay still open', E1, () => vacationWorld({ openStay: true }), run);
  await reject(N, 'seal of wrong gate', 'Current same-episode Nursing seal required', () => vacationWorld({ gate: 'BILLING' }), run);
  await reject(N, 'invalidated seal', 'Current same-episode Nursing seal required', () => vacationWorld({ invalidated: true }), run);
  await reject(N, 'shift of a different nurse', 'Physical vacancy requires actual same-nurse attendance', () => vacationWorld({ shiftNurse: 'someone_else' }), run);
  await reject(N, 'shift already ended before vacancy', 'Physical vacancy requires actual same-nurse attendance', () => vacationWorld({ shiftEnd: true }), run);
  await reject(N, 'assignment revoked', 'Current nursing assignment required', () => vacationWorld({ revoked: true }), run);
  await reject(N, 'banned nurse', 'Actual Nurse role required', () => vacationWorld({ banned: true }), run);
  await reject(N, 'vacancy differs from reconciled end', 'Vacancy must equal reconciled actual stay end after Nursing clearance', () => vacationWorld({ recon: ts(-121) }), run);
}
async function departureWorld(o = {}) {
  const adm = await admission({ status: o.status ?? 'ADMITTED', bill_revision: 3 });
  const bil = await staff(o.role ?? 'BILLING');
  const T = ts(-120);
  const stay = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-1000), ended_at: T });
  await ins('room_vacations', { admission_id: adm, stay_id: stay, vacated_at: T, shift_id: U() });
  const seal = await ins('clearance_seals', { admission_id: adm, gate: 'BILLING', bill_version: o.sealBill ?? 3, signed_at: ts(-110) });
  return { adm, row: { admission_id: adm, stay_id: stay, bill_seal_id: seal, departed_at: o.departed ?? ts(-60), bill_version: 3, signed_by: bil, signed_at: ts(-50) } };
}
{
  const N = 'departure_physical_guard';
  const run = (w) => ins('departures', w.row);
  await accept(N, 'valid departure', () => departureWorld(), run);
  await accept(N, 'finance-backed departure bypasses guard (WHEN)', () => departureWorld({ status: 'PENDING' }), (w) => ins('departures', { ...w.row, mvp_finance_id: U() }));
  await reject(N, 'episode not active', E1, () => departureWorld({ status: 'PENDING' }), run);
  await reject(N, 'seal bill version differs', 'Current same-episode Billing seal and bill required', () => departureWorld({ sealBill: 2 }), run);
  await reject(N, 'departure before vacancy', 'Actual hospital departure must follow room vacancy and human clearance', () => departureWorld({ departed: ts(-130) }), run);
  await reject(N, 'departure signed by a nurse', 'Billing or Admin departure authority required', () => departureWorld({ role: 'NURSE' }), run);
}

// ------------------------------------------------------------------ 5. post_discharge_amendment_source
{
  const N = 'post_discharge_amendment_source';
  const bill = 5;
  async function amendWorld(kind, o = {}) {
    const doc = await staff('DOCTOR');
    const adm = await admission({ status: o.status ?? 'DISCHARGED', admitting_doctor_id: doc, bill_revision: bill });
    const S = U(), R = U(), X = U();
    const roleOf = { RECEIPT: 'BILLING', REFUND: 'BILLING', ALLOCATE: 'BILLING', CANCEL_ALLOCATION: 'BILLING', INSURANCE_DECISION: 'INSURANCE', DISPOSITION_REVIEW: 'DOCTOR', CLINICAL_ADDENDUM: 'DOCTOR', NURSING_ADDENDUM: 'NURSE', LAB_ADDENDUM: 'LAB', SELF_PAY_REVIEW: 'BILLING', LAB_BILLING: 'LAB', REVERSE_CHARGE: 'BILLING', CARE_BILLING: 'DOCTOR', LAB_REPORT: 'LAB' };
    const actor = roleOf[kind] === 'DOCTOR' ? doc : await staff(o.wrongRole ?? roleOf[kind]);
    await ins('admin_exceptions', { id: X, admission_id: adm, type: 'POST_DISCHARGE_CORRECTION', disposition: o.disposition ?? 'AMEND', correction_kind: kind, source_id: S, snapshot: { billVersion: bill - 1 } });
    let result = R, source = S;
    switch (kind) {
      case 'RECEIPT': await ins('receipts', { id: R, admission_id: adm, actor_id: actor }); await ins('departures', { id: S, admission_id: adm }); break;
      case 'REFUND': await ins('receipts', { id: S, admission_id: adm }); await ins('receipt_refunds', { id: R, receipt_id: S, admission_id: adm, actor_id: actor }); break;
      case 'ALLOCATE': await ins('receipts', { id: S, admission_id: adm }); await ins('receipt_allocations', { id: R, receipt_id: S, actor_id: actor }); break;
      case 'CANCEL_ALLOCATION': { const rc = await ins('receipts', { admission_id: adm }); await ins('receipt_allocations', { id: S, receipt_id: rc }); await ins('allocation_cancellations', { id: R, allocation_id: S, actor_id: actor }); break; }
      case 'INSURANCE_DECISION': await ins('insurance_cases', { id: S, admission_id: adm, assigned_staff_id: actor }); await ins('insurance_decisions', { id: R, case_id: S, recorded_by: actor }); break;
      case 'DISPOSITION_REVIEW': await ins('exception_evidence', { id: R, admission_id: adm, source_id: S, exception_id: X, kind: 'PROFESSIONAL_REVIEW', signed_by: actor }); break;
      case 'CLINICAL_ADDENDUM': await ins('clinical_rounds', { id: S, admission_id: adm }); await ins('clinical_addenda', { id: R, note_id: S, signed_by: actor }); break;
      case 'NURSING_ADDENDUM': await ins('nurse_assignments', { admission_id: adm, nurse_id: actor }); await ins('nursing_addenda', { id: R, record_id: S, admission_id: adm, signed_by: actor }); break;
      case 'LAB_ADDENDUM': await ins('lab_reports', { id: S, admission_id: adm }); await ins('lab_report_addenda', { id: R, report_id: S, signed_by: actor }); break;
      case 'SELF_PAY_REVIEW': { const ic = await ins('insurance_cases', { admission_id: adm }); await ins('self_pay_reviews', { id: R, admission_id: adm, actor_id: actor }); await ins('insurance_conversions', { id: S, case_id: ic }); break; }
      case 'LAB_BILLING': await ins('lab_reports', { id: R, order_id: S, admission_id: adm }); await ins('care_billing_events', { id: U(), order_id: S, admission_id: adm, state: 'POSTED' }).then(async (b) => ins('charges', { admission_id: adm, source_event_id: b })); break;
      case 'REVERSE_CHARGE': await ins('charges', { id: S, admission_id: adm, category: 'consultation', source_event_id: `ev_${seq++}` }); await ins('charge_reversals', { id: R, charge_id: S, actor_id: actor, correction_exception_id: X }); break;
      case 'CARE_BILLING': { const cr = await ins('clinical_rounds', { admission_id: adm }); await ins('care_billing_events', { id: S, admission_id: adm, category: 'consultation', round_id: cr, state: 'POSTED' }); await ins('charges', { admission_id: adm, source_event_id: S, correction_exception_id: X, actor_id: actor }); break; }
      case 'LAB_REPORT': await ins('lab_reports', { id: R, order_id: S, admission_id: adm, signed_by: actor }); break;
    }
    if (kind === 'CARE_BILLING') result = source;
    return { row: { admission_id: adm, exception_id: X, kind, source_id: source, result_id: result, before_snapshot: { billVersion: o.beforeBill ?? bill - 1 }, after_snapshot: { billVersion: bill }, signed_by: actor } };
  }
  const run = (w) => ins('post_discharge_amendments', w.row);
  const kinds = ['RECEIPT', 'REFUND', 'ALLOCATE', 'CANCEL_ALLOCATION', 'INSURANCE_DECISION', 'DISPOSITION_REVIEW', 'CLINICAL_ADDENDUM', 'NURSING_ADDENDUM', 'LAB_ADDENDUM', 'SELF_PAY_REVIEW', 'LAB_BILLING', 'REVERSE_CHARGE', 'CARE_BILLING', 'LAB_REPORT'];
  for (const k of kinds) await accept(N, `kind ${k}`, () => amendWorld(k), run);
  await reject(N, 'episode not discharged', 'Closed amendment requires current staff and exact retained authority', () => amendWorld('RECEIPT', { status: 'ADMITTED' }), run);
  await reject(N, 'authority disposition mismatch', 'Closed amendment requires current staff and exact retained authority', () => amendWorld('RECEIPT', { disposition: 'TRANSFER' }), run);
  await reject(N, 'financial amendment bound to a stale bill', 'Financial amendment must bind its fresh authority and persisted bill result', () => amendWorld('REVERSE_CHARGE', { beforeBill: 1 }), run);
  await reject(N, 'wrong role for the kind', 'Amendment result must be the proper role signed effect on its original source', () => amendWorld('RECEIPT', { wrongRole: 'LAB' }), run);
  await reject(N, 'result not found', 'Amendment result must be the proper role signed effect on its original source', async () => { const w = await amendWorld('LAB_REPORT'); w.row.result_id = U(); return w; }, run);
}

// ------------------------------------------------------------------ 6. room_return_source
{
  const N = 'room_return_source';
  async function returnWorld(o = {}) {
    const nurse = await staff('NURSE', { banned: o.banned ? 1 : 0 });
    const adm = await admission({ status: o.status ?? 'ADMITTED' });
    const tv = ts(-300), ret = ts(-100), bed = U();
    const stay0 = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-1000), ended_at: tv, last_reconciled_at: tv });
    const V = await ins('room_vacations', { admission_id: adm, stay_id: stay0, shift_id: U(), vacated_at: tv });
    const D = await ins('exception_evidence', { admission_id: adm, kind: o.dKind ?? 'RETURN_TO_BED', role: 'DOCTOR', source_id: V, signed_at: ts(-200), actual_at: ts(-200) });
    const Nv = await ins('exception_evidence', { admission_id: adm, kind: 'RETURN_HANDOVER', role: 'NURSE', source_id: V, signed_by: nurse, actual_at: ret, signed_at: ts(-90) });
    const stay1 = await ins('room_stays', { admission_id: adm, bed_id: bed, started_at: ret, ended_at: null });
    const X = await ins('admin_exceptions', { admission_id: adm, type: 'RETURN_TO_BED', disposition: 'RETURN_TO_BED', evidence_ids: [D] });
    if (!o.noHold) await ins('bed_holds', { admission_id: adm, bed_id: bed });
    if (o.dirtyBed) { const t = await ins('bed_turnovers', { bed_id: bed, admission_id: adm, stay_id: stay0, vacated_at: tv }); void t; }
    return { stay0, row: { admission_id: adm, vacation_id: V, doctor_evidence_id: D, nurse_evidence_id: Nv, stay_id: stay1, exception_id: X, returned_at: ret, signed_by: nurse } };
  }
  const run = (w) => ins('room_returns', w.row);
  await accept(N, 'valid return', () => returnWorld(), run);
  await reject(N, 'episode not active', 'Return requires retained vacancy, fresh Doctor instruction and actual Nurse handover', () => returnWorld({ status: 'PENDING' }), run);
  await reject(N, 'doctor evidence of wrong kind', 'Return requires retained vacancy, fresh Doctor instruction and actual Nurse handover', () => returnWorld({ dKind: 'OTHER' }), run);
  await reject(N, 'bed not reserved', 'Current Nurse, reserved bed and actual cleaning are required', () => returnWorld({ noHold: true }), run);
  await reject(N, 'banned nurse', 'Current Nurse, reserved bed and actual cleaning are required', () => returnWorld({ banned: true }), run);
  await reject(N, 'cleaning not completed', 'Current Nurse, reserved bed and actual cleaning are required', async () => {
    const w = await returnWorld(); const bed = (await q('SELECT bed_id FROM room_stays WHERE id=?', [w.row.stay_id]))[0].bed_id;
    await ins('bed_turnovers', { bed_id: bed, admission_id: w.row.admission_id, stay_id: w.stay0, vacated_at: ts(-300) }); return w;
  }, run);
}

// ------------------------------------------------------------------ 7. stay_amendment_guard
{
  const N = 'stay_amendment_guard';
  async function stayWorld(o = {}) {
    const admin = await staff('ADMIN');
    const adm = await admission({ admitted_at: ts(-3000) });
    const bed = U(); const start = ts(-1000), end = o.end ?? ts(-500);
    const stay = await ins('room_stays', { admission_id: adm, bed_id: bed, started_at: start, ended_at: o.stayClosed ? ts(-400) : null });
    const P = await ins('exception_evidence', { admission_id: adm, kind: o.pKind ?? 'TRANSFER_HANDOVER', role: 'NURSE', actual_at: end, shift_id: U(), source_id: o.cutoff ? stay : null, exception_id: null });
    const X = await ins('admin_exceptions', { admission_id: adm, type: o.xType ?? 'DELAYED_TRANSFER', disposition: o.xDisp ?? 'TRANSFER', evidence_ids: [P], source_id: o.cutoff ? stay : null });
    if (o.cutoff) await q('UPDATE exception_evidence SET exception_id=?, kind=\'ROOM_CUTOFF\' WHERE id=?', [X, P]);
    if (o.transfer) await ins('admission_transfers', { admission_id: adm, old_stay_id: stay });
    if (o.departure) await ins('departures', { admission_id: adm, departed_at: ts(-700) });
    if (o.exDeparture) await ins('exceptional_departures', { admission_id: adm, departed_at: ts(-700) });
    if (o.consumable) await ins('nursing_consumables', { admission_id: adm, stay_id: stay, used_at: ts(-450) });
    if (o.overlap) await ins('room_stays', { admission_id: U(), bed_id: bed, started_at: ts(-600), ended_at: ts(-550) });
    return { adm, stay, row: { admission_id: adm, stay_id: stay, exception_id: X, evidence_id: P, version: o.version ?? 1, started_at: o.start ?? start, ended_at: o.endedAt === undefined ? end : o.endedAt, signed_by: o.signer ?? admin } };
  }
  const run = (w) => ins('stay_boundary_amendments', w.row);
  const MSGA = 'Attributable same-episode administrator and Nurse source required';
  await accept(N, 'delayed transfer cutoff', () => stayWorld(), run);
  await accept(N, 'room cutoff correction of a closed stay', () => stayWorld({ cutoff: true, stayClosed: true, xType: 'ROOM_CUTOFF_CORRECTION', xDisp: 'AMEND', stayClosed: true }), run);
  await accept(N, 'exceptional exit', () => stayWorld({ xType: 'OTHER', xDisp: 'EXCEPTIONAL_EXIT', pKind: 'PHYSICAL_EXIT' }), run);
  await reject(N, 'version gap', MSGA, () => stayWorld({ version: 2 }), run);
  await reject(N, 'signer is not an administrator', MSGA, () => stayWorld({ signer: 'nobody' }), run);
  await reject(N, 'original start changed', 'Correction preserves original start and records a factual finite end', () => stayWorld({ start: ts(-999) }), run);
  await reject(N, 'no finite end', 'Correction preserves original start and records a factual finite end', () => stayWorld({ endedAt: null }), run);
  await reject(N, 'wrong disposition/evidence', 'Physical amendment requires specific disposition and original professional evidence', () => stayWorld({ xDisp: 'AMEND' }), run);
  await reject(N, 'cutoff correction of an open stay', 'Final cutoff cannot silently separate an adjacent transfer or return', () => stayWorld({ cutoff: true, xType: 'ROOM_CUTOFF_CORRECTION', xDisp: 'AMEND' }), run);
  await reject(N, 'cutoff correction beside a transfer', 'Final cutoff cannot silently separate an adjacent transfer or return', () => stayWorld({ cutoff: true, stayClosed: true, transfer: true, xType: 'ROOM_CUTOFF_CORRECTION', xDisp: 'AMEND' }), run);
  await reject(N, 'conflicts with departure', 'Correction conflicts with actual departure or cleaning', () => stayWorld({ departure: true }), run);
  await reject(N, 'conflicts with exceptional departure', 'Correction conflicts with actual departure or cleaning', () => stayWorld({ exDeparture: true }), run);
  await reject(N, 'end in the future', 'Amended physical time must retain actual professional source and cannot reopen a closed episode', () => stayWorld({ end: ts(60) }), run);
  await reject(N, 'overlaps retained history', 'Amended physical occupancy conflicts with retained history', () => stayWorld({ overlap: true }), run);
  await reject(N, 'strands a consumable', 'Amendment cannot silently reassign original source-unit consumables', () => stayWorld({ consumable: true, end: ts(-460) }), run);
}

// ------------------------------------------------------------------ 8. transfer withdrawal guards
{
  const [NC, NT, NW] = ['transfer_cancellation_source', 'transfer_current_authority', 'transfer_witness_authority'];
  async function wd(o = {}) {
    const doc = await staff(o.role ?? 'DOCTOR');
    const adm = await admission({ admitting_doctor_id: o.otherDoctor ? 'someone' : doc, status: o.status ?? 'ADMITTED' });
    const stay = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-1000), ended_at: o.closed ? ts(-400) : null });
    const O = await ins('transfer_orders', { admission_id: adm, source_stay_id: stay, version: 1, signed_at: ts(-300), signed_by: doc });
    if (o.newer) await ins('transfer_orders', { admission_id: adm, source_stay_id: stay, version: 2, signed_at: ts(-290) });
    if (o.performed) await ins('admission_transfers', { admission_id: adm, transfer_order_id: O, old_stay_id: stay });
    if (o.cancelled) await ins('transfer_order_cancellations', { admission_id: adm, transfer_order_id: O, signed_at: ts(-200) });
    if (o.handover) await ins('exception_evidence', { admission_id: adm, kind: 'TRANSFER_HANDOVER', source_id: O });
    if (o.delayed) {
      const P = await ins('exception_evidence', { admission_id: adm, kind: 'TRANSFER_HANDOVER', role: 'NURSE', source_id: O, actual_at: ts(-250), signed_by: 'nurse_x' });
      const X = await ins('admin_exceptions', { admission_id: adm, type: 'DELAYED_TRANSFER', disposition: 'TRANSFER', evidence_ids: [P] });
      await ins('stay_boundary_amendments', { admission_id: adm, stay_id: stay, exception_id: X, evidence_id: P, version: 1, started_at: ts(-1000), ended_at: ts(-250) });
    }
    return {
      doc, adm, O, stay,
      cancel: { admission_id: adm, transfer_order_id: O, reason: 'plan changed', signed_by: doc, signed_at: ts(-200) },
      transfer: { admission_id: adm, transfer_order_id: O, old_stay_id: stay, transferred_at: o.delayed ? ts(-250) : ts(-100), signed_by: 'nurse_x' },
      evidence: { admission_id: adm, kind: o.kind ?? 'TRANSFER_HANDOVER', role: 'NURSE', source_id: O, actual_at: o.cancelled ? ts(-100) : ts(-250), shift_id: U() },
    };
  }
  const MC = 'Withdrawal requires current Doctor and truly unperformed current transfer authority';
  const runC = (w) => ins('transfer_order_cancellations', w.cancel);
  await accept(NC, 'valid withdrawal', () => wd(), runC);
  await reject(NC, 'not the admitting doctor', MC, () => wd({ otherDoctor: true }), runC);
  await reject(NC, 'signer is not a Doctor', MC, () => wd({ role: 'NURSE' }), runC);
  await reject(NC, 'order superseded', MC, () => wd({ newer: true }), runC);
  await reject(NC, 'stay already closed', MC, () => wd({ closed: true }), runC);
  await reject(NC, 'transfer already performed', MC, () => wd({ performed: true }), runC);
  await reject(NC, 'handover already witnessed', MC, () => wd({ handover: true }), runC);
  await reject(NC, 'episode not admitted', MC, () => wd({ status: 'PENDING' }), runC);
  await reject(NC, 'blank reason', MC, async () => { const w = await wd(); w.cancel.reason = '   '; return w; }, runC);
  await reject(NC, 'signed in the future', MC, async () => { const w = await wd(); w.cancel.signed_at = ts(60); return w; }, runC);

  const MT = 'Actual transfer cannot consume cancelled or superseded authority';
  const runT = (w) => ins('admission_transfers', w.transfer);
  await accept(NT, 'transfer of the current authority', () => wd(), runT);
  await accept(NT, 'no authority (WHEN transfer_order_id IS NULL)', () => wd({ otherDoctor: true }), (w) => ins('admission_transfers', { ...w.transfer, transfer_order_id: null }));
  await accept(NT, 'cancelled but performed earlier through a delayed-transfer exception', () => wd({ cancelled: true, delayed: true }), runT);
  await reject(NT, 'cancelled authority', MT, () => wd({ cancelled: true }), runT);
  await reject(NT, 'superseded authority', MT, () => wd({ newer: true }), runT);
  await reject(NT, 'order for a different stay', MT, async () => { const w = await wd(); w.transfer.old_stay_id = U(); return w; }, runT);
  await reject(NT, 'episode not admitted', MT, () => wd({ status: 'PENDING' }), runT);

  const MW = 'Witnessed transfer requires current uncancelled original authority';
  const runW = (w) => ins('exception_evidence', w.evidence);
  await accept(NW, 'witness of the current authority', () => wd(), runW);
  await accept(NW, 'other evidence kinds are not checked', () => wd({ closed: true, kind: 'PHYSICAL_EXIT' }), runW);
  await reject(NW, 'cancelled authority', MW, () => wd({ cancelled: true }), runW);
  await reject(NW, 'superseded authority', MW, () => wd({ newer: true }), runW);
  await reject(NW, 'stay already closed', MW, () => wd({ closed: true }), runW);
  await reject(NW, 'transfer already performed', MW, () => wd({ performed: true }), runW);
  await reject(NW, 'witnessed before the order', MW, async () => { const w = await wd(); w.evidence.actual_at = ts(-400); return w; }, runW);
}

// ------------------------------------------------------------------ 9. vacancy attendance guards
{
  const [NE, NV] = ['attendance_vacancy_guard__nursing_shift_ends', 'attendance_vacancy_guard__room_vacations'];
  const world = async () => {
    const adm = await admission(); const vac = ts(-200);
    const shift = await ins('nursing_shifts', { admission_id: adm, started_at: ts(-900) });
    const stay = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-900), ended_at: vac });
    await ins('room_vacations', { admission_id: adm, stay_id: stay, shift_id: shift, vacated_at: vac });
    const stay2 = await ins('room_stays', { admission_id: adm, bed_id: U(), started_at: ts(-900), ended_at: vac });
    return { adm, shift, stay, stay2 };
  };
  await accept(NE, 'shift ends after vacancy', world, (w) => ins('nursing_shift_ends', { shift_id: w.shift, ended_at: ts(-100) }));
  await reject(NE, 'shift ends before vacancy', 'Shift end cannot precede recorded physical bed vacancy', world, (w) => ins('nursing_shift_ends', { shift_id: w.shift, ended_at: ts(-300) }));
  await accept(NV, 'vacation insert only takes the episode lock', world, (w) => ins('room_vacations', { admission_id: w.adm, stay_id: w.stay2, shift_id: w.shift, vacated_at: ts(-200) }));
  // row-lock behaviour: a second connection cannot lock the episode while the trigger holds it
  try {
    const w = await world();
    const c2 = await conn(DB); await c2.query('SET innodb_lock_wait_timeout=1');
    await install(NV); await c.query('BEGIN');
    await ins('room_vacations', { admission_id: w.adm, stay_id: w.stay2, shift_id: w.shift, vacated_at: ts(-200) });
    let err = null; try { await c2.query('SELECT id FROM admissions WHERE id=? FOR UPDATE', [w.adm]); } catch (e) { err = e; }
    await c.query('ROLLBACK'); await uninstallAll(); await c2.end();
    if (!err || err.errno !== 1205) throw new Error('episode row was not locked');
    record(NV, 'rej', true, 'episode row locked until commit');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); record(NV, 'rej', false, 'episode row locked until commit', e.message); }
}

// ------------------------------------------------------------------ 10. lock_document_identity_source
{
  const N = 'identification_document_source';
  const world = async () => ({ adm: await admission(), adm2: await admission(), patient: U() });
  await accept(N, 'identification insert', world, async (w) => {
    await ins('patient_identifications', { patient_id: w.patient, admission_id: w.adm });
    const r = await q('SELECT COUNT(*) n FROM hims_locks WHERE lock_key=?', [`document-identity:${w.patient}`]);
    if (r[0].n !== 1) throw new Error('lock row missing');
  });
  try {
    const w = await world();
    const c2 = await conn(DB); await c2.query('SET FOREIGN_KEY_CHECKS=0'); await c2.query('SET check_constraint_checks=0'); await c2.query('SET innodb_lock_wait_timeout=1');
    await install(N); await c.query('BEGIN');
    await ins('patient_identifications', { patient_id: w.patient, admission_id: w.adm });
    // same patient on another admission must wait for the identity lock
    let err = null;
    try { await c2.query('BEGIN'); await c2.query("INSERT INTO patient_identifications (patient_id, admission_id, exception_id, version, name, sex, evidence, reason, signed_by) VALUES (?,?,?,?,?,?,?,?,?)", [w.patient, w.adm2, U(), 1, 'n', 'MALE', 'e', 'r', 's']); } catch (e) { err = e; }
    await c2.query('ROLLBACK').catch(() => {});
    // a different patient on another admission does not wait
    let other = null;
    try { await c2.query('BEGIN'); await c2.query("INSERT INTO patient_identifications (patient_id, admission_id, exception_id, version, name, sex, evidence, reason, signed_by) VALUES (?,?,?,?,?,?,?,?,?)", [U(), w.adm2, U(), 1, 'n', 'MALE', 'e', 'r', 's']); } catch (e) { other = e; }
    await c2.query('ROLLBACK').catch(() => {});
    await c.query('ROLLBACK'); await uninstallAll(); await c2.end();
    if (!err || err.errno !== 1205) throw new Error(`same patient was not serialized (${err?.errno})`);
    if (other) throw new Error('different patient was blocked: ' + other.message);
    record(N, 'rej', true, 'same-patient writers serialize on the identity lock');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); record(N, 'rej', false, 'identity lock', e.message); }
}

// ------------------------------------------------------------------ 11. pharmacy movement + transfer boundary
{
  const N = 'pharmacy_movement_source_guard';
  async function ph(o = {}) {
    const adm = await admission(); const med = `med_${++seq}`; const unit = 'tab';
    const batch = await ins('pharmacy_batches', { medicine_id: med, unit, quantity_scale: 2 });
    const order = await ins('clinical_orders', { admission_id: adm, kind: 'MEDICINE', medicine_item_id: o.orderMed ?? med });
    const id = U(); const chargeId = U();
    await ins('charges', { id: chargeId, admission_id: adm, category: 'medicine', item_id: med, unit, source_event_id: id, quantity: o.chargeQty ?? '5' });
    const base = { batch_id: batch, admission_id: adm, order_id: order, charge_id: chargeId, purpose: 'ward', signed_by: 'ph' };
    const issue = { ...base, id, kind: 'ISSUE', quantity: o.qty ?? '-5' };
    let ret = null, rev = null;
    if (o.withIssue) {
      await ins('pharmacy_movements', issue);
      ret = { ...base, kind: 'RETURN', quantity: o.retQty ?? '2', original_issue_id: id };
      if (o.badReversal) ret.reversal_id = U();
    }
    return { issue, ret, base };
  }
  const mv = (x) => ({ reference: `r_${++seq}`, ...x });
  await accept(N, 'valid issue', () => ph(), (w) => ins('pharmacy_movements', mv(w.issue)));
  await accept(N, 'valid partial return', () => ph({ withIssue: true }), (w) => ins('pharmacy_movements', mv(w.ret)));
  await accept(N, 'receipt movements skip source identity checks', () => ph(), (w) => ins('pharmacy_movements', mv({ batch_id: w.base.batch_id, kind: 'RECEIPT', quantity: '3', admission_id: null, order_id: null, charge_id: null, signed_by: 'ph' })));
  await reject(N, 'quantity beyond configured scale', 'Quantity must use the exact configured stock scale', () => ph({ qty: '-5.123' }), (w) => ins('pharmacy_movements', mv(w.issue)));
  await reject(N, 'order for a different medicine', 'Pharmacy movement must retain Doctor medicine and economic source identity', () => ph({ orderMed: 'other' }), (w) => ins('pharmacy_movements', mv(w.issue)));
  await reject(N, 'issue quantity differs from charge', 'Issue quantity must match its unique original medicine charge', () => ph({ chargeQty: '4' }), (w) => ins('pharmacy_movements', mv(w.issue)));
  await reject(N, 'return beyond issued quantity', 'Return must retain original issue and cannot exceed its net quantity', () => ph({ withIssue: true, retQty: '6' }), (w) => ins('pharmacy_movements', mv(w.ret)));
  await reject(N, 'return with a foreign reversal', 'Return must retain original issue and cannot exceed its net quantity', () => ph({ withIssue: true, badReversal: true }), (w) => ins('pharmacy_movements', mv(w.ret)));
  await reject(N, 'return without an original issue', 'query returned no rows', () => ph({ withIssue: true }), (w) => ins('pharmacy_movements', mv({ ...w.ret, original_issue_id: U() })));
  await reject(N, 'unknown batch', 'query returned no rows', () => ph(), (w) => ins('pharmacy_movements', mv({ ...w.issue, batch_id: U() })));
}
{
  const N = 'exact_transfer_boundary';
  async function tb(o = {}) {
    const nurse = await staff('NURSE'); const adm = await admission(); const tt = ts(-100); const b1 = U(), b2 = U();
    const prev = await ins('room_stays', { admission_id: adm, bed_id: b1, started_at: ts(-1000), ended_at: tt });
    const next = await ins('room_stays', { admission_id: adm, bed_id: o.nextBed ?? b2, started_at: o.nextStart ?? tt, ended_at: null });
    const O = await ins('transfer_orders', { admission_id: adm, source_stay_id: prev });
    const shift = await ins('nursing_shifts', { admission_id: adm, nurse_id: nurse });
    return { row: { admission_id: adm, transfer_order_id: O, old_stay_id: prev, new_stay_id: next, old_bed_id: b1, target_bed_id: b2, shift_id: shift, transferred_at: tt, signed_by: o.signer ?? nurse } };
  }
  const run = (w) => ins('admission_transfers', w.row);
  const M = 'Transfer must retain exact adjacent stays and episode/signature provenance';
  await accept(N, 'exact adjacent stays', () => tb(), run);
  await accept(N, 'no order (WHEN)', () => tb({ signer: 'x' }), (w) => ins('admission_transfers', { ...w.row, transfer_order_id: null }));
  await reject(N, 'next stay on the same bed', M, () => tb({ nextBed: undefined, nextStart: ts(-90) }), run);
  await reject(N, 'next stay starts later', M, () => tb({ nextStart: ts(-90) }), run);
  await reject(N, 'signer is not the shift nurse', M, () => tb({ signer: 'x' }), run);
}

// ------------------------------------------------------------------ 12. clearance invalidation triggers (v1 workflow)
const clearanceBlocks = [...blocks.values()].filter((b) => b.create.includes('invalidate_clearances('));
const byPg = new Map();
for (const b of clearanceBlocks) { const a = byPg.get(b.pg_name) ?? []; a.push(b); byPg.set(b.pg_name, a); }
const sealsFor = async (adm) => { for (const g of GATES) await ins('clearance_seals', { admission_id: adm, gate: g, signed_at: ts(-1500) }); };
const gatesOf = async (adm) => (await q('SELECT s.gate g FROM clearance_invalidations i JOIN clearance_seals s ON s.id=i.seal_id WHERE s.admission_id=?', [adm])).map((r) => r.g).sort((a, b) => GATES.indexOf(a) - GATES.indexOf(b));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const R = async (adm, ov = {}) => ins('receipts', { admission_id: adm, ...ov });
const CH = async (adm, cat = 'room') => ins('charges', { admission_id: adm, category: cat });
// spec: pg trigger -> {gate, make(adm) => {table, row, parentOnly?}}
const SPEC = {
  administrative_shift_end_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'administrative_shift_ends', row: { admission_id: a } }) },
  admission_transfers_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'admission_transfers', row: { admission_id: a } }) },
  allocation_cancellations_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'allocation_cancellations', row: { allocation_id: await ins('receipt_allocations', { receipt_id: await R(a) }) }, unresolved: { allocation_id: U() } }) },
  amended_cutoff_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'stay_boundary_amendments', row: { admission_id: a } }) },
  care_source_clearance: { gate: 'BILLING', cats: true, make: async (a, cat = 'room') => ({ table: 'care_billing_events', row: { admission_id: a, category: cat } }) },
  charge_finalizations_clearance: { gate: 'BILLING', cats: true, make: async (a, cat = 'room') => ({ table: 'charge_finalizations', row: { charge_id: await CH(a, cat) }, unresolved: { charge_id: U() } }) },
  charge_reversals_clearance: { gate: 'BILLING', cats: true, make: async (a, cat = 'room') => ({ table: 'charge_reversals', row: { charge_id: await CH(a, cat) }, unresolved: { charge_id: U() } }) },
  charges_clearance: { gate: 'BILLING', cats: true, make: async (a, cat = 'room') => ({ table: 'charges', row: { admission_id: a, category: cat } }) },
  clinical_addenda_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'clinical_addenda', row: { note_id: await ins('clinical_rounds', { admission_id: a }) }, unresolved: { note_id: U() } }) },
  clinical_orders_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'clinical_orders', row: { admission_id: a } }) },
  clinical_rounds_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'clinical_rounds', row: { admission_id: a } }) },
  clinical_summaries_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'clinical_summaries', row: { admission_id: a } }) },
  clinical_task_events_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'clinical_task_events', row: { order_id: await ins('clinical_orders', { admission_id: a }) }, unresolved: { order_id: U() } }) },
  exception_doctor_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'exception_evidence', row: { admission_id: a, role: 'DOCTOR', kind: 'PROFESSIONAL_REVIEW' }, wrong: { role: 'NURSE', kind: 'PHYSICAL_EXIT' } }) },
  exception_nurse_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'exception_evidence', row: { admission_id: a, role: 'NURSE', kind: 'PHYSICAL_EXIT' }, wrong: { role: 'DOCTOR', kind: 'PROFESSIONAL_REVIEW' } }) },
  insurance_conversions_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'insurance_conversions', row: { case_id: await ins('insurance_cases', { admission_id: a }) }, unresolved: { case_id: U() } }) },
  insurance_decisions_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'insurance_decisions', row: { case_id: await ins('insurance_cases', { admission_id: a }) }, unresolved: { case_id: U() } }) },
  insurance_events_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'insurance_events', row: { case_id: await ins('insurance_cases', { admission_id: a }), kind: 'POLICY' }, wrong: { kind: 'NOTE' } }) },
  insurance_transfer_resolutions_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'insurance_transfer_resolutions', row: { case_id: await ins('insurance_cases', { admission_id: a }) }, unresolved: { case_id: U() } }) },
  lab_dispositions_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'lab_dispositions', row: { admission_id: a } }) },
  lab_report_addenda_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'lab_report_addenda', row: { report_id: await ins('lab_reports', { admission_id: a }) }, unresolved: { report_id: U() } }) },
  lab_reports_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'lab_reports', row: { admission_id: a } }) },
  medication_administrations_clearance: { gate: 'PHARMACY', make: async (a) => ({ table: 'medication_administrations', row: { admission_id: a } }) },
  nursing_addenda_clearance: { gate: 'NURSING', mar: true, make: async (a, rt = 'OBSERVATION') => ({ table: 'nursing_addenda', row: { admission_id: a, record_type: rt } }) },
  nursing_consumables_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'nursing_consumables', row: { admission_id: a } }) },
  nursing_observations_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'nursing_observations', row: { admission_id: a } }) },
  nursing_shift_ends_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'nursing_shift_ends', row: { shift_id: await ins('nursing_shifts', { admission_id: a }) }, unresolved: { shift_id: U() } }) },
  nursing_shifts_clearance: { gate: 'NURSING', make: async (a) => ({ table: 'nursing_shifts', row: { admission_id: a } }) },
  patient_identification_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'patient_identifications', row: { admission_id: a } }) },
  pharmacy_movements_clearance: { gate: 'PHARMACY', make: async (a) => ({ table: 'pharmacy_movements', row: { admission_id: a } }), viaCharge: true },
  pharmacy_preparations_clearance: { gate: 'PHARMACY', make: async (a) => ({ table: 'pharmacy_preparations', row: { admission_id: a } }) },
  receipt_allocations_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'receipt_allocations', row: { receipt_id: await R(a) }, unresolved: { receipt_id: U() } }) },
  receipt_refunds_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'receipt_refunds', row: { admission_id: a, receipt_id: await R(a) } }) },
  receipts_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'receipts', row: { admission_id: a } }) },
  room_return_invalidation: { gate: 'DOCTOR', make: async (a) => ({ table: 'room_returns', row: { admission_id: a } }) },
  room_source_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'room_stays', row: { admission_id: a, started_at: ts(-100) } }) },
  room_vacations_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'room_vacations', row: { admission_id: a } }) },
  self_pay_reviews_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'self_pay_reviews', row: { admission_id: a } }) },
  stay_amendment_invalidation: { gate: 'BILLING', make: async (a) => ({ table: 'stay_boundary_amendments', row: { admission_id: a } }) },
  transfer_cancellation_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'transfer_order_cancellations', row: { admission_id: a } }) },
  transfer_insurance_tasks_clearance: { gate: 'BILLING', make: async (a) => ({ table: 'transfer_insurance_tasks', row: { admission_id: a } }) },
  transfer_orders_clearance: { gate: 'DOCTOR', make: async (a) => ({ table: 'transfer_orders', row: { admission_id: a } }) },
};
for (const [pg, bl] of byPg) {
  const spec = SPEC[pg];
  const ns = bl.map((b) => b.name);
  const insNames = bl.filter((b) => b.event === 'INSERT').map((b) => b.name);
  if (!spec) { for (const n of ns) entry(n).fails.push('no test spec'); continue; }
  const prep = async (cat) => { const a = await admission(); await sealsFor(a); const spec1 = await spec.make(a, cat); return { a, ...spec1 }; };
  const exp = (g) => fromGate(g);
  await accept(insNames, `invalidates seals from ${spec.gate}`, () => prep(), async (w) => {
    await ins(w.table, w.row); const got = await gatesOf(w.a);
    if (!same(got, exp(spec.gate))) throw new Error(`got ${got} expected ${exp(spec.gate)}`);
  });
  await noEffect(insNames, 'other episode is untouched', async () => { const w = await prep(); const other = await admission(); const o2 = await spec.make(other); return { ...w, other }; },
    async (w) => { const b = await admission(); const s2 = await spec.make(b); await ins(s2.table, s2.row); }, async (w) => same(await gatesOf(w.a), []));
  if (spec.unresolved) await noEffect(insNames, 'unresolvable parent is ignored', () => prep(), (w) => ins(w.table, { ...w.row, ...spec.unresolved }), async (w) => same(await gatesOf(w.a), []));
  if (spec.wrong) await noEffect(insNames, 'row filtered out by WHEN/kind', () => prep(), (w) => ins(w.table, { ...w.row, ...spec.wrong }), async (w) => same(await gatesOf(w.a), []));
  if (spec.cats) {
    for (const [cat, g] of [['medicine', 'PHARMACY'], ['consumable', 'NURSING'], ['room', 'BILLING']]) {
      await accept(insNames, `category ${cat} starts at ${g}`, () => prep(cat), async (w) => { await ins(w.table, w.row); const got = await gatesOf(w.a); if (!same(got, exp(g))) throw new Error(`got ${got} expected ${exp(g)}`); });
    }
  }
  if (spec.mar) await accept(insNames, 'MAR addendum starts at PHARMACY', () => prep('MAR'), async (w) => { await ins(w.table, w.row); const got = await gatesOf(w.a); if (!same(got, exp('PHARMACY'))) throw new Error(`got ${got}`); });
  if (spec.viaCharge) {
    await accept(insNames, 'episode resolved through the charge when admission_id is NULL', async () => { const a = await admission(); await sealsFor(a); return { a, ch: await CH(a, 'consumable') }; },
      async (w) => { await ins('pharmacy_movements', { admission_id: null, charge_id: w.ch }); const got = await gatesOf(w.a); if (!same(got, exp('NURSING'))) throw new Error(`got ${got}`); });
  }
  // UPDATE variants
  for (const b of bl.filter((x) => x.event === 'UPDATE')) {
    if (b.pg_name === 'care_source_clearance') {
      await accept(b.name, 'any update re-invalidates', async () => { const w = await prep(); await ins(w.table, w.row); return w; }, async (w) => { await q('UPDATE care_billing_events SET state=\'X\' WHERE admission_id=?', [w.a]); const got = await gatesOf(w.a); if (!same(got, exp('BILLING'))) throw new Error(`got ${got}`); });
      await noEffect(b.name, 'update of another episode ignored', () => prep(), async (w) => { const o = await admission(); await ins('care_billing_events', { admission_id: o }); await q('UPDATE care_billing_events SET state=\'X\' WHERE admission_id=?', [o]); }, async (w) => same(await gatesOf(w.a), []));
    } else {
      const mk = async () => { const a = await admission(); await sealsFor(a); const st = await ins('room_stays', { admission_id: a, started_at: ts(-100), ended_at: null }); return { a, st }; };
      await accept(b.name, 'tariff pin change invalidates BILLING', mk, async (w) => { await q('UPDATE room_stays SET tariff_version_id=? WHERE id=?', [U(), w.st]); if (!same(await gatesOf(w.a), ['BILLING'])) throw new Error('no invalidation'); });
      await accept(b.name, 'closing the stay invalidates BILLING', mk, async (w) => { await q('UPDATE room_stays SET ended_at=? WHERE id=?', [ts(-50), w.st]); if (!same(await gatesOf(w.a), ['BILLING'])) throw new Error('no invalidation'); });
      await noEffect(b.name, 'cursor/posting updates do not invalidate', mk, (w) => q('UPDATE room_stays SET posted_paise=9, last_reconciled_at=? WHERE id=?', [ts(-60), w.st]), async (w) => same(await gatesOf(w.a), []));
    }
  }
}

// ------------------------------------------------------------------ 13. MVP (workflow 2) invalidation triggers
const inv = async (adm) => (await q('SELECT e.action a, e.check_key k, i.kind kd FROM mvp_invalidations i JOIN mvp_events e ON e.id=i.event_id WHERE e.admission_id=?', [adm])).map((r) => `${r.a}${r.k ? ':' + r.k : ''}=${r.kd}`).sort();
async function mvpWorld(ov = {}) {
  const adm = await admission({ workflow_version: 2, ...ov });
  const ev = {};
  for (const [name, action, key] of [['approval', 'doctor-approval', null], ['list', 'checklist', null], ['phar', 'check', 'PHARMACY'], ['nur', 'n-a', 'NURSING'], ['diag', 'check', 'DIAGNOSTICS'], ['fin', 'finance', null]]) ev[name] = await ins('mvp_events', { admission_id: adm, action, check_key: key, status: 'COMPLETE' });
  return { adm, ev };
}
{
  const N = 'mvp_event_invalidation';
  const add = (w, action, key) => ins('mvp_events', { admission_id: w.adm, action, check_key: key ?? null });
  await accept(N, 'doctor approval invalidates everything earlier', mvpWorld, async (w) => { await add(w, 'doctor-approval'); const g = await inv(w.adm); if (!same(g, ['check:DIAGNOSTICS=doctor-approval', 'check:PHARMACY=doctor-approval', 'checklist=doctor-approval', 'finance=doctor-approval', 'n-a:NURSING=doctor-approval'])) throw new Error(g.join()); });
  await accept(N, 'checklist invalidates checks and finance', mvpWorld, async (w) => { await add(w, 'checklist'); const g = await inv(w.adm); if (!same(g, ['check:DIAGNOSTICS=checklist', 'check:PHARMACY=checklist', 'finance=checklist', 'n-a:NURSING=checklist'])) throw new Error(g.join()); });
  await accept(N, 'a check invalidates finance and checks of the same key', mvpWorld, async (w) => { await add(w, 'check', 'PHARMACY'); const g = await inv(w.adm); if (!same(g, ['check:PHARMACY=check', 'finance=check'])) throw new Error(g.join()); });
  await noEffect(N, 'finance events do not invalidate anything', mvpWorld, (w) => add(w, 'finance'), async (w) => same(await inv(w.adm), []));
  await accept(N, 'repeated invalidation is idempotent (INSERT IGNORE)', mvpWorld, async (w) => { await add(w, 'checklist'); await add(w, 'checklist'); const g = await inv(w.adm); if (g.length !== 4) throw new Error(g.join()); });
}
{
  const N = 'mvp_exception_invalidation';
  await accept(N, 'clinical exception event', mvpWorld, async (w) => { await ins('mvp_exception_events', { admission_id: w.adm, action: 'CLINICAL' }); const g = await inv(w.adm); if (g.length !== 6 || !g.every((x) => x.endsWith('=external-disposition'))) throw new Error(g.join()); });
  await noEffect(N, 'non-clinical exception event', mvpWorld, (w) => ins('mvp_exception_events', { admission_id: w.adm, action: 'ADMIN' }), async (w) => same(await inv(w.adm), []));
}
{
  const N = 'mvp_return_invalidation';
  await accept(N, 'actual return', mvpWorld, async (w) => { await ins('mvp_room_returns', { admission_id: w.adm }); const g = await inv(w.adm); if (g.length !== 6 || !g.every((x) => x.endsWith('=actual-return'))) throw new Error(g.join()); });
  await noEffect(N, 'other episode', mvpWorld, async () => { const o = await admission({ workflow_version: 2 }); await ins('mvp_room_returns', { admission_id: o }); }, async (w) => same(await inv(w.adm), []));
}
{
  const [NC, NR] = ['mvp_external_charge_invalidation', 'mvp_external_reversal_invalidation'];
  const charge = (w, cat) => ins('charges', { admission_id: w.adm, category: cat });
  await accept(NC, 'consultation charge invalidates finance only', mvpWorld, async (w) => { await charge(w, 'consultation'); const g = await inv(w.adm); if (!same(g, ['finance=external-service-charges'])) throw new Error(g.join()); });
  await accept(NC, 'lab charge also invalidates DIAGNOSTICS', mvpWorld, async (w) => { await charge(w, 'lab'); const g = await inv(w.adm); if (!same(g, ['check:DIAGNOSTICS=external-service-charges', 'finance=external-service-charges'])) throw new Error(g.join()); });
  await accept(NC, 'consumable charge also invalidates NURSING', mvpWorld, async (w) => { await charge(w, 'consumable'); const g = await inv(w.adm); if (!same(g, ['finance=external-service-charges', 'n-a:NURSING=external-service-charges'])) throw new Error(g.join()); });
  await noEffect(NC, 'room charge ignored', mvpWorld, (w) => charge(w, 'room'), async (w) => same(await inv(w.adm), []));
  await noEffect(NC, 'workflow 1 episode ignored', () => mvpWorld({ workflow_version: 1 }), (w) => charge(w, 'consultation'), async (w) => same(await inv(w.adm), []));
  await accept(NR, 'reversal of a lab charge', mvpWorld, async (w) => { const ch = await charge(w, 'lab'); await ins('charge_reversals', { charge_id: ch }); const g = await inv(w.adm); if (!same(g, ['check:DIAGNOSTICS=external-service-charge_reversals', 'finance=external-service-charge_reversals'])) throw new Error(g.join()); });
  await noEffect(NR, 'reversal of a room charge ignored', mvpWorld, async (w) => { const ch = await charge(w, 'room'); await ins('charge_reversals', { charge_id: ch }); }, async (w) => same(await inv(w.adm), []));
  await noEffect(NR, 'reversal of an unknown charge ignored', mvpWorld, (w) => ins('charge_reversals', { charge_id: U() }), async (w) => same(await inv(w.adm), []));
}
{
  const NA = 'mvp_transfer_instruction_invalidates', NC = 'mvp_transfer_cancellation_invalidates', NM = 'mvp_transfer_movement_invalidates';
  const all = (kind) => (g) => g.length === 6 && g.every((x) => x.endsWith('=' + kind));
  await accept(NA, 'transfer instruction', mvpWorld, async (w) => { await ins('mvp_transfer_authorities', { admission_id: w.adm }); const g = await inv(w.adm); if (!all('mvp_transfer_authorities')(g)) throw new Error(g.join()); });
  await noEffect(NA, 'other episode', mvpWorld, async () => { const o = await admission({ workflow_version: 2 }); await ins('mvp_transfer_authorities', { admission_id: o }); }, async (w) => same(await inv(w.adm), []));
  await accept(NC, 'transfer cancellation', mvpWorld, async (w) => { await ins('mvp_transfer_cancellations', { admission_id: w.adm }); const g = await inv(w.adm); if (!all('mvp_transfer_cancellations')(g)) throw new Error(g.join()); });
  await noEffect(NC, 'other episode', mvpWorld, async () => { const o = await admission({ workflow_version: 2 }); await ins('mvp_transfer_cancellations', { admission_id: o }); }, async (w) => same(await inv(w.adm), []));
  await accept(NM, 'movement carrying an MVP authority', mvpWorld, async (w) => { await ins('admission_transfers', { admission_id: w.adm, mvp_authority_id: U() }); const g = await inv(w.adm); if (!all('admission_transfers')(g)) throw new Error(g.join()); });
  await noEffect(NM, 'legacy movement without MVP authority', mvpWorld, (w) => ins('admission_transfers', { admission_id: w.adm, mvp_authority_id: null }), async (w) => same(await inv(w.adm), []));
}
// workflow-2 clearance path through the helper (mvp_invalidations)
{
  const N = 'charges_clearance';
  await accept(N, 'workflow 2: charge invalidates finance events through invalidate_clearances', mvpWorld, async (w) => { await ins('charges', { admission_id: w.adm, category: 'room' }); const g = await inv(w.adm); if (!same(g, ['finance=charges'])) throw new Error(g.join()); });
  await accept(N, 'workflow 2: medicine charge also invalidates the PHARMACY check', mvpWorld, async (w) => { await ins('charges', { admission_id: w.adm, category: 'medicine' }); const g = await inv(w.adm); if (!same(g, ['check:PHARMACY=charges', 'finance=charges'])) throw new Error(g.join()); });
}

// ------------------------------------------------------------------ 14. integration with the helper (all triggers installed)
{
  const label = 'integration: second invalidation of an already invalidated seal does not raise (helper vs *_immutable triggers)';
  try {
    for (const b of blocks.values()) { await c.query(b.create); installed.add(b.name); }
    const a = await admission(); await sealsFor(a);
    await q("SET @x = invalidate_clearances(?, 'DOCTOR', 'first', '[\"a\"]')", [a]);
    await q("SET @x = invalidate_clearances(?, 'DOCTOR', 'second', '[\"b\"]')", [a]);
    console.log('PASS ' + label);
  } catch (e) { console.log(`FAIL ${label}: ${e.errno} ${e.message}`); process.exitCode = 1; }
  await uninstallAll();
}

// ------------------------------------------------------------------ report
let bad = 0;
for (const b of blocks.values()) {
  const e = entry(b.name);
  const ok = e.acc >= 1 && e.rej >= 1 && e.fails.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${b.name} (${b.timing} ${b.event} ${b.table}) accepted=${e.acc} rejected=${e.rej}${e.fails.length ? '\n     - ' + e.fails.join('\n     - ') : ''}${e.acc < 1 || e.rej < 1 ? (e.fails.length ? '' : ' (missing accept or reject case)') : ''}`);
}
console.log(`\n${blocks.size - bad}/${blocks.size} MariaDB triggers PASS`);
if (bad) process.exitCode = 1;
await uninstallAll();
await c.end();
if (!process.env.T3_KEEP) {
  const r = await mysql.createConnection({ host: env.MARIADB_HOST, port: +env.MARIADB_PORT, user: env.MARIADB_ROOT_USER, password: env.MARIADB_ROOT_PASSWORD });
  await r.query(`DROP DATABASE IF EXISTS ${DB}`); await r.end();
}
