// T2.test.mjs - applies 0001/0002/0003 + T2.sql to scratch DB port_t2 (twice) and checks every T2 trigger
// with one accepted and at least one rejected row (asserting the original message text). Plain node + mysql2.
// Run: node web/drizzle-maria/triggers/T2.test.mjs   (set MYSQL2_PATH to a dir containing node_modules/mysql2 if needed)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire((process.env.MYSQL2_PATH ?? "C:/Users/prate/AppData/Local/Temp/claude/8e4d92b4015353d0/4cd94459-c906-4532-8635-f6f792ea0f87/scratchpad/probe") + "/");
const mysql = require("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "tmp/mariadb-local/root.env"), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const DB = "port_t2";
const conn = (database) => mysql.createConnection({ host: env.MARIADB_HOST, port: +env.MARIADB_PORT, user: env.MARIADB_ROOT_USER, password: env.MARIADB_ROOT_PASSWORD, database, timezone: "Z", dateStrings: true, multipleStatements: true });

// ---------- schema application ----------
async function applyAll(c) {
  const d = path.join(root, "web/drizzle-maria");
  await c.query(fs.readFileSync(path.join(d, "0001_tables.sql"), "utf8"));
  const raw = fs.readFileSync(path.join(d, "0002_helpers.sql"), "utf8").split(/\r?\n/).filter((l) => !/^DELIMITER/.test(l)).join("\n");
  const helpers = raw.split(/\$\$[ \t]*(?:\n|$)/);
  for (const stmt of helpers) { if (stmt.split("\n").some((l) => l.trim() && !l.trim().startsWith("--"))) await c.query(stmt); }
  await c.query(fs.readFileSync(path.join(d, "0003_views.sql"), "utf8"));
}
function triggerBlocks() {
  const text = fs.readFileSync(path.join(here, "T2.sql"), "utf8");
  const blocks = [];
  const re = /^-- TRIGGER name=(\S+) table=(\S+) timing=(\S+) event=(\S+) pg_name=(\S+)\n([\s\S]*?)^-- END TRIGGER$/gm;
  let m;
  while ((m = re.exec(text))) {
    const [drop, ...rest] = m[6].split(/;\n(?=CREATE TRIGGER)/);
    blocks.push({ name: m[1], table: m[2], timing: m[3], event: m[4], pg: m[5], drop: drop + ";", create: rest.join(";\n").trim() });
  }
  return blocks;
}
async function applyTriggers(c) {
  const blocks = triggerBlocks();
  for (const b of blocks) { await c.query(b.drop); await c.query(b.create); }
  return blocks.length;
}

// ---------- fixtures ----------
const results = [];
let c; // main connection (FK checks off: only the columns the triggers read are populated)
const uuid = () => randomUUID();
const q = (sql, p) => c.query(sql, p);
const ins = async (table, row) => { const k = Object.keys(row); await q(`INSERT INTO \`${table}\` (${k.map((x) => `\`${x}\``).join(",")}) VALUES (${k.map(() => "?").join(",")})`, k.map((x) => (row[x] !== null && typeof row[x] === "object" && !(row[x] instanceof Date) ? JSON.stringify(row[x]) : row[x]))); return row; };
const iso = (d) => d.toISOString();
const ago = (ms) => new Date(Date.now() - ms);
const dt = (d) => d.toISOString().replace("T", " ").replace("Z", "");
async function expectOk(name, fn) { try { await fn(); results.push([name, "PASS"]); } catch (e) { results.push([name, "FAIL", `unexpected rejection: ${e.errno} ${e.message}`]); } }
async function expectReject(name, message, fn) {
  try { await fn(); results.push([name, "FAIL", "row was accepted"]); }
  catch (e) { results.push(e.errno === 1644 && e.sqlMessage === message ? [name, "PASS"] : [name, "FAIL", `got ${e.errno} '${e.sqlMessage}', wanted '${message}'`]); }
}
async function staff(id, role, extra = {}) { await q("DELETE FROM staff_user WHERE id=?", [id]); await ins("staff_user", { id, name: `Name ${id}`, email: `${id}@t.test`, role, ...extra }); return id; }
async function episode(o = {}) {
  const id = uuid();
  await ins("admissions", { id, hospital_id: o.hospital ?? uuid(), patient_id: o.patient ?? uuid(), ip_code: `IP-${id}`, status: o.status ?? "ADMITTED", bed_id: o.bed ?? uuid(), payment_route: o.route ?? "SELF_PAY", expected_stay_days: 3, created_by: "sys", request_id: uuid(), request_payload: "{}", workflow_version: o.wv ?? 2, ...((o.wv ?? 2) === 2 ? { external_doctor_id: uuid() } : { admitting_doctor_id: 'doc', clinician_assessment: {} }), bill_revision: o.bill ?? 1, admitted_at: dt(o.admitted ?? ago(86400000 * 2)), version: o.version ?? 1 });
  return id;
}
async function nurse(admission, id) { await staff(id, "NURSE"); const a = uuid(); await ins("nurse_assignments", { id: a, admission_id: admission, nurse_id: id, assigned_by: "adm", reason: "r", recorded_at: dt(ago(1000)) }).catch(async () => {}); return id; }
async function showCols(t) { const [r] = await q(`SELECT column_name n, is_nullable nl, column_default d, column_type ty FROM information_schema.columns WHERE table_schema=? AND table_name=?`, [DB, t]); return r; }
async function ev(admission, action, o = {}) {
  const row = { id: o.id ?? uuid(), admission_id: admission, action, check_key: o.check_key ?? null, status: o.status ?? null, payload: o.payload ?? {}, review_hash: "h", bill_version: o.bill ?? 1, clinical_id: o.clinical ?? null, checklist_id: o.checklist ?? null, recorded_by: o.by ?? "x", recorded_at: dt(o.at ?? ago(60000)) };
  return row;
}


// ---------- test cases ----------
async function runCases() {
  const blocks = triggerBlocks();
  // run fn with the named triggers dropped (fixture rows that bypass guards), then restore them
  const without = async (names, fn) => {
    for (const n of names) await q(`DROP TRIGGER IF EXISTS \`${n}\``);
    try { return await fn(); } finally { for (const b of blocks.filter((x) => names.includes(x.name))) { await q(b.drop); await q(b.create); } }
  };
  const sid = (p) => `${p}-${uuid().slice(0, 8)}`;
  const HASH = "a".repeat(64);
  const mkNurse = async (adm, id = sid("nurse")) => { await staff(id, "NURSE"); await ins("nurse_assignments", { admission_id: adm, nurse_id: id, authority: "adm", reason: "assigned", signed_by: "adm" }); return id; };
  const shiftFor = async (adm, nurseId, start = ago(86400000)) => { const id = uuid(); await ins("nursing_shifts", { id, admission_id: adm, nurse_id: nurseId, started_at: dt(start), handover: "h", signed_by: nurseId }); return id; };
  const mkEv = async (adm, action, o = {}) => { const r = await ev(adm, action, { ...o, by: o.by ?? "sys" }); r.review_hash = HASH; await without(["mvp_event_source", "mvp_pending_return", "mvp_pending_transfer_approval"], () => ins("mvp_events", r)); return r.id; };
  const mkXe = async (adm, action, type, o = {}) => { const id = o.id ?? uuid(); await without(["mvp_exception_source"], () => ins("mvp_exception_events", { id, admission_id: adm, action, type, source_id: o.source ?? null, payload: o.payload ?? {}, bill_version: o.bill ?? 1, recorded_by: o.by ?? "sys", recorded_at: dt(o.at ?? ago(300000)) })); return id; };

  // ===== guard_mvp_staff_event: 3 triggers =====
  await q("DELETE FROM availability_coordinators"); await q("DELETE FROM doctor_availability"); await q("DELETE FROM doctor_directory_versions");
  const admin = await staff(sid("admin"), "ADMIN");
  const n1 = await staff(sid("n"), "NURSE"); const n2 = await staff(sid("n"), "NURSE");
  const coord = (o = {}) => ({ id: uuid(), nurse_id: n1, backup_nurse_id: n2, starts_at: dt(ago(3600000)), ends_at: dt(new Date(Date.now() + 3600000)), version: 1, reason: "roster", recorded_by: admin, request_id: uuid(), request_payload: "{}", ...o });
  await expectOk("availability_coordinator_authority: accepts Admin + next version + active Nurses", () => ins("availability_coordinators", coord()));
  await expectReject("availability_coordinator_authority: rejects stale version", "Admin must designate active Nurse responsibility and backup", () => ins("availability_coordinators", coord({ version: 1 })));
  await expectReject("availability_coordinator_authority: rejects non-Admin", "Admin must designate active Nurse responsibility and backup", () => ins("availability_coordinators", coord({ version: 2, recorded_by: n1 })));
  await expectReject("availability_coordinator_authority: rejects unknown staff", "Active attributable staff required", () => ins("availability_coordinators", coord({ version: 2, recorded_by: "ghost" })));
  const [[cr]] = await q("SELECT id FROM availability_coordinators ORDER BY version DESC LIMIT 1").then(([r]) => [r]);
  const doctor = uuid();
  const dv = (o = {}) => ({ id: uuid(), doctor_id: doctor, name: "Dr Who", specialty: null, active: 1, version: 1, reason: "dir", recorded_by: admin, request_id: uuid(), request_payload: "{}", ...o });
  await expectOk("doctor_directory_version_authority: accepts Admin + next version", () => ins("doctor_directory_versions", dv()));
  await expectReject("doctor_directory_version_authority: rejects skipped version", "Current Admin and next Doctor directory version required", () => ins("doctor_directory_versions", dv({ version: 3 })));
  await expectReject("doctor_directory_version_authority: rejects non-Admin", "Current Admin and next Doctor directory version required", () => ins("doctor_directory_versions", dv({ version: 2, recorded_by: n1 })));
  const da = (o = {}) => ({ id: uuid(), doctor_id: doctor, coordinator_id: cr.id, status: "AVAILABLE", starts_at: dt(ago(1800000)), ends_at: dt(new Date(Date.now() + 1800000)), remarks: "remarks ok", version: 1, recorded_by: n1, request_id: uuid(), request_payload: "{}", ...o });
  await expectOk("doctor_availability_authority: accepts designated Nurse within roster", () => ins("doctor_availability", da()));
  await expectOk("doctor_availability_authority: accepts backup Nurse", () => ins("doctor_availability", da({ version: 2, recorded_by: n2 })));
  await expectReject("doctor_availability_authority: rejects wrong actor", "Current designated Nurse and active Doctor availability version required", () => ins("doctor_availability", da({ version: 3, recorded_by: admin })));
  await expectReject("doctor_availability_authority: rejects version gap", "Current designated Nurse and active Doctor availability version required", () => ins("doctor_availability", da({ version: 9 })));
  await expectReject("doctor_availability_authority: rejects outside roster window", "Current designated Nurse and active Doctor availability version required", () => ins("doctor_availability", da({ version: 3, ends_at: dt(new Date(Date.now() + 86400000)) })));

  // ===== mvp_episode_version =====
  const epV = await episode({ wv: 2 });
  await expectOk("mvp_episode_version: accepts update that keeps workflow_version", () => q("UPDATE admissions SET bill_revision = bill_revision + 1, workflow_version = 2 WHERE id = ?", [epV]));
  await expectReject("mvp_episode_version: rejects workflow_version change", "Episode workflow cannot be silently reinterpreted", () => q("UPDATE admissions SET workflow_version = 1 WHERE id = ?", [epV]));

  // ===== pharmacy_batch_identity_immutable =====
  const batch = uuid();
  await ins("pharmacy_batches", { id: batch, hospital_id: uuid(), medicine_id: "M1", catalog_version_id: uuid(), batch_no: "B1", expires_on: "2030-01-01", unit: "tab", quantity_scale: 0, barcode: sid("bc"), available_quantity: 10, signed_by: "p" });
  await expectOk("pharmacy_batch_identity_immutable: accepts available_quantity change", () => q("UPDATE pharmacy_batches SET available_quantity = 7 WHERE id = ?", [batch]));
  await expectReject("pharmacy_batch_identity_immutable: rejects identity change", "Medicine batch identity is immutable; append a new batch or audited movement", () => q("UPDATE pharmacy_batches SET batch_no = 'B2' WHERE id = ?", [batch]));
  await expectReject("pharmacy_batch_identity_immutable: rejects unit change", "Medicine batch identity is immutable; append a new batch or audited movement", () => q("UPDATE pharmacy_batches SET unit = 'ml' WHERE id = ?", [batch]));

  // ===== paperwork =====
  {
    const run = uuid(), prop = uuid(), rev = uuid(); const owner = sid("ins");
    const packetJson = { staffNextAction: "Call the TPA", missing: [] };
    await ins("paperwork_runs", { id: run, case_id: uuid(), source: {}, source_hash: HASH, status: "PROCESSING", revision: 1, pending_review_id: rev, recorded_by: owner });
    await ins("paperwork_proposals", { id: prop, run_id: run, revision: 1, packet: packetJson, packet_hash: HASH, recorded_by: "ai" });
    await ins("paperwork_reviews", { id: rev, run_id: run, revision: 1, decision: "ACCEPT", comment: "ok", request_id: uuid(), recorded_by: owner });
    const pk = (o = {}) => ({ id: uuid(), run_id: run, proposal_id: prop, review_id: rev, packet: packetJson, recorded_by: owner, ...o });
    const good = pk();
    await expectOk("paperwork_packet_guard: accepts exact accepted packet", () => ins("paperwork_packets", good));
    await expectReject("paperwork_packet_guard: rejects altered packet", "Packet requires its exact pending human acceptance", () => ins("paperwork_packets", pk({ packet: { staffNextAction: "Other" } })));
    await expectReject("paperwork_packet_guard: rejects other recorder", "Packet requires its exact pending human acceptance", () => ins("paperwork_packets", pk({ recorded_by: "someone" })));
    {
      const run2 = uuid(), prop2 = uuid(), rev2 = uuid();
      await ins("paperwork_runs", { id: run2, case_id: uuid(), source: {}, source_hash: HASH, status: "PROCESSING", revision: 1, pending_review_id: rev2, recorded_by: owner });
      await ins("paperwork_proposals", { id: prop2, run_id: run2, revision: 1, packet: packetJson, packet_hash: HASH, recorded_by: "ai" });
      await ins("paperwork_reviews", { id: rev2, run_id: run2, revision: 1, decision: "ACCEPT", comment: "ok", request_id: uuid(), recorded_by: owner });
      await expectOk("paperwork_packet_guard: key order does not matter (jsonb semantics)", () => ins("paperwork_packets", pk({ run_id: run2, proposal_id: prop2, review_id: rev2, packet: '{"missing": [], "staffNextAction": "Call the TPA"}' })));
    }
    const fu = (o = {}) => ({ id: uuid(), run_id: run, packet_id: good.id, owner_id: owner, action: "Call the TPA", recorded_by: owner, ...o });
    await expectOk("paperwork_followup_guard: accepts packet owner + staffNextAction", () => ins("paperwork_followups", fu()));
    await expectReject("paperwork_followup_guard: rejects other action", "Follow-up requires its reviewed packet and accountable staff owner", () => ins("paperwork_followups", fu({ action: "Something else" })));
    await expectReject("paperwork_followup_guard: rejects other owner", "Follow-up requires its reviewed packet and accountable staff owner", () => ins("paperwork_followups", fu({ owner_id: "other" })));
  }

  // ===== patient_identification_source =====
  {
    const patient = uuid(); const adm = await episode({ patient }); const deskUser = await staff(sid("desk"), "ADMISSION"); const exc = uuid();
    await ins("patients", { id: patient, uhid: sid("U"), name: "Temp", sex: "FEMALE", registered_by: deskUser, identity_status: "TEMPORARY", identity_provenance: "urgent" });
    await ins("admin_exceptions", { id: exc, admission_id: adm, type: "URGENT_ADMISSION", disposition: "ACTIVATE", authority: "auth", reason: "reason", evidence: "evid", evidence_ids: [], follow_up_owner_id: "x", snapshot: {}, signed_by: "x" });
    const pi = (o = {}) => ({ id: uuid(), patient_id: patient, admission_id: adm, exception_id: exc, version: 1, name: "Real Name", sex: "FEMALE", evidence: "id card", reason: "identified", signed_by: deskUser, date_of_birth: "1990-01-01", ...o });
    await expectOk("patient_identification_source: accepts desk identification v1", () => ins("patient_identifications", pi()));
    await expectReject("patient_identification_source: rejects version gap", "Identity version or date is invalid", () => ins("patient_identifications", pi({ version: 5 })));
    await expectReject("patient_identification_source: rejects future date of birth", "Identity version or date is invalid", () => ins("patient_identifications", pi({ version: 2, date_of_birth: "2999-01-01" })));
    await expectReject("patient_identification_source: rejects non-desk staff", "Attributable admission-desk identification requires original urgent authority", () => ins("patient_identifications", pi({ version: 2, signed_by: admin })));
  }
  // ===== mvp_event_source / mvp_pending_return / mvp_pending_transfer_approval / mvp_document_source =====
  {
    let tick = 0; const tAt = () => ago(900000 - (tick++) * 5000);
    const post = async (adm, action, o = {}) => { const r = await ev(adm, action, { ...o, at: o.at ?? tAt() }); r.review_hash = HASH; await ins("mvp_events", r); return r.id; };
    const A = await episode({ wv: 2 });
    const nA = await mkNurse(A); const pharm = await staff(sid("ph"), "PHARMACY");
    const dp = (o = {}) => ({ authorizerName: "Dr External", evidence: "signed order", sourceTime: iso(ago(3600000)), clinicalSummary: "summary ok", prescription: "rx ok", followUp: "follow ok", ...o });
    await expectReject("mvp_event_source: doctor-approval rejects unassigned actor", "Assigned Nurse records external authority and readiness", () => post(A, "doctor-approval", { by: admin, payload: dp() }));
    await expectReject("mvp_event_source: doctor-approval rejects short authorizer", "Named external Doctor source and actual source time required", () => post(A, "doctor-approval", { by: nA, payload: dp({ authorizerName: "ab" }) }));
    await expectReject("mvp_event_source: doctor-approval rejects missing source time", "Named external Doctor source and actual source time required", () => post(A, "doctor-approval", { by: nA, payload: dp({ sourceTime: undefined }) }));
    await expectReject("mvp_event_source: doctor-approval rejects source time before admission", "Named external Doctor source and actual source time required", () => post(A, "doctor-approval", { by: nA, payload: dp({ sourceTime: iso(ago(86400000 * 10)) }) }));
    await expectReject("mvp_event_source: doctor-approval rejects future source time", "Named external Doctor source and actual source time required", () => post(A, "doctor-approval", { by: nA, payload: dp({ sourceTime: iso(new Date(Date.now() + 3600000)) }) }));
    await expectReject("mvp_event_source: rejects stale bill version", "Current MVP episode, actor and bill source required", () => post(A, "doctor-approval", { by: nA, bill: 7, payload: dp() }));
    const legacy = await episode({ wv: 1 }); const nL = await mkNurse(legacy);
    await expectReject("mvp_event_source: rejects workflow_version 1 episode", "Current MVP episode, actor and bill source required", () => post(legacy, "doctor-approval", { by: nL, payload: dp() }));
    let D;
    await expectOk("mvp_event_source: accepts doctor-approval from assigned Nurse", async () => { D = await post(A, "doctor-approval", { by: nA, payload: dp() }); });
    const cl = (o = {}) => ({ items: ["item one", "item two"], proposedNa: ["PHARMACY", "INSURANCE"], remarks: "remarks ok", ...o });
    await expectReject("mvp_event_source: checklist rejects missing Doctor authorization", "Current external Doctor authorization required", () => post(A, "checklist", { by: nA, payload: cl() }));
    await expectReject("mvp_event_source: checklist rejects non-array items", "Published physical checklist and applicability proposal required", () => post(A, "checklist", { by: nA, clinical: D, payload: cl({ items: "x" }) }));
    await expectReject("mvp_event_source: checklist rejects empty items", "Checklist must retain actual items and optional-only applicability", () => post(A, "checklist", { by: nA, clinical: D, payload: cl({ items: [] }) }));
    await expectReject("mvp_event_source: checklist rejects short item", "Checklist must retain actual items and optional-only applicability", () => post(A, "checklist", { by: nA, clinical: D, payload: cl({ items: ["ok item", "x"] }) }));
    await expectReject("mvp_event_source: checklist rejects mandatory check in proposedNa", "Checklist must retain actual items and optional-only applicability", () => post(A, "checklist", { by: nA, clinical: D, payload: cl({ proposedNa: ["NURSING"] }) }));
    let C;
    await expectOk("mvp_event_source: accepts checklist bound to current Doctor authorization", async () => { C = await post(A, "checklist", { by: nA, clinical: D, payload: cl() }); });
    const chk = (key, status, by, payload = { remarks: "department remark" }, o = {}) => post(A, "check", { by, clinical: D, checklist: C, check_key: key, status, payload, ...o });
    await expectReject("mvp_event_source: check rejects missing published checklist", "Current published checklist required", () => post(A, "check", { by: pharm, clinical: D, check_key: "PHARMACY", status: "COMPLETE", payload: { remarks: "department remark" } }));
    await expectReject("mvp_event_source: check PHARMACY rejects non-Pharmacy actor", "Current responsible department actor required", () => chk("PHARMACY", "COMPLETE", admin));
    await expectReject("mvp_event_source: check INSURANCE rejects Insurance staff not assigned to case", "Current responsible department actor required", async () => chk("INSURANCE", "COMPLETE", await staff(sid("in"), "INSURANCE")));
    await expectReject("mvp_event_source: check rejects missing remarks", "Attributed department remarks required", () => chk("PHARMACY", "COMPLETE", pharm, { remarks: "x" }));
    await expectReject("mvp_event_source: check rejects unknown status", "Valid attributed department status required", () => chk("PHARMACY", "DONE", pharm));
    await expectReject("mvp_event_source: DIAGNOSTICS complete needs named confirmation", "Named external diagnostic confirmation required; Nurse is recorder", () => chk("DIAGNOSTICS", "COMPLETE", nA));
    await expectOk("mvp_event_source: accepts DIAGNOSTICS complete with named confirmer, evidence, source time", () => chk("DIAGNOSTICS", "COMPLETE", nA, { remarks: "lab done", confirmerName: "Dr Lab", evidence: "lab sheet", sourceTime: iso(ago(7200000)) }));
    await expectOk("mvp_event_source: accepts NURSING check from assigned Nurse", () => chk("NURSING", "COMPLETE", nA));
    await expectOk("mvp_event_source: accepts PHARMACY check from Pharmacy", () => chk("PHARMACY", "COMPLETE", pharm));
    const na = (key, by, payload = { reason: "no relevant work" }) => post(A, "n-a", { by, clinical: D, checklist: C, check_key: key, status: "NA", payload });
    await expectReject("mvp_event_source: n-a rejects non-Admin", "Admin confirms optional applicability", () => na("PHARMACY", nA));
    await expectReject("mvp_event_source: n-a rejects check not proposed by Nurse", "Optional N/A needs Nurse proposal, Admin reason and absence of relevant work", () => na("DIAGNOSTICS", admin));
    await expectReject("mvp_event_source: n-a INSURANCE rejects insured admission with a case", "Optional N/A needs Nurse proposal, Admin reason and absence of relevant work", async () => { await ins("insurance_cases", { admission_id: A, recorded_by: "x" }); return na("INSURANCE", admin); });
    await expectOk("mvp_event_source: accepts n-a for proposed optional check after COMPLETE", () => na("PHARMACY", admin));
    await expectReject("mvp_event_source: n-a PHARMACY rejects when medicine charges exist", "Optional N/A needs Nurse proposal, Admin reason and absence of relevant work", async () => {
      await ins("charges", { admission_id: A, source_event_id: sid("c"), source_payload: "{}", category: "medicine", item_id: "m", description: "d", quantity: "1", unit: "u", tariff_version_id: uuid(), rate_paise: 1, amount_paise: 1, initial_status: "FINAL", actor_type: "staff", actor_id: "x" });
      return na("PHARMACY", admin);
    });
    await expectReject("mvp_event_source: finance rejects non Admin/Billing", "Admin or Billing final financial authority required", () => post(A, "finance", { by: nA, clinical: D, checklist: C, payload: {} }));
    const doc = uuid(); const dsnap = { schemaVersion: 2, kind: "CLINICAL", clinical: { id: D } };
    await without(["mvp_document_source", "mvp_exception_document"], () => ins("discharge_documents", { id: doc, admission_id: A, version: 1, source_hash: HASH, hash: HASH, snapshot: dsnap, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(ago(3600000)), schema_version: 2, kind: "CLINICAL" }));
    const dl = (o = {}) => ({ kind: "CLINICAL", documentId: doc, documentHash: HASH, documentVersion: 1, deliveredAt: iso(ago(1800000)), recipient: "Patient kin", evidence: "signed ack", ...o });
    await expectReject("mvp_event_source: deliver rejects other staff", "Assigned Nurse or Admin delivers papers", () => post(A, "deliver", { by: pharm, clinical: D, payload: dl() }));
    await expectReject("mvp_event_source: deliver rejects wrong document hash", "Exact current authorized document delivery required", () => post(A, "deliver", { by: admin, clinical: D, payload: dl({ documentHash: "b".repeat(64) }) }));
    await expectReject("mvp_event_source: deliver rejects delivery before document creation", "Exact current authorized document delivery required", () => post(A, "deliver", { by: admin, clinical: D, payload: dl({ deliveredAt: iso(ago(7200000)) }) }));
    await expectReject("mvp_event_source: deliver rejects future delivery", "Exact current authorized document delivery required", () => post(A, "deliver", { by: admin, clinical: D, payload: dl({ deliveredAt: iso(new Date(Date.now() + 3600000)) }) }));
    await expectOk("mvp_event_source: accepts exact CLINICAL paper delivery by Admin", () => post(A, "deliver", { by: admin, clinical: D, payload: dl() }));

    // pending return: an unperformed RETURN_TO_BED instruction blocks Doctor approval
    const R = await episode({ wv: 2 }); const nR = await mkNurse(R);
    await mkXe(R, "CLINICAL", "RETURN_TO_BED", { payload: { sourceTime: iso(ago(7200000)) } });
    await expectReject("mvp_pending_return: rejects approval while return instruction is unperformed", "External return instruction needs actual return or explicit source-bound reconsideration", () => post(R, "doctor-approval", { by: nR, payload: dp() }));
    // pending transfer: current uncancelled, unperformed transfer instruction blocks approval
    const T = await episode({ wv: 2 }); const nT = await mkNurse(T);
    const authT = uuid();
    await without(["mvp_transfer_authority_source"], () => ins("mvp_transfer_authorities", { id: authT, admission_id: T, source_stay_id: uuid(), external_doctor_id: uuid(), authorizer_name: "Dr Ext", source_time: dt(ago(7200000)), destination_category: "ICU", evidence: "evidence", reason: "reason", version: 1, admission_version: 1, recorded_by: nT, recorded_at: dt(ago(7000000)) }));
    await expectReject("mvp_pending_transfer_approval: rejects approval while transfer instruction is unresolved", "Resolve the current external transfer instruction before recording discharge approval", () => post(T, "doctor-approval", { by: nT, payload: dp() }));
    await without(["mvp_transfer_cancellation_source"], () => ins("mvp_transfer_cancellations", { admission_id: T, authority_id: authT, external_doctor_id: uuid(), authorizer_name: "Dr Ext", source_time: dt(ago(6000000)), evidence: "evidence", reason: "reason", recorded_by: nT, recorded_at: dt(ago(5900000)) }));
    await expectOk("mvp_pending_transfer_approval: accepts approval after cancellation", () => post(T, "doctor-approval", { by: nT, payload: dp() }));

    // mvp_document_source
    const DS = await episode({ wv: 2 }); const nD = await mkNurse(DS);
    const DD = await mkEv(DS, "doctor-approval", { by: nD, payload: dp() });
    const mkDoc = (o = {}, snap = {}) => { const id = o.id ?? uuid(); const created = o.created_at ?? ago(60000); return { id, admission_id: DS, version: 1, source_hash: HASH, hash: HASH, snapshot: { schemaVersion: 2, kind: "CLINICAL", clinical: { id: DD }, admission: { id: DS }, documentId: id, version: o.version ?? 1, sourceHash: HASH, createdAt: iso(created), ...snap }, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(created), schema_version: 2, kind: "CLINICAL", ...o }; };
    await expectOk("mvp_document_source: accepts exact authorized v2 clinical paper", () => ins("discharge_documents", mkDoc()));
    await expectReject("mvp_document_source: rejects altered source hash", "Exact immutable authorized MVP paper sources required", () => ins("discharge_documents", mkDoc({ version: 2 }, { sourceHash: "zzz" })));
    await expectReject("mvp_document_source: rejects missing predecessor link", "Exact immutable authorized MVP paper sources required", () => ins("discharge_documents", mkDoc({ version: 2 })));
    await expectReject("mvp_document_source: rejects unauthorized staff", "Current authorized document staff required", async () => ins("discharge_documents", mkDoc({ version: 2, created_by: await staff(sid("ph"), "PHARMACY") })));
    const L1 = await episode({ wv: 1 }); const L2 = await episode({ wv: 2 });
    const legacyDoc = (adm) => ({ id: uuid(), admission_id: adm, version: 1, source_hash: HASH, hash: HASH, snapshot: {}, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(ago(1000)), schema_version: 1, kind: "FINAL" });
    await expectOk("mvp_document_source: accepts schema 1 document on legacy episode", () => ins("discharge_documents", legacyDoc(L1)));
    await expectReject("mvp_document_source: rejects schema 1 document on MVP episode", "MVP documents require explicit provenance schema", () => ins("discharge_documents", legacyDoc(L2)));
  }
  // ===== shared physical fixtures =====
  const mkBed = async (category = "GEN", active = 1) => { const id = uuid(); await ins("beds", { id, label: sid("bed"), category, category_version_id: uuid(), active }); return id; };
  const mkStay = async (adm, bed, started, ended = null, o = {}) => { const id = uuid(); await ins("room_stays", { id, admission_id: adm, bed_id: bed, tariff_version_id: o.tariff ?? uuid(), started_at: dt(started), ended_at: ended ? dt(ended) : null, last_reconciled_at: o.reconciled === undefined ? (ended ? dt(ended) : null) : o.reconciled }); return id; };
  const hold = (adm, bed, at = ago(86400000)) => ins("bed_holds", { bed_id: bed, admission_id: adm, held_at: dt(at) });
  const mkVacation = (adm, stay, shift, at, o = {}) => without(["mvp_exception_vacancy", "mvp_physical_vacancy"], () => ins("room_vacations", { id: o.id ?? uuid(), admission_id: adm, stay_id: stay, shift_id: shift, vacated_at: dt(at), waiting_location: "corridor", handover: "handover ok", signed_by: o.by ?? "x", signed_at: dt(o.signed ?? at), nursing_seal_id: o.seal ?? null, mvp_readiness_id: o.readiness ?? null, mvp_exception_id: o.exc ?? null }));
  const respOf = async (adm) => { const [[r]] = await q("SELECT mvp_current_responsibility(?) j", [adm]); return JSON.parse(r.j); };

  // ===== mvp_exception_source (guard_mvp_exception) =====
  {
    const X = await episode({ wv: 2 }); const nX = await mkNurse(X);
    const xp = (o = {}) => ({ authorizerName: "Dr External", evidence: "signed note", sourceTime: iso(ago(7200000)), notes: "notes ok", ...o });
    const postX = async (adm, action, type, o = {}) => { const r = { id: uuid(), admission_id: adm, action, type, source_id: o.source ?? null, payload: o.payload ?? {}, bill_version: o.bill ?? 1, recorded_by: o.by, ...(o.at ? { recorded_at: dt(o.at) } : {}) }; await ins("mvp_exception_events", r); return r.id; };
    await expectReject("mvp_exception_source: CLINICAL rejects unassigned actor", "Assigned Nurse records external clinical authority and factual vacancy", () => postX(X, "CLINICAL", "PLANNED_EXIT", { by: admin, payload: xp() }));
    await expectReject("mvp_exception_source: CLINICAL rejects unknown type", "Named external clinical authorizer, source evidence and actual source time required", () => postX(X, "CLINICAL", "NOPE", { by: nX, payload: xp() }));
    await expectReject("mvp_exception_source: CLINICAL rejects future source time", "Named external clinical authorizer, source evidence and actual source time required", () => postX(X, "CLINICAL", "PLANNED_EXIT", { by: nX, payload: xp({ sourceTime: iso(new Date(Date.now() + 3600000)) }) }));
    await expectReject("mvp_exception_source: rejects stale bill version", "Current source-bound MVP exception actor and bill required", () => postX(X, "CLINICAL", "PLANNED_EXIT", { by: nX, bill: 4, payload: xp() }));
    let CL1;
    await expectOk("mvp_exception_source: accepts CLINICAL PLANNED_EXIT from assigned Nurse", async () => { CL1 = await postX(X, "CLINICAL", "PLANNED_EXIT", { by: nX, payload: xp() }); });
    await expectReject("mvp_exception_source: RETURN_CANCELLED must bind a RETURN_TO_BED source", "External reconsideration binds the original return instruction", () => postX(X, "CLINICAL", "RETURN_CANCELLED", { by: nX, source: CL1, payload: xp() }));
    await expectReject("mvp_exception_source: RETURN_TO_BED needs a current vacancy", "Return instruction binds the current actual vacancy", () => postX(X, "CLINICAL", "RETURN_TO_BED", { by: nX, source: uuid(), payload: xp() }));
    const ap = async (adm, o = {}) => ({ authority: "Medical Superintendent", reason: "documented reason", evidence: "signed form", followUpOwnerId: admin, bill: { revision: 1, netPaise: 0, patientCashPaise: 0, insurerCashPaise: 0, refundedPaise: 0 }, financial: await respOf(adm), ...o });
    await expectReject("mvp_exception_source: AUTHORITY rejects non-Admin", "Admin exception authority required", async () => postX(X, "AUTHORITY", "CREDIT", { by: nX, source: CL1, payload: await ap(X) }));
    await expectReject("mvp_exception_source: AUTHORITY rejects wrong clinical source type", "Explicit accountable Admin authority preserves exact clinical source, money and follow-up obligations", async () => postX(X, "AUTHORITY", "AGAINST_ADVICE", { by: admin, source: CL1, payload: await ap(X) }));
    await expectReject("mvp_exception_source: AUTHORITY rejects unknown follow-up owner", "Explicit accountable Admin authority preserves exact clinical source, money and follow-up obligations", async () => postX(X, "AUTHORITY", "CREDIT", { by: admin, source: CL1, payload: await ap(X, { followUpOwnerId: "ghost" }) }));
    await expectReject("mvp_exception_source: AUTHORITY cannot replace ledger amounts", "Exception authority cannot erase or replace actual ledger amounts", async () => postX(X, "AUTHORITY", "CREDIT", { by: admin, source: CL1, payload: await ap(X, { bill: { revision: 1, netPaise: 5, patientCashPaise: 0, insurerCashPaise: 0, refundedPaise: 0 } }) }));
    await expectReject("mvp_exception_source: AUTHORITY must retain current party allocation", "Exception authority must retain the current verified party allocation and exact source", async () => { const f = await respOf(X); f.caseId = uuid(); return postX(X, "AUTHORITY", "CREDIT", { by: admin, source: CL1, payload: await ap(X, { financial: f }) }); });
    await expectReject("mvp_exception_source: INSURANCE_DELAY needs an insured admission with its case", "Exact external insurance case required", async () => postX(X, "AUTHORITY", "INSURANCE_DELAY", { by: admin, source: CL1, payload: await ap(X, { sourceId: uuid() }) }));
    let AU;
    await expectOk("mvp_exception_source: accepts AUTHORITY CREDIT with exact source, money and follow-up", async () => { AU = await postX(X, "AUTHORITY", "CREDIT", { by: admin, source: CL1, payload: await ap(X) }); });
    await expectOk("mvp_exception_source: AUTHORITY payload gains outstandingObligations", async () => {
      const [[r]] = await q("SELECT payload p FROM mvp_exception_events WHERE id=?", [AU]); const o = (typeof r.p === "string" ? JSON.parse(r.p) : r.p).outstandingObligations;
      if (!Array.isArray(o) || !o.includes("Actual room vacancy and final room-charge cutoff remain outstanding") || !o.includes("Ordinary approval remains absent: finance") || !o.includes("Ordinary approval remains absent: doctor-approval")) throw new Error("obligations: " + JSON.stringify(o));
    });
    await expectReject("mvp_exception_source: FOLLOWUP rejects non-Admin", "Admin exception authority required", () => postX(X, "FOLLOWUP", "CREDIT", { by: nX, source: AU, payload: { ownerId: admin, note: "follow up" } }));
    await expectReject("mvp_exception_source: FOLLOWUP rejects unknown owner", "Original exception and named follow-up owner required", () => postX(X, "FOLLOWUP", "CREDIT", { by: admin, source: AU, payload: { ownerId: "ghost", note: "follow up" } }));
    await expectReject("mvp_exception_source: FOLLOWUP must bind an AUTHORITY", "Original exception and named follow-up owner required", () => postX(X, "FOLLOWUP", "CREDIT", { by: admin, source: CL1, payload: { ownerId: admin, note: "follow up" } }));
    await expectOk("mvp_exception_source: accepts FOLLOWUP by Admin for named owner", () => postX(X, "FOLLOWUP", "CREDIT", { by: admin, source: AU, payload: { ownerId: admin, note: "follow up" } }));
    const vac = (o = {}) => ({ vacatedAt: iso(ago(3600000)), stayId: uuid(), shiftId: uuid(), waitingLocation: "corridor", handover: "handover ok", ...o });
    await expectReject("mvp_exception_source: VACANCY rejects missing stay", "External exit disposition and factual Nurse vacancy required", () => postX(X, "VACANCY", "PLANNED_EXIT", { by: nX, source: CL1, payload: vac({ stayId: undefined }) }));
    await expectReject("mvp_exception_source: VACANCY rejects vacancy before admission", "External exit disposition and factual Nurse vacancy required", () => postX(X, "VACANCY", "PLANNED_EXIT", { by: nX, source: CL1, payload: vac({ vacatedAt: iso(ago(86400000 * 20)) }) }));
    await expectOk("mvp_exception_source: accepts VACANCY by assigned Nurse bound to CLINICAL source", () => postX(X, "VACANCY", "PLANNED_EXIT", { by: nX, source: CL1, payload: vac() }));
    const xdoc = (o = {}) => { const id = uuid(); return { id, admission_id: X, version: 1, source_hash: HASH, hash: HASH, snapshot: { exception: { id: AU }, ...o }, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(ago(1800000)), schema_version: 2, kind: "FINAL" }; };
    const dd = xdoc(); await without(["mvp_document_source", "mvp_exception_document"], () => ins("discharge_documents", dd));
    const dp2 = (o = {}) => ({ documentId: dd.id, documentHash: HASH, deliveredAt: iso(ago(900000)), ...o });
    await expectReject("mvp_exception_source: DELIVERY rejects other documents hash", "Exact current exceptional paper version and actual delivery required", () => postX(X, "DELIVERY", "CREDIT", { by: admin, source: AU, payload: dp2({ documentHash: "c".repeat(64) }) }));
    await expectReject("mvp_exception_source: DELIVERY rejects delivery before paper creation", "Exact current exceptional paper version and actual delivery required", () => postX(X, "DELIVERY", "CREDIT", { by: admin, source: AU, payload: dp2({ deliveredAt: iso(ago(7200000)) }) }));
    await expectReject("mvp_exception_source: DELIVERY rejects delivery by unassigned staff", "Assigned Nurse or Admin delivers authorized papers", async () => postX(X, "DELIVERY", "CREDIT", { by: await staff(sid("ph"), "PHARMACY"), source: AU, payload: dp2() }));
    await expectOk("mvp_exception_source: accepts DELIVERY of exact exceptional paper", () => postX(X, "DELIVERY", "CREDIT", { by: admin, source: AU, payload: dp2() }));

    // mvp_exception_document
    const doc2 = (o = {}, snap = {}) => { const id = uuid(); return { id, admission_id: X, version: 2, replaces_document_id: dd.id, source_hash: HASH, hash: HASH, snapshot: { exception: { id: AU }, clinical: { id: CL1 }, documentId: id, version: 2, sourceHash: HASH, kind: "FINAL", ...snap }, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(ago(600000)), schema_version: 2, kind: "FINAL", ...o }; };
    await expectReject("mvp_exception_document: rejects other clinical source", "Exact source-bound exceptional paper authority required", () => ins("discharge_documents", doc2({}, { clinical: { id: uuid() } })));
    await expectReject("mvp_exception_document: rejects schema 1", "Exact source-bound exceptional paper authority required", () => ins("discharge_documents", doc2({ schema_version: 1 })));
    await expectReject("mvp_exception_document: rejects broken predecessor", "Immutable document predecessor required", () => ins("discharge_documents", doc2({ replaces_document_id: null })));
    await expectOk("mvp_exception_document: accepts exact source-bound exceptional paper", () => ins("discharge_documents", doc2()));
  }
  // ===== mvp_exception_vacancy / mvp_exception_return / mvp_exception_departure (guard_mvp_exception_physical) =====
  const xPost = async (adm, action, type, o = {}) => { const r = { id: uuid(), admission_id: adm, action, type, source_id: o.source ?? null, payload: o.payload ?? {}, bill_version: o.bill ?? 1, recorded_by: o.by }; await ins("mvp_exception_events", r); return r.id; };
  const xAuth = async (adm, type, source, by) => xPost(adm, "AUTHORITY", type, { by, source, payload: { authority: "Medical Superintendent", reason: "documented reason", evidence: "signed form", followUpOwnerId: admin, bill: { revision: 1, netPaise: 0, patientCashPaise: 0, insurerCashPaise: 0, refundedPaise: 0 }, financial: await respOf(adm) } });
  const xp2 = (o = {}) => ({ authorizerName: "Dr External", evidence: "signed note", sourceTime: iso(ago(14400000)), notes: "notes ok", ...o });
  {
    // vacancy: witness VACANCY event, closed stay, same-Nurse shift
    const V = await episode({ wv: 2 }); const nV = await mkNurse(V); const nV2 = await mkNurse(V); const bed = await mkBed(); await hold(V, bed);
    const shift = await shiftFor(V, nV, ago(86400000)); const shift2 = await shiftFor(V, nV2, ago(86400000));
    const MV = ago(10800000); const stay = await mkStay(V, bed, ago(86400000 * 2), MV);
    const cl = await xPost(V, "CLINICAL", "PLANNED_EXIT", { by: nV, payload: xp2() });
    const witness = async (by, o = {}) => xPost(V, "VACANCY", "PLANNED_EXIT", { by, source: cl, payload: { vacatedAt: iso(MV), stayId: stay, shiftId: shift, waitingLocation: "corridor", handover: "handover ok", ...o } });
    const w1 = await witness(nV); const w2 = await witness(nV2); const w3 = await witness(nV, { vacatedAt: iso(new Date(MV.getTime() + 1000)) });
    const rv = (witnessId, o = {}) => ({ admission_id: V, stay_id: stay, shift_id: shift, vacated_at: dt(MV), waiting_location: "corridor", handover: "handover ok", signed_by: nV, mvp_exception_id: witnessId, ...o });
    await expectReject("mvp_exception_vacancy: rejects vacancy time differing from witness", "Exact exceptional physical vacancy source required", () => ins("room_vacations", rv(w3)));
    await expectReject("mvp_exception_vacancy: rejects witness recorded by another Nurse", "Exact exceptional physical vacancy source required", () => ins("room_vacations", rv(w2)));
    await expectReject("mvp_exception_vacancy: rejects readiness mixed with exception", "Exact exceptional physical vacancy source required", () => ins("room_vacations", rv(w1, { mvp_readiness_id: uuid() })));
    await expectReject("mvp_exception_vacancy: rejects Nurse with no matching shift", "Actual assigned-Nurse vacancy attendance required", () => ins("room_vacations", rv(w2, { signed_by: nV2 })));
    await expectOk("mvp_exception_vacancy: accepts exact exceptional vacancy with same-Nurse shift", () => ins("room_vacations", rv(w1)));

    // return: RETURN_TO_BED chain, then the actual room return
    const P = await episode({ wv: 2 }); const nP = await mkNurse(P); const bedP = await mkBed(); await hold(P, bedP);
    const shiftP = await shiftFor(P, nP, ago(86400000)); const VAC = uuid(); const VT = ago(18000000);
    const stayP1 = await mkStay(P, bedP, ago(86400000 * 2), VT); await mkVacation(P, stayP1, shiftP, VT, { id: VAC, by: nP });
    let RB1, RB3, AUTH;
    await expectOk("mvp_exception_source: accepts RETURN_TO_BED bound to the current actual vacancy", async () => { RB1 = await xPost(P, "CLINICAL", "RETURN_TO_BED", { by: nP, source: VAC, payload: xp2() }); });
    await expectReject("mvp_exception_source: rejects second unperformed RETURN_TO_BED for the same vacancy", "One unperformed return instruction per current vacancy", () => xPost(P, "CLINICAL", "RETURN_TO_BED", { by: nP, source: VAC, payload: xp2() }));
    await expectReject("mvp_exception_source: rejects reconsideration time before the original instruction", "External reconsideration binds the original return instruction", () => xPost(P, "CLINICAL", "RETURN_CANCELLED", { by: nP, source: RB1, payload: xp2({ sourceTime: iso(ago(86400000)) }) }));
    await expectOk("mvp_exception_source: accepts RETURN_CANCELLED reconsideration", () => xPost(P, "CLINICAL", "RETURN_CANCELLED", { by: nP, source: RB1, payload: xp2({ sourceTime: iso(ago(10800000)) }) }));
    await expectReject("mvp_exception_source: rejects reconsidering an already cancelled return", "Only current unperformed and uncancelled return authority may be reconsidered", () => xPost(P, "CLINICAL", "RETURN_CANCELLED", { by: nP, source: RB1, payload: xp2({ sourceTime: iso(ago(7200000)) }) }));
    await expectOk("mvp_exception_source: accepts a fresh RETURN_TO_BED after cancellation", async () => { RB3 = await xPost(P, "CLINICAL", "RETURN_TO_BED", { by: nP, source: VAC, payload: xp2({ sourceTime: iso(ago(7200000)) }) }); });
    await expectOk("mvp_exception_source: accepts AUTHORITY RETURN_TO_BED", async () => { AUTH = await xAuth(P, "RETURN_TO_BED", RB3, admin); });
    const [[{ ar }]] = await q("SELECT recorded_at ar FROM mvp_exception_events WHERE id=?", [AUTH]).then(([r]) => [r]);
    const MR = new Date(new Date(ar.replace(" ", "T") + "Z").getTime() + 5); // a moment at/after the authority and before now
    const stayP2 = await mkStay(P, bedP, MR, null, { reconciled: null });
    const rr = (o = {}) => ({ admission_id: P, vacation_id: VAC, authority_id: AUTH, clinical_id: RB3, stay_id: stayP2, shift_id: shiftP, returned_at: dt(MR), handover: "handover ok", recorded_by: nP, ...o });
    await expectReject("mvp_exception_return: rejects unassigned Nurse", "Assigned Nurse actual movement needs exact external clinical and Admin authority", async () => ins("mvp_room_returns", rr({ recorded_by: await staff(sid("n"), "NURSE") })));
    await expectReject("mvp_exception_return: rejects older clinical instruction", "Assigned Nurse actual movement needs exact external clinical and Admin authority", () => ins("mvp_room_returns", rr({ clinical_id: RB1 })));
    await expectReject("mvp_exception_return: rejects return into bed without original hold", "Original bed hold required", async () => { const nb = await mkBed(); const st = await mkStay(P, nb, MR, null); return ins("mvp_room_returns", rr({ stay_id: st })); });
    await expectReject("mvp_exception_return: rejects fresh stay not starting at return time", "Fresh returned stay requires current original instruction and completed turnover", async () => { const st = await mkStay(P, bedP, new Date(MR.getTime() - 1000), null); return ins("mvp_room_returns", rr({ stay_id: st })); });
    await expectReject("mvp_exception_return: rejects incomplete bed turnover", "Fresh returned stay requires current original instruction and completed turnover", async () => { await ins("bed_turnovers", { bed_id: bedP, stay_id: stayP1, admission_id: P, vacated_at: dt(VT), reason: "turnover", signed_by: nP }); try { return await ins("mvp_room_returns", rr()); } finally { await q("DELETE FROM bed_turnovers WHERE stay_id=?", [stayP1]); } });
    await expectOk("mvp_exception_return: accepts exact room return", () => ins("mvp_room_returns", rr()));

    // departure
    const Q = await episode({ wv: 2 }); const nQ = await mkNurse(Q); const bedQ = await mkBed(); await hold(Q, bedQ);
    const shiftQ = await shiftFor(Q, nQ, ago(86400000)); const VQ = ago(10800000);
    const stayQ = await mkStay(Q, bedQ, ago(86400000 * 2), VQ); await mkVacation(Q, stayQ, shiftQ, VQ, { by: nQ });
    const clQ = await xPost(Q, "CLINICAL", "AGAINST_ADVICE", { by: nQ, payload: xp2() });
    const authQ = await xAuth(Q, "AGAINST_ADVICE", clQ, admin);
    const MQ = ago(1800000);
    const dep = (o = {}) => ({ admission_id: Q, authority_id: authQ, clinical_id: clQ, stay_id: stayQ, shift_id: shiftQ, departed_at: dt(MQ), snapshot: { authority: { id: authQ }, bill: { revision: 1 } }, recorded_by: nQ, ...o });
    await expectReject("mvp_exception_departure: rejects snapshot bound to another authority", "Exact exceptional obligations, actual vacancy and planned paper delivery required", () => ins("mvp_exceptional_departures", dep({ snapshot: { authority: { id: uuid() }, bill: { revision: 1 } } })));
    await expectReject("mvp_exception_departure: rejects departure before the actual vacancy", "Exact exceptional obligations, actual vacancy and planned paper delivery required", () => ins("mvp_exceptional_departures", dep({ departed_at: dt(ago(14400000)) })));
    await expectOk("mvp_exception_departure: accepts exact exceptional departure", async () => { await ins("mvp_exceptional_departures", dep()); });
  }
  // ===== mvp_external_source =====
  {
    const hospital = uuid(); const X = await episode({ wv: 2, hospital }); const billing = await staff(sid("bill"), "BILLING"); const rate = uuid();
    await ins("setting_versions", { id: rate, hospital_id: hospital, kind: "tariff", version: 1, payload: { type: "billable-item", code: "CONS1", active: true, category: "consultation", department: "DOCTOR", unit: "visit", quantityScale: 0, name: "Consultation", amount: 500 }, actor_type: "staff", actor_id: "x", reason: "seed" });
    const svc = async (o = {}, c = {}) => {
      const id = uuid(); const chargeId = uuid(); const quantity = o.quantity ?? "1";
      await ins("charges", { id: chargeId, admission_id: X, source_event_id: id, source_payload: "{}", category: "consultation", item_id: "CONS1", description: "Consultation", quantity, unit: "visit", tariff_version_id: rate, rate_paise: 500, amount_paise: 500, initial_status: "FINAL", actor_type: "staff", actor_id: billing, ...c });
      return { id, admission_id: X, charge_id: chargeId, category: "consultation", item_id: "CONS1", quantity, unit: "visit", tariff_version_id: rate, performed_at: dt(ago(3600000)), department_issuer: "Cardiology dept", external_bill_reference: "BILL-1", external_line_reference: "L-1", evidence: "issuer bill line", recorded_by: billing, recorder_name: `Name ${billing}`, recorded_at: dt(ago(1800000)), ...o };
    };
    await expectOk("mvp_external_source: accepts exact external performed service", async () => ins("mvp_external_services", await svc()));
    await expectReject("mvp_external_source: rejects non-Admin/Billing recorder", "Current Admin/Billing recorder, actual performed-service time and external issuer bill-line evidence required", async () => { const ph = await staff(sid("ph"), "PHARMACY"); return ins("mvp_external_services", await svc({ recorded_by: ph, recorder_name: `Name ${ph}` })); });
    await expectReject("mvp_external_source: rejects future performed time", "Current Admin/Billing recorder, actual performed-service time and external issuer bill-line evidence required", async () => ins("mvp_external_services", await svc({ performed_at: dt(new Date(Date.now() + 3600000)), recorded_at: dt(new Date(Date.now() + 3700000)) })));
    await expectReject("mvp_external_source: rejects short issuer", "Current Admin/Billing recorder, actual performed-service time and external issuer bill-line evidence required", async () => ins("mvp_external_services", await svc({ department_issuer: "ab" })));
    await expectReject("mvp_external_source: rejects unit different from configured item", "External billing source must pin the current active configured department item and quantity unit", async () => ins("mvp_external_services", await svc({ unit: "hour" })));
    await expectReject("mvp_external_source: rejects malformed quantity", "External billing source must pin the current active configured department item and quantity unit", async () => ins("mvp_external_services", await svc({ quantity: "1.\n" })));
    await expectReject("mvp_external_source: rejects quantity finer than configured scale", "External performed-service charge must match its exact immutable source and deterministic configured rate", async () => ins("mvp_external_services", await svc({ quantity: "1.5" })));
    await expectReject("mvp_external_source: rejects charge with other amount", "External performed-service charge must match its exact immutable source and deterministic configured rate", async () => ins("mvp_external_services", await svc({}, { amount_paise: 400 })));
    await expectReject("mvp_external_source: rejects charge recorded by another actor", "External performed-service charge must match its exact immutable source and deterministic configured rate", async () => ins("mvp_external_services", await svc({}, { actor_id: "someone" })));
    await expectReject("mvp_external_source: rejects PENDING charge", "External performed-service charge must match its exact immutable source and deterministic configured rate", async () => ins("mvp_external_services", await svc({}, { initial_status: "PENDING" })));
  }

  // ===== mvp_medicine_source =====
  {
    const M = await episode({ wv: 2 }); const pharm = await staff(sid("ph"), "PHARMACY");
    const mk = async (qty = "2", o = {}) => { const s = uuid(), c = uuid(); await ins("charges", { id: c, admission_id: M, source_event_id: s, source_payload: "{}", category: "medicine", item_id: "m", description: "Med", quantity: qty, unit: "tab", tariff_version_id: uuid(), rate_paise: 500, amount_paise: 500 * Number(qty), initial_status: "FINAL", actor_type: "staff", actor_id: pharm, ...o }); return { s, c }; };
    const src = (s, c, o = {}) => ({ id: s, admission_id: M, kind: "CHARGE", charge_id: c, quantity: "2", quantity_scale: 0, evidence: "evidence ok", reference: sid("ref"), recorded_by: pharm, ...o });
    { const { s, c } = await mk(); await expectOk("mvp_medicine_source: accepts exact CHARGE source", () => ins("mvp_medicine_sources", src(s, c))); }
    { const { s, c } = await mk(); await expectReject("mvp_medicine_source: rejects non-Pharmacy actor", "Current Pharmacy actor and active MVP admission required", () => ins("mvp_medicine_sources", src(s, c, { recorded_by: admin }))); }
    { const { s, c } = await mk(); await expectReject("mvp_medicine_source: rejects CHARGE quantity differing from charge", "Medicine charge must bind its unique source", () => ins("mvp_medicine_sources", src(s, c, { quantity: "3" }))); }
    { const { s, c } = await mk(); await expectReject("mvp_medicine_source: rejects source id not bound to charge", "Medicine charge must bind its unique source", () => ins("mvp_medicine_sources", src(uuid(), c))); }
    { const { s, c } = await mk("2", { category: "lab" }); await expectReject("mvp_medicine_source: rejects non-medicine charge", "Exact original patient medicine charge required", () => ins("mvp_medicine_sources", src(s, c))); }
    { const { s, c } = await mk(); await expectReject("mvp_medicine_source: rejects quantity finer than scale", "Exact original patient medicine charge required", () => ins("mvp_medicine_sources", src(s, c, { quantity: "2.5" }))); }
    {
      const { s, c } = await mk(); await ins("mvp_medicine_sources", src(s, c));
      const rev = async (amount) => { const id = uuid(); await ins("charge_reversals", { id, charge_id: c, amount_paise: amount, reason: "return", actor_type: "staff", actor_id: pharm }); return id; };
      const ret = (reversal, qty, o = {}) => ({ id: uuid(), admission_id: M, kind: "RETURN", original_id: s, charge_id: c, reversal_id: reversal, quantity: qty, quantity_scale: 0, evidence: "evidence ok", reference: sid("ref"), recorded_by: pharm, ...o });
      await expectReject("mvp_medicine_source: rejects return credit different from original price", "Accepted return exceeds original quantity or exact original-price credit", async () => ins("mvp_medicine_sources", ret(await rev(400), "1")));
      await expectReject("mvp_medicine_source: rejects return above original quantity", "Accepted return exceeds original quantity or exact original-price credit", async () => ins("mvp_medicine_sources", ret(await rev(1500), "3")));
      await expectOk("mvp_medicine_source: accepts return with exact original-price credit", async () => ins("mvp_medicine_sources", ret(await rev(500), "1")));
      await expectReject("mvp_medicine_source: rejects a second return beyond the remaining quantity", "Accepted return exceeds original quantity or exact original-price credit", async () => ins("mvp_medicine_sources", ret(await rev(1000), "2")));
    }
  }

  // ===== mvp_legacy_seal / mvp_physical_vacancy / mvp_physical_departure =====
  {
    const L1 = await episode({ wv: 1 }); const L2 = await episode({ wv: 2 });
    const seal = (adm) => ({ admission_id: adm, gate: "NURSING", role: "NURSE", review_hash: HASH, bill_version: null, inputs: {}, reason: "legacy seal", signed_by: admin });
    await expectOk("mvp_legacy_seal: accepts legacy seal on version 1 episode", () => ins("clearance_seals", seal(L1)));
    await expectReject("mvp_legacy_seal: rejects professional seal on MVP episode", "Legacy professional seals cannot impersonate external MVP authority", () => ins("clearance_seals", seal(L2)));

    // legacy vacancy / departure
    const lv = (o = {}) => ({ admission_id: L1, stay_id: uuid(), shift_id: uuid(), vacated_at: dt(ago(60000)), waiting_location: "corridor", handover: "handover ok", signed_by: admin, nursing_seal_id: uuid(), ...o });
    await expectOk("mvp_physical_vacancy: accepts legacy vacancy with Nursing seal", () => ins("room_vacations", lv()));
    await expectReject("mvp_physical_vacancy: rejects legacy vacancy without Nursing seal", "Legacy Nursing source required", () => ins("room_vacations", lv({ nursing_seal_id: null })));
    const ld = (o = {}) => ({ admission_id: L1, stay_id: uuid(), bill_seal_id: uuid(), departed_at: dt(ago(60000)), bill_version: 1, signed_by: admin, ...o });
    await expectOk("mvp_physical_departure: accepts legacy departure with Billing seal", () => ins("departures", ld()));
    await expectReject("mvp_physical_departure: rejects legacy departure without Billing seal", "Legacy Billing source required", () => ins("departures", ld({ bill_seal_id: null })));

    // ordinary MVP vacancy (Nursing readiness) and departure (finance + paper delivery)
    let tk = 0; const base = Date.now() - 7200000; const at = () => new Date(base + (tk++) * 60000);
    const O = await episode({ wv: 2 }); const nO = await mkNurse(O); const pharmO = await staff(sid("ph"), "PHARMACY"); const bedO = await mkBed(); await hold(O, bedO);
    const shiftO = await shiftFor(O, nO, ago(86400000)); const VO = new Date(base + 40 * 60000);
    const stayO = await mkStay(O, bedO, ago(86400000 * 2), VO);
    const dpO = (o = {}) => ({ authorizerName: "Dr External", evidence: "signed order", sourceTime: iso(ago(86400000)), clinicalSummary: "summary ok", prescription: "rx ok", followUp: "follow ok", ...o });
    const post = async (action, o = {}) => { const r = await ev(O, action, { at: at(), ...o }); r.review_hash = HASH; await ins("mvp_events", r); return r.id; };
    const D = await post("doctor-approval", { by: nO, payload: dpO() });
    const C = await post("checklist", { by: nO, clinical: D, payload: { items: ["item one"], proposedNa: [], remarks: "remarks ok" } });
    const mkCheck = (k, by) => mkEv(O, "check", { by, clinical: D, checklist: C, check_key: k, status: "COMPLETE", payload: { remarks: "dept remark" }, at: at() });
    await expectReject("mvp_physical_vacancy: rejects vacancy without current Nursing readiness", "Actual vacancy must retain current Nursing readiness and same-nurse attendance", () => ins("room_vacations", { admission_id: O, stay_id: stayO, shift_id: shiftO, vacated_at: dt(VO), waiting_location: "corridor", handover: "handover ok", signed_by: nO, mvp_readiness_id: uuid(), signed_at: dt(VO) }));
    const NUR = await mkCheck("NURSING", nO); const PH = await mkCheck("PHARMACY", pharmO); const INS = await mkCheck("INSURANCE", "ins"); const DIAG = await mkCheck("DIAGNOSTICS", nO);
    // the vacancy must not predate the Nursing readiness; VO is after all of those events
    const vac = (o = {}) => ({ admission_id: O, stay_id: stayO, shift_id: shiftO, vacated_at: dt(VO), waiting_location: "corridor", handover: "handover ok", signed_by: nO, mvp_readiness_id: NUR, signed_at: dt(VO), ...o });
    await expectReject("mvp_physical_vacancy: rejects vacancy time differing from the closed stay", "Actual vacancy must retain current Nursing readiness and same-nurse attendance", () => ins("room_vacations", vac({ vacated_at: dt(new Date(VO.getTime() + 60000)), signed_at: dt(new Date(VO.getTime() + 60000)) })));
    await expectReject("mvp_physical_vacancy: rejects Nurse who is not assigned", "Assigned Nurse and held closed actual stay required", async () => ins("room_vacations", vac({ signed_by: await staff(sid("n"), "NURSE") })));
    await expectReject("mvp_physical_vacancy: rejects vacancy on a stay without bed hold", "Assigned Nurse and held closed actual stay required", async () => { const nb = await mkBed(); const st = await mkStay(O, nb, ago(86400000 * 2), VO); return ins("room_vacations", vac({ stay_id: st })); });
    await expectOk("mvp_physical_vacancy: accepts vacancy with current Nursing readiness and same-nurse shift", () => ins("room_vacations", vac()));
    const FPAY = { bill: { revision: 1, netPaise: 0 }, financial: { responsibility: { insurerPaise: 0, patientPaise: 0 } } };
    const finance = (o = {}) => post("finance", { by: admin, clinical: D, checklist: C, payload: FPAY, ...o });
    await expectReject("mvp_event_source: finance rejects payload not matching the reconciled bill", "Exact reconciled patient settlement and accepted insurer responsibility required; receivable is distinct from cash", () => finance({ payload: { bill: { revision: 1, netPaise: 9 }, financial: { responsibility: { insurerPaise: 0, patientPaise: 0 } } } }));
    let F, doc;
    await expectOk("mvp_event_source: accepts finance when checks, vacancy and settlement are complete", async () => { F = await finance(); });
    const fdoc = uuid(); doc = { id: fdoc, admission_id: O, version: 1, source_hash: HASH, hash: HASH, snapshot: { schemaVersion: 2, kind: "FINAL", clinical: { id: D }, finance: { id: F } }, storage_key: uuid(), pdf_hash: HASH, size_bytes: 1, created_by: admin, created_at: dt(at()), schema_version: 2, kind: "FINAL" };
    await without(["mvp_document_source", "mvp_exception_document"], () => ins("discharge_documents", doc));
    const dep = (o = {}) => ({ admission_id: O, stay_id: stayO, departed_at: dt(ago(60000)), bill_version: 1, signed_by: nO, mvp_finance_id: F, ...o });
    await expectReject("mvp_physical_departure: rejects departure before FINAL paper delivery", "Actual assigned-Nurse exit requires current finance and prior exact paper delivery", () => ins("departures", dep()));
    await expectOk("mvp_event_source: accepts FINAL paper delivery bound to current finance", () => post("deliver", { by: admin, clinical: D, checklist: C, payload: { kind: "FINAL", documentId: fdoc, documentHash: HASH, documentVersion: 1, financeId: F, deliveredAt: iso(at()), recipient: "Patient kin", evidence: "signed ack" } }));
    await expectReject("mvp_physical_departure: rejects departure not bound to current finance", "Actual assigned-Nurse exit requires current finance and prior exact paper delivery", () => ins("departures", dep({ mvp_finance_id: uuid() })));
    await expectReject("mvp_physical_departure: rejects departure by Nurse without a covering shift", "Actual assigned-Nurse exit requires current finance and prior exact paper delivery", async () => ins("departures", dep({ signed_by: await mkNurse(O) })));
    await expectReject("mvp_physical_departure: rejects stale bill version", "Actual assigned-Nurse exit requires current finance and prior exact paper delivery", () => ins("departures", dep({ bill_version: 9 })));
    await expectOk("mvp_physical_departure: accepts actual exit with current finance and prior paper delivery", () => ins("departures", dep()));
  }
  // ===== mvp_transfer_authority_source / mvp_transfer_cancellation_source =====
  {
    const hospital = uuid(); const bed1 = await mkBed("GEN"); const X = await episode({ wv: 2, hospital, bed: bed1 }); const nX = await mkNurse(X);
    const docId = uuid();
    await without(["doctor_directory_version_authority"], () => ins("doctor_directory_versions", { doctor_id: docId, name: "Dr Ext", active: 1, version: 1, reason: "dir", recorded_by: admin, request_id: uuid(), request_payload: "{}" }));
    await ins("setting_versions", { hospital_id: hospital, kind: "rule", version: 1, payload: { type: "bed-category", code: "ICU", active: true }, actor_type: "staff", actor_id: "x", reason: "seed" });
    const stay = await mkStay(X, bed1, ago(86400000), null, { reconciled: null });
    const au = (o = {}) => ({ id: uuid(), admission_id: X, source_stay_id: stay, external_doctor_id: docId, authorizer_name: "Dr Ext", source_time: dt(ago(3600000)), destination_category: "ICU", evidence: "evidence ok", reason: "reason ok", version: 1, admission_version: 1, recorded_by: nX, ...o });
    await expectReject("mvp_transfer_authority_source: rejects unassigned actor", "Assigned active Nurse must record external authority for the active MVP episode", async () => ins("mvp_transfer_authorities", au({ recorded_by: await staff(sid("n"), "NURSE") })));
    await expectReject("mvp_transfer_authority_source: rejects instruction before admission", "Assigned active Nurse must record external authority for the active MVP episode", () => ins("mvp_transfer_authorities", au({ source_time: dt(ago(86400000 * 20)) })));
    await expectReject("mvp_transfer_authority_source: rejects doctor name differing from directory", "Named current external Doctor directory source required", () => ins("mvp_transfer_authorities", au({ authorizer_name: "Dr Other" })));
    await expectReject("mvp_transfer_authority_source: rejects instruction before the occupied stay", "Transfer instruction must bind the current occupied physical stay", () => ins("mvp_transfer_authorities", au({ source_time: dt(ago(86400000 * 1.5)) })));
    await expectReject("mvp_transfer_authority_source: rejects stale admission version", "Current admission version, source stay, configured category and latest external instruction required", () => ins("mvp_transfer_authorities", au({ admission_version: 5 })));
    await expectReject("mvp_transfer_authority_source: rejects unconfigured destination category", "Current admission version, source stay, configured category and latest external instruction required", () => ins("mvp_transfer_authorities", au({ destination_category: "VIP" })));
    await expectReject("mvp_transfer_authority_source: rejects version gap", "Current admission version, source stay, configured category and latest external instruction required", () => ins("mvp_transfer_authorities", au({ version: 3 })));
    const a1 = au();
    await expectOk("mvp_transfer_authority_source: accepts exact external instruction and bumps admission version", async () => {
      await ins("mvp_transfer_authorities", a1);
      const [[r]] = await q("SELECT `version` v FROM admissions WHERE id=?", [X]).then(([x]) => [x]);
      if (Number(r.v) !== 2) throw new Error("admission version " + r.v);
    });
    const ca = (o = {}) => ({ admission_id: X, authority_id: a1.id, external_doctor_id: docId, authorizer_name: "Dr Ext", source_time: dt(ago(1800000)), evidence: "evidence ok", reason: "reason ok", recorded_by: nX, ...o });
    await expectReject("mvp_transfer_cancellation_source: rejects cancellation of another authority", "Only the current truly unperformed transfer may be withdrawn by recorded external instruction", () => ins("mvp_transfer_cancellations", ca({ authority_id: uuid() })));
    await expectReject("mvp_transfer_cancellation_source: rejects cancellation before the instruction", "Only the current truly unperformed transfer may be withdrawn by recorded external instruction", () => ins("mvp_transfer_cancellations", ca({ source_time: dt(ago(7200000)) })));
    await expectOk("mvp_transfer_cancellation_source: accepts withdrawal of the current unperformed transfer", () => ins("mvp_transfer_cancellations", ca()));
    await expectReject("mvp_transfer_cancellation_source: rejects second withdrawal", "Only the current truly unperformed transfer may be withdrawn by recorded external instruction", () => ins("mvp_transfer_cancellations", ca()));
  }

  // ===== mvp_transfer_movement_source =====
  {
    const T0 = ago(3600000); const dayMs = 86400000;
    const scene = async (o = {}) => {
      const hospital = uuid(); const bed1 = await mkBed("GEN"); const bed2 = await mkBed("ICU"); const X = await episode({ wv: o.wv ?? 2, hospital, bed: bed2 }); const n = await mkNurse(X);
      const tvOld = uuid(), tvNew = uuid();
      await ins("setting_versions", { id: tvOld, hospital_id: hospital, kind: "tariff", version: 1, payload: { type: "tariff", category: "GEN", basis: "day", rounding: "started-unit", amount: 1000, graceMinutes: 0 }, actor_type: "staff", actor_id: "x", reason: "seed" });
      await ins("setting_versions", { id: tvNew, hospital_id: hospital, kind: "tariff", version: 2, payload: { type: "tariff", category: "ICU", basis: "day", rounding: "started-unit", amount: 2000, graceMinutes: 0 }, actor_type: "staff", actor_id: "x", reason: "seed" });
      await ins("setting_versions", { hospital_id: hospital, kind: "rule", version: 3, payload: { type: "bed-category", code: "ICU", active: true }, actor_type: "staff", actor_id: "x", reason: "seed" });
      const s1 = await mkStay(X, bed1, new Date(T0.getTime() - 2 * dayMs), T0, { tariff: tvOld, reconciled: dt(T0) });
      const s2 = await mkStay(X, bed2, T0, null, { tariff: tvNew, reconciled: null });
      await ins("bed_holds", { bed_id: bed2, admission_id: X, held_at: dt(T0) });
      const shift = await shiftFor(X, n, ago(dayMs));
      const authId = uuid();
      await without(["mvp_transfer_authority_source"], () => ins("mvp_transfer_authorities", { id: authId, admission_id: X, source_stay_id: s1, external_doctor_id: uuid(), authorizer_name: "Dr Ext", source_time: dt(ago(7200000)), destination_category: "ICU", evidence: "evidence ok", reason: "reason ok", version: 1, admission_version: 1, recorded_by: n, recorded_at: dt(ago(7000000)) }));
      await ins("charges", { admission_id: X, source_event_id: `room:${s1}:1`, source_payload: "{}", category: "room", item_id: "GEN", description: "Room", quantity: "2", unit: "day", tariff_version_id: tvOld, rate_paise: 1000, amount_paise: o.charge ?? 2000, initial_status: "FINAL", actor_type: "staff", actor_id: "sys" });
      return { X, n, s1, s2, bed1, bed2, shift, authId, row: { admission_id: X, transfer_order_id: null, old_stay_id: s1, new_stay_id: s2, old_bed_id: bed1, target_bed_id: bed2, shift_id: shift, handover: "handover ok", transferred_at: dt(T0), signed_by: n, mvp_authority_id: authId } };
    };
    { const s = await scene(); await expectOk("mvp_transfer_movement_source: accepts exact adjacent-stay transfer reconciled to the cutoff", () => ins("admission_transfers", s.row)); }
    { const s = await scene({ charge: 1500 }); await expectReject("mvp_transfer_movement_source: rejects room charges not reconciled to the cutoff", "Original room-use charges must reconcile through the exact transfer cutoff", () => ins("admission_transfers", s.row)); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects wrong source bed", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", () => ins("admission_transfers", { ...s.row, old_bed_id: uuid() })); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects cancelled source instruction", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", async () => { await without(["mvp_transfer_cancellation_source"], () => ins("mvp_transfer_cancellations", { admission_id: s.X, authority_id: s.authId, external_doctor_id: uuid(), authorizer_name: "Dr Ext", source_time: dt(ago(6000000)), evidence: "evidence ok", reason: "reason ok", recorded_by: s.n, recorded_at: dt(ago(5900000)) })); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects transfer time before the external instruction", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", async () => { await q("UPDATE mvp_transfer_authorities SET source_time=?, recorded_at=? WHERE id=?", [dt(ago(1800000)), dt(ago(1700000)), s.authId]); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects Nurse with another Nurse's shift", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", async () => { const n2 = await mkNurse(s.X); return ins("admission_transfers", { ...s.row, signed_by: n2 }); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects target without hold", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", async () => { await q("DELETE FROM bed_holds WHERE admission_id=?", [s.X]); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects incomplete target-bed turnover", "Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold", async () => { const prev = await mkStay(s.X, s.bed2, new Date(T0.getTime() - 5 * dayMs), new Date(T0.getTime() - 4 * dayMs)); await ins("bed_turnovers", { bed_id: s.bed2, stay_id: prev, admission_id: s.X, vacated_at: dt(new Date(T0.getTime() - 4 * dayMs)), reason: "turnover", signed_by: s.n }); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects transfer predating recorded care", "Transfer cannot predate recorded actual care or source-stay use", async () => { await ins("clinical_rounds", { admission_id: s.X, notes: "round notes", signed_by: s.n, signed_at: dt(ago(1800000)) }); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects transfer predating source-stay consumable use", "Transfer cannot predate recorded actual care or source-stay use", async () => { await ins("nursing_consumables", { admission_id: s.X, shift_id: s.shift, bed_id: s.bed1, stay_id: s.s1, used_at: dt(T0), item_id: "gauze", quantity: "1", unit: "pc", reason: "dressing", signed_by: s.n }); return ins("admission_transfers", s.row); }); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects unassigned Nurse", "MVP transfer requires current assigned Nurse and separate external authority", async () => ins("admission_transfers", { ...s.row, signed_by: await staff(sid("n"), "NURSE") })); }
    { const s = await scene(); await expectReject("mvp_transfer_movement_source: rejects missing external authority", "MVP transfer requires current assigned Nurse and separate external authority", () => ins("admission_transfers", { ...s.row, mvp_authority_id: null })); }
    { const s = await scene({ wv: 1 }); await expectOk("mvp_transfer_movement_source: accepts legacy transfer with its Doctor order", () => ins("admission_transfers", { ...s.row, mvp_authority_id: null, transfer_order_id: uuid() })); }
    { const s = await scene({ wv: 1 }); await expectReject("mvp_transfer_movement_source: rejects legacy transfer without Doctor order", "Legacy transfer retains its original Doctor order", () => ins("admission_transfers", { ...s.row, mvp_authority_id: null })); }
  }
  // ===== deferred CONSTRAINT TRIGGER replacements (queries extracted from docs/agent/MARIADB_PORT_GAPS.md) =====
  const gapsText = fs.readFileSync(path.join(root, "docs/agent/MARIADB_PORT_GAPS.md"), "utf8");
  const check = (name) => { const m = gapsText.match(new RegExp("-- T2-CHECK " + name + "\\n([\\s\\S]*?)\\n```")); if (!m) throw new Error("missing T2-CHECK " + name); return m[1].replace("<ids>", "?").replace("<ids>", "?"); };
  const runCheck = async (name, ids) => { const sql = check(name); const params = sql.split("?").length - 1 === 2 ? [ids, ids] : [ids]; const [rows] = await q(sql, params); return rows; };
  const expectNoViolation = (name, label, ids) => expectOk(label, async () => { const r = await runCheck(name, ids); if (r.length) throw new Error("unexpected violation " + JSON.stringify(r)); });
  const expectViolation = (name, label, ids, message) => expectOk(label, async () => { const r = await runCheck(name, ids); if (r.length !== 1 || r[0].message !== message) throw new Error("got " + JSON.stringify(r) + ", wanted '" + message + "'"); });

  {
    // external_charge_pair
    const M = "Version 2 service charges require their atomic external performed-service source";
    const biller = await staff(sid("bill"), "BILLING");
    const mkCharge = async (adm, o = {}) => { const id = uuid(), svc = uuid(); await ins("charges", { id, admission_id: adm, source_event_id: svc, source_payload: "{}", category: "lab", item_id: "L1", description: "Lab", quantity: "1", unit: "test", tariff_version_id: uuid(), rate_paise: 100, amount_paise: 100, initial_status: "FINAL", actor_type: "staff", actor_id: biller, ...o }); return { id, svc }; };
    const mkSvc = (c, adm, o = {}) => without(["mvp_external_source"], () => ins("mvp_external_services", { id: c.svc, admission_id: adm, charge_id: c.id, category: "lab", item_id: "L1", quantity: "1", unit: "test", tariff_version_id: uuid(), performed_at: dt(ago(3600000)), department_issuer: "Lab dept", external_bill_reference: sid("B"), external_line_reference: sid("L"), evidence: "evidence", recorded_by: biller, recorder_name: "n", ...o }));
    const v2 = await episode({ wv: 2 }), v1 = await episode({ wv: 1 });
    { const c = await mkCharge(v2); await expectViolation("external_charge_pair", "external_charge_pair (mvp_external_charge_pair): flags v2 service charge without its external source", [c.id], M); await mkSvc(c, v2); await expectNoViolation("external_charge_pair", "external_charge_pair (mvp_external_charge_pair): passes once the exact service row exists", [c.id]); }
    { const c = await mkCharge(v2); await mkSvc(c, v2, { recorded_by: "someone-else" }); await expectViolation("external_charge_pair", "external_charge_pair (mvp_external_charge_pair): flags service row by another recorder", [c.id], M); }
    { const c = await mkCharge(v2, { category: "room", actor_type: "system", actor_id: "room-charge" }); await expectNoViolation("external_charge_pair", "external_charge_pair (mvp_external_charge_pair): ignores non-service categories", [c.id]); }
    { const c = await mkCharge(v1); await expectNoViolation("external_charge_pair", "external_charge_pair (mvp_external_charge_pair): ignores version 1 admissions", [c.id]); }

    // transfer_effects
    const TM = "Actual transfer must retain source-bed turnover and required external insurance follow-up";
    const mkTr = async (route) => {
      const adm = await episode({ wv: 2, route }); const oldStay = uuid(), oldBed = uuid(); const at = ago(3600000); const id = uuid();
      await without(["mvp_transfer_movement_source"], () => ins("admission_transfers", { id, admission_id: adm, transfer_order_id: null, old_stay_id: oldStay, new_stay_id: uuid(), old_bed_id: oldBed, target_bed_id: uuid(), shift_id: uuid(), handover: "handover ok", transferred_at: dt(at), signed_by: "n", mvp_authority_id: uuid() }));
      return { id, adm, oldStay, oldBed, at };
    };
    { const t = await mkTr("SELF_PAY"); await expectViolation("transfer_effects", "transfer_effects (mvp_transfer_effects): flags transfer without source-bed turnover", [t.id], TM);
      await ins("bed_turnovers", { bed_id: t.oldBed, stay_id: t.oldStay, admission_id: t.adm, vacated_at: dt(t.at), reason: "turnover", signed_by: "n" });
      await expectNoViolation("transfer_effects", "transfer_effects (mvp_transfer_effects): passes self-pay transfer with turnover", [t.id]); }
    { const t = await mkTr("INSURED"); await ins("bed_turnovers", { bed_id: t.oldBed, stay_id: t.oldStay, admission_id: t.adm, vacated_at: dt(t.at), reason: "turnover", signed_by: "n" });
      await expectViolation("transfer_effects", "transfer_effects (mvp_transfer_effects): flags insured transfer without insurance follow-up task", [t.id], TM);
      await ins("transfer_insurance_tasks", { admission_id: t.adm, transfer_id: t.id, reason: "follow up" });
      await expectNoViolation("transfer_effects", "transfer_effects (mvp_transfer_effects): passes insured transfer with turnover and task", [t.id]); }
    { const t = await mkTr("SELF_PAY"); await q("UPDATE admission_transfers SET mvp_authority_id = NULL, transfer_order_id = ? WHERE id=?", [uuid(), t.id]); await expectNoViolation("transfer_effects", "transfer_effects (mvp_transfer_effects): ignores legacy transfers", [t.id]); }

    // closed_receipt
    const rscene = async (o = {}) => {
      const adm = await episode({ wv: 2, status: o.status ?? "DISCHARGED" });
      await ins("charges", { admission_id: adm, source_event_id: sid("c"), source_payload: "{}", category: "procedure", item_id: "P1", description: "Proc", quantity: "1", unit: "u", tariff_version_id: uuid(), rate_paise: 500, amount_paise: 500, initial_status: "FINAL", actor_type: "staff", actor_id: biller });
      const resp = await respOf(adm); const auth = o.ordinary ? null : await mkXe(adm, "AUTHORITY", "CREDIT", { payload: { financial: { responsibility: { allocationComplete: o.incomplete ? false : true, patientPaise: "500", insurerPaise: "0" } }, bill: { netPaise: 500 } } });
      let fin = null;
      if (o.ordinary) { fin = await mkEv(adm, "finance", { payload: { financial: { responsibility: { insurerPaise: "0", patientPaise: "500" } } } }); await without(["mvp_physical_departure"], () => ins("departures", { admission_id: adm, stay_id: uuid(), bill_seal_id: null, departed_at: dt(ago(7200000)), bill_version: 1, signed_by: "n", mvp_finance_id: fin })); }
      else await without(["mvp_exception_departure"], () => ins("mvp_exceptional_departures", { admission_id: adm, authority_id: auth, clinical_id: uuid(), stay_id: uuid(), shift_id: uuid(), departed_at: dt(ago(7200000)), snapshot: {}, recorded_by: "n" }));
      const rid = uuid();
      await ins("receipts", { id: rid, hospital_id: uuid(), admission_id: adm, party: o.party ?? "PATIENT", kind: o.kind ?? "PAYMENT", amount_paise: o.amount ?? 500, mode: "CASH", channel: "counter", source_reference: sid("sr"), reference: sid("rf"), evidence_id: o.noEvidence ? null : "evidence-1", identity_payload: "{}", actor_type: "staff", actor_id: biller });
      if (!o.noBinding) await ins("mvp_receivable_receipts", { admission_id: adm, finance_id: o.ordinary ? fin : null, receipt_id: rid, recorded_by: o.boundBy ?? biller, exception_authority_id: o.ordinary ? null : auth, allocation_amendment_id: o.amendment ?? null });
      return { rid, resp };
    };
    const MC = { complete: "Current verified complete party allocation required before receivable collection", ordinary: "Original ordinary insurer receivable required", exceptional: "Original exceptional party authority required", retains: "Complete original responsibility retains its original collection source", amendment: "Exact current Admin-authorized post-exit allocation amendment required", later: "Later allocation collection cannot exceed original net after all retained cash", settle: "Actual post-exit receipt must settle only its original party obligation with current Billing evidence" };
    { const s = await rscene(); await expectNoViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): passes exact exceptional-authority receipt within accepted amount", [s.rid]); }
    { const s = await rscene({ status: "ADMITTED" }); await expectNoViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): ignores admissions that are not discharged", [s.rid]); }
    { const s = await rscene({ amount: 600 }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags retained cash above the accepted amount", [s.rid], MC.settle); }
    { const s = await rscene({ noBinding: true }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags receipt with no receivable binding", [s.rid], MC.exceptional); }
    { const s = await rscene({ amendment: uuid() }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags amendment on a complete original responsibility", [s.rid], MC.retains); }
    { const s = await rscene({ incomplete: true }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags missing post-exit allocation amendment", [s.rid], MC.amendment); }
    { const s = await rscene({ ordinary: true }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags patient receipt under an ordinary insurer receivable", [s.rid], MC.ordinary); }
    { const s = await rscene({ noEvidence: true }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags receipt without evidence", [s.rid], MC.settle); }
    { const s = await rscene({ boundBy: "someone-else" }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags binding recorded by another actor", [s.rid], MC.settle); }
    { const s = await rscene({ boundBy: admin }); await expectViolation("closed_receipt", "closed_receipt (mvp_closed_receipt): flags binding actor different from receipt actor", [s.rid], MC.settle); }
  }
  // CASES_PART7
}

async function main() {
  const root0 = await conn(undefined);
  await root0.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
  await root0.end();
  c = await conn(DB);
  await c.query("SET time_zone='+00:00'");
  await applyAll(c);
  const n1 = await applyTriggers(c);
  const n2 = await applyTriggers(c); // idempotent
  const [tr] = await c.query("SELECT COUNT(*) n FROM information_schema.triggers WHERE trigger_schema=?", [DB]);
  results.push(["apply twice (idempotent)", n1 === n2 && tr[0].n === n1 ? "PASS" : "FAIL", `blocks ${n1}/${n2}, triggers in db ${tr[0].n}`]);
  await c.query("SET FOREIGN_KEY_CHECKS=0");
  await runCases();
  const failed = results.filter((r) => r[1] !== "PASS");
  for (const r of results) console.log(`${r[1]}  ${r[0]}${r[2] ? "  -- " + r[2] : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await c.end();
  if (!process.env.KEEP_DB) { const r = await conn(undefined); await r.query(`DROP DATABASE IF EXISTS ${DB}`); await r.end(); }
  process.exit(failed.length ? 1 : 0);
}
await main();
