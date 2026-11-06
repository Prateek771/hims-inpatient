// Generator for web/drizzle-maria/triggers/T1.sql (trigger group T1).
// Usage: node web/drizzle-maria/triggers/T1.gen.mjs   (writes T1.sql next to this file)
// Each PostgreSQL trigger function body is inlined per trigger (MariaDB triggers cannot share bodies).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const V = "VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin";
const TX = "TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin";
const J = "LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";
const TS = "DATETIME(6)";

const sig = (m) => `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${m.replace(/'/g, "''")}';`;
const decl = (pairs) => pairs.map(([n, t]) => `  DECLARE ${n} ${t};`).join("\n");
const ind = (s, n = 2) => s.split("\n").map((l) => (l.length ? " ".repeat(n) + l : l)).join("\n");

const blocks = [];
/** timing/event default BEFORE INSERT; body lines are plain SQL statements. */
function trig({ name, table, pg, vars = [], body, timing = "BEFORE", event = "INSERT" }) {
  const text = [
    `-- TRIGGER name=${name} table=${table} timing=${timing} event=${event} pg_name=${pg}`,
    `DROP TRIGGER IF EXISTS \`${name}\`;`,
    `CREATE TRIGGER \`${name}\` ${timing} ${event} ON \`${table}\` FOR EACH ROW`,
    `trg: BEGIN`,
    decl(vars),
    ind(body.trim()),
    `END`,
    `-- END TRIGGER`,
    ``,
  ].join("\n");
  blocks.push({ name, table, pg, text, vars: vars.map((v) => v[0]) });
}

// ---- reusable statement snippets -------------------------------------------------------------------------
const SHARED_SETTINGS_LOCK = `INSERT IGNORE INTO hims_locks (lock_key) VALUES ('729104211');
SELECT lock_key INTO l_key FROM hims_locks WHERE lock_key = '729104211' LOCK IN SHARE MODE;`;
/** PostgreSQL "UPDATE admissions SET col=col WHERE id=X [RETURNING *]" was a row lock; use a locking read. */
const lockAdm = (idExpr, cols = ["id"], vars = ["e_id"]) =>
  `SELECT ${cols.join(", ")} INTO ${vars.join(", ")} FROM admissions WHERE id = ${idExpr} FOR UPDATE;`;
const jsonHas = (jsonExpr, uuidExpr) => `JSON_CONTAINS(${jsonExpr}, JSON_QUOTE(CAST(${uuidExpr} AS CHAR)))`;
const activeStaff = (idExpr, roleCond) =>
  `EXISTS(SELECT 1 FROM staff_user WHERE id = ${idExpr}${roleCond ? " AND " + roleCond : ""} AND COALESCE(banned, 0) = 0)`;

// ======================================================================================================
// guard_admin_exception -> admin_exception_authority
// ======================================================================================================
trig({
  name: "admin_exception_authority",
  table: "admin_exceptions",
  pg: "admin_exception_authority",
  vars: [
    ["l_key", V], ["e_id", "UUID"], ["e_status", V], ["e_admitted_at", TS], ["e_bill_revision", "INT"], ["e_payment_route", V],
    ["expected_kind", V],
  ],
  body: `
${lockAdm("NEW.admission_id", ["id", "status", "admitted_at", "bill_revision", "payment_route"], ["e_id", "e_status", "e_admitted_at", "e_bill_revision", "e_payment_route"])}
IF NOT ${activeStaff("NEW.signed_by", "role = 'ADMIN'")} OR NOT ${activeStaff("NEW.follow_up_owner_id")} THEN
  ${sig("Current Admin and active follow-up owner required")}
END IF;
IF NOT (CASE NEW.type
  WHEN 'URGENT_ADMISSION' THEN NEW.disposition = 'ACTIVATE' AND e_status = 'PENDING'
  WHEN 'CANCELLED_DEPOSIT' THEN NEW.disposition = 'RETURN_DEPOSIT' AND e_status = 'CANCELLED' AND e_admitted_at IS NULL AND EXISTS(SELECT 1 FROM receipts WHERE id = NEW.source_id AND admission_id = e_id AND party = 'PATIENT' AND kind <> 'PAYMENT')
  WHEN 'POST_DISCHARGE_CORRECTION' THEN NEW.disposition = 'AMEND' AND e_status = 'DISCHARGED' AND NEW.source_id IS NOT NULL AND NEW.correction_kind IN ('RECEIPT','REFUND','ALLOCATE','CANCEL_ALLOCATION','INSURANCE_DECISION','DISPOSITION_REVIEW','CLINICAL_ADDENDUM','NURSING_ADDENDUM','LAB_ADDENDUM','LAB_REPORT','LAB_BILLING','SELF_PAY_REVIEW','REVERSE_CHARGE','CARE_BILLING')
  WHEN 'DELAYED_TRANSFER' THEN NEW.disposition = 'TRANSFER' AND e_status = 'ADMITTED'
  WHEN 'ROOM_CUTOFF_CORRECTION' THEN NEW.disposition = 'AMEND' AND e_status IN ('ADMITTED','DISCHARGED') AND EXISTS(SELECT 1 FROM effective_room_stays WHERE id = NEW.source_id AND admission_id = e_id AND ended_at IS NOT NULL)
  WHEN 'RETURN_TO_BED' THEN NEW.disposition = 'RETURN_TO_BED' AND e_status = 'ADMITTED' AND EXISTS(SELECT 1 FROM effective_room_vacations WHERE admission_id = e_id)
  WHEN 'UNAVAILABLE_APPROVER' THEN (NEW.disposition = 'FOLLOW_UP' AND e_status = 'ADMITTED') OR (NEW.disposition = 'CLOSE_ATTENDANCE' AND e_status IN ('ADMITTED','DISCHARGED') AND EXISTS(SELECT 1 FROM nursing_shifts WHERE id = NEW.source_id AND admission_id = e_id))
  WHEN 'EARLY_EXIT' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'AGAINST_ADVICE' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'EXTERNAL_TRANSFER' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'DEATH' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'CREDIT' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'INSURANCE_DELAY' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  WHEN 'INSURANCE_DENIAL' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e_status = 'ADMITTED'
  ELSE 0 END) THEN
  ${sig("Named exception does not authorize this episode disposition")}
END IF;
IF NEW.type = 'POST_DISCHARGE_CORRECTION' AND NEW.correction_kind = 'REVERSE_CHARGE' AND NOT EXISTS(SELECT 1 FROM charges WHERE id = NEW.source_id AND admission_id = e_id AND category <> 'room' AND source_event_id NOT LIKE 'room:%') THEN
  ${sig("Closed reversal authority must bind original non-room charge")}
END IF;
IF NEW.type = 'POST_DISCHARGE_CORRECTION' AND NEW.correction_kind = 'CARE_BILLING' AND NOT EXISTS(SELECT 1 FROM care_billing_events b WHERE b.id = NEW.source_id AND b.admission_id = e_id AND ((b.category = 'consultation' AND EXISTS(SELECT 1 FROM clinical_rounds r WHERE r.id = b.round_id AND r.admission_id = e_id)) OR (b.category = 'consumable' AND EXISTS(SELECT 1 FROM nursing_consumables n WHERE n.id = b.id AND n.admission_id = e_id)))) THEN
  ${sig("Closed care authority requires retained performed original source")}
END IF;
IF NEW.type = 'POST_DISCHARGE_CORRECTION' AND NEW.correction_kind IN ('REVERSE_CHARGE','CARE_BILLING') AND NOT (CAST(JSON_VALUE(NEW.snapshot, '$.billVersion') AS SIGNED) <=> e_bill_revision) THEN
  ${sig("New financial authority requires current bill version")}
END IF;
IF EXISTS(SELECT 1 FROM JSON_TABLE(NEW.evidence_ids, '$[*]' COLUMNS (id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin PATH '$')) v WHERE NOT EXISTS(SELECT 1 FROM exception_evidence p WHERE CAST(p.id AS CHAR) = v.id AND p.admission_id = e_id)) THEN
  ${sig("Exception evidence must belong to the original admission")}
END IF;
SET expected_kind = CASE WHEN NEW.type IN ('AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH') THEN NEW.type WHEN NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NEW.disposition = 'EXCEPTIONAL_EXIT' THEN 'PLANNED_EXIT' END;
IF expected_kind IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exception_evidence p WHERE p.admission_id = e_id AND p.role = 'DOCTOR' AND p.kind = expected_kind AND ${jsonHas("NEW.evidence_ids", "p.id")}) THEN
  ${sig("Proper signed Doctor disposition required")}
END IF;
IF NEW.type IN ('INSURANCE_DELAY','INSURANCE_DENIAL') AND (e_payment_route <> 'INSURED' OR NOT EXISTS(SELECT 1 FROM insurance_cases WHERE id = NEW.source_id AND admission_id = e_id)) THEN
  ${sig("Actual same-episode insurance case required")}
END IF;
IF NEW.type = 'INSURANCE_DENIAL' AND NOT ((SELECT status FROM insurance_decisions WHERE case_id = NEW.source_id ORDER BY case_version DESC LIMIT 1) <=> 'REJECTED') THEN
  ${sig("Actual current external denial required")}
END IF;
`,
});

// ======================================================================================================
// guard_amended_cutoff_witness -> amended_cutoff_witness
// ======================================================================================================
trig({
  name: "amended_cutoff_witness",
  table: "stay_boundary_amendments",
  pg: "amended_cutoff_witness",
  vars: [
    ["e_id", "UUID"], ["p_shift_id", "UUID"], ["p_signed_by", V], ["p_signed_at", TS],
    ["n_id", "UUID"], ["n_admission_id", "UUID"], ["n_nurse_id", V], ["n_started_at", TS],
  ],
  body: `
${lockAdm("NEW.admission_id")}
SELECT shift_id, signed_by, signed_at INTO p_shift_id, p_signed_by, p_signed_at FROM exception_evidence WHERE id = NEW.evidence_id;
SELECT id, admission_id, nurse_id, started_at INTO n_id, n_admission_id, n_nurse_id, n_started_at FROM nursing_shifts WHERE id = p_shift_id;
IF EXISTS(SELECT 1 FROM room_vacations WHERE stay_id = NEW.stay_id AND vacated_at = NEW.ended_at) THEN
  LEAVE trg;
END IF;
IF NOT (n_admission_id <=> NEW.admission_id) OR NOT (n_nurse_id <=> p_signed_by) OR NEW.ended_at < n_started_at OR NEW.ended_at > p_signed_at OR EXISTS(SELECT 1 FROM effective_shift_ends WHERE shift_id = n_id AND ended_at < NEW.ended_at) THEN
  ${sig("Changed bed cutoff must fit its actual Nurse witness attendance and signature")}
END IF;
`,
});

// ======================================================================================================
// guard_bed_turnover -> bed_hold_turnover_guard / bed_turnover_source_guard / bed_turnover_completion_guard
// ======================================================================================================
trig({
  name: "bed_hold_turnover_guard",
  table: "bed_holds",
  pg: "bed_hold_turnover_guard",
  vars: [["b_id", "UUID"]],
  body: `
SELECT id INTO b_id FROM beds WHERE id = NEW.bed_id FOR UPDATE;
IF EXISTS(SELECT 1 FROM effective_bed_turnovers b LEFT JOIN bed_turnover_completions c ON c.turnover_id = b.id WHERE b.bed_id = NEW.bed_id AND (c.id IS NULL OR c.completed_at > NEW.held_at)) THEN
  ${sig("Actual housekeeping completion required before bed reuse")}
END IF;
`,
});
trig({
  name: "bed_turnover_source_guard",
  table: "bed_turnovers",
  pg: "bed_turnover_source_guard",
  vars: [["s_bed_id", "UUID"], ["s_admission_id", "UUID"], ["s_ended_at", TS]],
  body: `
SELECT bed_id, admission_id, ended_at INTO s_bed_id, s_admission_id, s_ended_at FROM effective_room_stays WHERE id = NEW.stay_id LIMIT 1;
IF NOT (s_bed_id <=> NEW.bed_id) OR NOT (s_admission_id <=> NEW.admission_id) OR NOT (s_ended_at <=> NEW.vacated_at) THEN
  ${sig("Turnover must reference the actual closed physical stay")}
END IF;
`,
});
trig({
  name: "bed_turnover_completion_guard",
  table: "bed_turnover_completions",
  pg: "bed_turnover_completion_guard",
  vars: [["t_bed_id", "UUID"], ["t_vacated_at", TS], ["b_id", "UUID"]],
  body: `
SELECT bed_id, vacated_at INTO t_bed_id, t_vacated_at FROM effective_bed_turnovers WHERE id = NEW.turnover_id LIMIT 1;
SELECT id INTO b_id FROM beds WHERE id = t_bed_id FOR UPDATE;
IF NEW.completed_at < t_vacated_at OR NEW.completed_at > UTC_TIMESTAMP(6) THEN
  ${sig("Cleaning completion must follow actual bed vacancy")}
END IF;
`,
});

// ======================================================================================================
// guard_current_exception_instruction -> 4 triggers (one per firing table)
// ======================================================================================================
const instrVars = [
  ["e_id", "UUID"], ["e_status", V],
  ["d_id", "UUID"], ["d_admission_id", "UUID"], ["d_kind", TX], ["d_source_id", "UUID"], ["d_signed_at", TS],
  ["v_id", "UUID"], ["v_admission_id", "UUID"], ["v_vacated_at", TS],
];
trig({
  name: "exception_instruction_current",
  table: "exception_evidence",
  pg: "exception_instruction_current",
  vars: instrVars,
  body: `
${lockAdm("NEW.admission_id", ["id", "status"], ["e_id", "e_status"])}
IF NEW.kind NOT IN ('RETURN_TO_BED','RETURN_CANCELLED','RETURN_HANDOVER') THEN
  LEAVE trg;
END IF;
IF NEW.kind = 'RETURN_CANCELLED' THEN
  SELECT id, admission_id, kind, source_id, signed_at INTO d_id, d_admission_id, d_kind, d_source_id, d_signed_at FROM exception_evidence WHERE id = NEW.source_id;
  SELECT id, admission_id, vacated_at INTO v_id, v_admission_id, v_vacated_at FROM effective_room_vacations WHERE id = d_source_id LIMIT 1;
  IF NOT (d_admission_id <=> e_id) OR NOT (d_kind <=> 'RETURN_TO_BED') OR NEW.actual_at < d_signed_at OR EXISTS(SELECT 1 FROM room_returns WHERE doctor_evidence_id = d_id) OR EXISTS(SELECT 1 FROM exception_evidence WHERE kind = 'RETURN_CANCELLED' AND source_id = d_id) OR EXISTS(SELECT 1 FROM exception_evidence WHERE admission_id = e_id AND kind = 'RETURN_HANDOVER' AND source_id = d_source_id AND actual_at >= d_signed_at) THEN
    ${sig("Doctor reconsideration requires an unconsumed unwitnessed current return instruction; record actual return first")}
  END IF;
ELSE
  SELECT id, admission_id, vacated_at INTO v_id, v_admission_id, v_vacated_at FROM effective_room_vacations WHERE id = NEW.source_id LIMIT 1;
  SELECT p.id, p.signed_at INTO d_id, d_signed_at FROM exception_evidence p WHERE p.admission_id = e_id AND p.kind = 'RETURN_TO_BED' AND p.source_id = v_id AND NOT EXISTS(SELECT 1 FROM exception_evidence c WHERE c.kind = 'RETURN_CANCELLED' AND c.source_id = p.id) AND NOT EXISTS(SELECT 1 FROM room_returns r WHERE r.doctor_evidence_id = p.id) ORDER BY p.signed_at DESC LIMIT 1;
  IF NEW.kind = 'RETURN_TO_BED' AND d_id IS NOT NULL THEN
    ${sig("Review existing return instruction before another")}
  END IF;
  IF NEW.kind = 'RETURN_HANDOVER' AND (d_id IS NULL OR NEW.actual_at < d_signed_at) THEN
    ${sig("Actual return handover requires current Doctor instruction")}
  END IF;
END IF;
IF e_status <> 'ADMITTED' OR NOT (v_admission_id <=> e_id) OR NEW.actual_at < v_vacated_at THEN
  ${sig("Return evidence requires current same-episode factual vacancy")}
END IF;
`,
});
trig({
  name: "exception_authority_instruction",
  table: "admin_exceptions",
  pg: "exception_authority_instruction",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF NEW.type = 'RETURN_TO_BED' THEN
  IF NOT EXISTS(SELECT 1 FROM exception_evidence src JOIN effective_room_vacations cur ON cur.id = src.source_id WHERE src.admission_id = e_id AND src.kind = 'RETURN_TO_BED' AND src.signed_at >= cur.vacated_at AND ${jsonHas("NEW.evidence_ids", "src.id")} AND NOT EXISTS(SELECT 1 FROM exception_evidence c WHERE c.kind = 'RETURN_CANCELLED' AND c.source_id = src.id)) THEN
    ${sig("Return authority requires current unsuperseded Doctor instruction")}
  END IF;
END IF;
`,
});
trig({
  name: "room_return_instruction",
  table: "room_returns",
  pg: "room_return_instruction",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF EXISTS(SELECT 1 FROM exception_evidence WHERE kind = 'RETURN_CANCELLED' AND source_id = NEW.doctor_evidence_id) THEN
  ${sig("Superseded Doctor instruction cannot authorize return")}
END IF;
`,
});
trig({
  name: "clearance_instruction_current",
  table: "clearance_seals",
  pg: "clearance_instruction_current",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF NEW.gate = 'DOCTOR' THEN
  IF EXISTS(SELECT 1 FROM exception_evidence p WHERE p.admission_id = e_id AND p.kind = 'RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM exception_evidence c WHERE c.kind = 'RETURN_CANCELLED' AND c.source_id = p.id) AND NOT EXISTS(SELECT 1 FROM room_returns r WHERE r.doctor_evidence_id = p.id)) THEN
    ${sig("Current return instruction requires actual return or explicit Doctor reconsideration")}
  END IF;
END IF;
`,
});

// ======================================================================================================
// guard_current_vacation -> current_room_vacation
// ======================================================================================================
trig({
  name: "current_room_vacation",
  table: "room_vacations",
  pg: "current_room_vacation",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF EXISTS(SELECT 1 FROM effective_room_vacations WHERE admission_id = NEW.admission_id) THEN
  ${sig("Current bed vacancy already exists; explicit return supersession required")}
END IF;
`,
});

// ======================================================================================================
// guard_discharge_document -> discharge_document_source (WHEN schema_version = 1)
// ======================================================================================================
const uuidOf = (expr) => `CAST(${expr} AS UUID)`;
trig({
  name: "discharge_document_source",
  table: "discharge_documents",
  pg: "discharge_document_source",
  vars: [
    ["l_key", V], ["a_id", V], ["a_banned", "TINYINT"], ["a_role", V],
    ["e_id", "UUID"], ["e_status", V], ["e_bill_revision", "INT"],
    ["departure_id", "UUID"], ["prev_id", "UUID"], ["prev_version", "INT"],
  ],
  body: `
IF NEW.schema_version = 1 THEN
  ${SHARED_SETTINGS_LOCK.split("\n").join("\n  ")}
  SELECT id, banned, role INTO a_id, a_banned, a_role FROM staff_user WHERE id = NEW.created_by LOCK IN SHARE MODE;
  IF a_id IS NULL OR a_banned OR a_role NOT IN ('ADMIN','BILLING') THEN
    ${sig("Current final-copy delivery staff required")}
  END IF;
  SELECT id, status, bill_revision INTO e_id, e_status, e_bill_revision FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NOT (e_status <=> 'DISCHARGED')
     OR NOT (${uuidOf("JSON_VALUE(NEW.snapshot, '$.admission.id')")} <=> e_id)
     OR NOT (${uuidOf("JSON_VALUE(NEW.snapshot, '$.documentId')")} <=> NEW.id)
     OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.version') AS SIGNED) <=> NEW.version)
     OR NOT ((JSON_VALUE(NEW.snapshot, '$.sourceHash') COLLATE utf8mb4_nopad_bin) <=> NEW.source_hash)
     OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.money.bill.revision') AS SIGNED) <=> e_bill_revision)
     OR NOT (CAST(LEFT(REPLACE(REPLACE(JSON_VALUE(NEW.snapshot, '$.createdAt'), 'T', ' '), 'Z', ''), 26) AS DATETIME(6)) <=> NEW.created_at) THEN
    ${sig("Coherent actual departure document source required")}
  END IF;
  SELECT id INTO departure_id FROM departures WHERE admission_id = e_id LIMIT 1;
  IF departure_id IS NOT NULL THEN
    IF JSON_VALUE(NEW.snapshot, '$.departure.kind') <> 'ORDINARY' OR NOT (${uuidOf("JSON_VALUE(NEW.snapshot, '$.departure.record.id')")} <=> departure_id) THEN
      ${sig("Original ordinary departure source required")}
    END IF;
  ELSE
    SELECT id INTO departure_id FROM exceptional_departures WHERE admission_id = e_id LIMIT 1;
    IF departure_id IS NULL OR JSON_VALUE(NEW.snapshot, '$.departure.kind') <> 'EXCEPTIONAL' OR NOT (${uuidOf("JSON_VALUE(NEW.snapshot, '$.departure.record.id')")} <=> departure_id) THEN
      ${sig("Original exceptional departure source required")}
    END IF;
  END IF;
  SELECT id, version INTO prev_id, prev_version FROM discharge_documents WHERE admission_id = e_id ORDER BY version DESC LIMIT 1;
  IF NEW.version <> COALESCE(prev_version, 0) + 1 OR NOT (NEW.replaces_document_id <=> prev_id) THEN
    ${sig("Sequential immutable document predecessor required")}
  END IF;
END IF;
`,
});

// ======================================================================================================
// guard_discharge_sources -> 5 triggers
// ======================================================================================================
trig({
  name: "allocation_cancel_source_guard",
  table: "allocation_cancellations",
  pg: "allocation_cancel_source_guard",
  vars: [["a_receipt_id", "UUID"], ["r_admission_id", "UUID"], ["e_id", "UUID"]],
  body: `
SELECT receipt_id INTO a_receipt_id FROM receipt_allocations WHERE id = NEW.allocation_id;
SELECT admission_id INTO r_admission_id FROM receipts WHERE id = a_receipt_id;
SELECT id INTO e_id FROM admissions WHERE id = r_admission_id FOR UPDATE;
`,
});
trig({
  name: "refund_source_guard",
  table: "receipt_refunds",
  pg: "refund_source_guard",
  vars: [
    ["e_id", "UUID"], ["r_id", "UUID"], ["r_admission_id", "UUID"], ["r_hospital_id", "UUID"], ["r_created_at", TS],
    ["r_amount_paise", "BIGINT"], ["r_kind", TX],
  ],
  body: `
SELECT id INTO e_id FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
SELECT id, admission_id, hospital_id, created_at, amount_paise, kind INTO r_id, r_admission_id, r_hospital_id, r_created_at, r_amount_paise, r_kind FROM receipts WHERE id = NEW.receipt_id;
IF NOT (r_admission_id <=> e_id) OR NOT (r_hospital_id <=> NEW.hospital_id) THEN
  ${sig("Refund must link this admission original receipt")}
END IF;
IF NEW.refunded_at > UTC_TIMESTAMP(6) OR NEW.refunded_at < r_created_at THEN
  ${sig("Refund actual time outside receipt history")}
END IF;
IF NEW.amount_paise + COALESCE((SELECT SUM(amount_paise) FROM receipt_refunds WHERE receipt_id = r_id), 0) > r_amount_paise THEN
  ${sig("Refund exceeds original receipt")}
END IF;
IF r_kind <> 'PAYMENT' AND NEW.amount_paise + COALESCE((SELECT SUM(amount_paise) FROM receipt_refunds WHERE receipt_id = r_id), 0) + COALESCE((SELECT SUM(x.amount_paise) FROM receipt_allocations x WHERE x.receipt_id = r_id AND NOT EXISTS(SELECT 1 FROM allocation_cancellations c WHERE c.allocation_id = x.id)), 0) > r_amount_paise THEN
  ${sig("Cancel allocated deposit before refund")}
END IF;
`,
});
trig({
  name: "clearance_source_guard",
  table: "clearance_seals",
  pg: "clearance_source_guard",
  vars: [["e_id", "UUID"], ["s_id", "UUID"], ["s_admission_id", "UUID"], ["s_gate", V]],
  body: `
${lockAdm("NEW.admission_id")}
IF NOT ${activeStaff("NEW.signed_by", "role = NEW.role")} THEN
  ${sig("Current actual seal role required")}
END IF;
IF NEW.gate <> 'DOCTOR' THEN
  SELECT id, admission_id, gate INTO s_id, s_admission_id, s_gate FROM clearance_seals WHERE id = NEW.predecessor_id;
  IF NOT (s_admission_id <=> e_id) OR NOT (NULLIF(FIELD(s_gate, 'DOCTOR', 'PHARMACY', 'NURSING', 'BILLING'), 0) <=> NULLIF(FIELD(NEW.gate, 'DOCTOR', 'PHARMACY', 'NURSING', 'BILLING'), 0) - 1) OR EXISTS(SELECT 1 FROM clearance_invalidations WHERE seal_id = s_id) THEN
    ${sig("Current same-episode predecessor required")}
  END IF;
END IF;
`,
});
for (const [name, table] of [["departure_source_guard", "departures"], ["vacation_source_guard", "room_vacations"]]) {
  trig({
    name,
    table,
    pg: name,
    vars: [["e_id", "UUID"], ["st_admission_id", "UUID"]],
    body: `
${lockAdm("NEW.admission_id")}
SELECT admission_id INTO st_admission_id FROM room_stays WHERE id = NEW.stay_id;
IF NOT (st_admission_id <=> e_id) THEN
  ${sig("Same episode stay required")}
END IF;
`,
  });
}

// ======================================================================================================
// guard_effective_attendance -> 8 triggers (to_jsonb(NEW) column probing resolved per table)
// ======================================================================================================
const attendanceCfg = {
  administrative_shift_ends: { end: true, admin: true },
  nursing_shift_ends: { end: true },
  admission_transfers: { care: "transferred_at" },
  exception_evidence: { care: "actual_at", future: true },
  medication_administrations: { care: "actual_at" },
  nursing_consumables: { care: "used_at" },
  nursing_observations: { care: "observed_at" },
  room_vacations: { care: "vacated_at" },
};
for (const [table, cfg] of Object.entries(attendanceCfg)) {
  const vars = [
    ["n_id", "UUID"], ["n_admission_id", "UUID"], ["n_nurse_id", V], ["n_started_at", TS], ["e_id", "UUID"], ["moment", TS],
  ];
  if (cfg.admin) vars.push(["x_admission_id", "UUID"], ["x_type", V], ["x_disposition", V], ["x_source_id", "UUID"]);
  let tail;
  if (cfg.end) {
    const authority = cfg.admin
      ? `SELECT admission_id, type, disposition, source_id INTO x_admission_id, x_type, x_disposition, x_source_id FROM admin_exceptions WHERE id = NEW.exception_id;
  IF NOT (x_admission_id <=> e_id) OR x_type <> 'UNAVAILABLE_APPROVER' OR x_disposition <> 'CLOSE_ATTENDANCE' OR NOT (x_source_id <=> n_id) OR NOT (NEW.admission_id <=> e_id) OR NOT ${activeStaff("NEW.signed_by", "role = 'ADMIN'")} THEN
    ${sig("Original shift and actual Admin exception authority required")}
  END IF;`
      : `IF NOT (NEW.signed_by <=> n_nurse_id) THEN
    ${sig("Only original Nurse signs professional attendance")}
  END IF;`;
    tail = `
SET moment = NEW.ended_at;
IF EXISTS(SELECT 1 FROM effective_shift_ends WHERE shift_id = n_id) THEN
  ${sig("Attendance already has a retained factual end")}
END IF;
${authority.replace(/^/, "").trim()}
IF EXISTS(SELECT 1 FROM (
    SELECT actual_at AS t FROM medication_administrations WHERE shift_id = n_id
    UNION ALL SELECT observed_at FROM nursing_observations WHERE shift_id = n_id
    UNION ALL SELECT used_at FROM nursing_consumables WHERE shift_id = n_id
    UNION ALL SELECT transferred_at FROM admission_transfers WHERE shift_id = n_id
    UNION ALL SELECT vacated_at FROM effective_vacation_facts WHERE shift_id = n_id
    UNION ALL SELECT actual_at FROM exception_evidence WHERE shift_id = n_id
  ) facts WHERE t > moment) THEN
  ${sig("Attendance cannot end before actual care or physical handover")}
END IF;
IF moment <= n_started_at OR EXISTS(SELECT 1 FROM departures WHERE admission_id = e_id AND departed_at < moment) OR EXISTS(SELECT 1 FROM exceptional_departures WHERE admission_id = e_id AND departed_at < moment) THEN
  ${sig("Attendance end outside actual episode")}
END IF;`;
  } else {
    tail = `
SET moment = NEW.${cfg.care};
IF NOT (n_admission_id <=> NEW.admission_id) OR NOT (n_nurse_id <=> NEW.signed_by) OR moment < n_started_at OR EXISTS(SELECT 1 FROM effective_shift_ends WHERE shift_id = n_id AND ended_at < moment) THEN
  ${sig("Actual care must fit original Nurse attendance")}
END IF;`;
  }
  if (cfg.future || cfg.admin) {
    tail += `
IF moment > UTC_TIMESTAMP(6) THEN
  ${sig("Actual attendance evidence cannot be in future")}
END IF;`;
  }
  trig({
    name: `effective_attendance_guard_${table}`,
    table,
    pg: "effective_attendance_guard",
    vars,
    body: `
SELECT id, admission_id, nurse_id, started_at INTO n_id, n_admission_id, n_nurse_id, n_started_at FROM nursing_shifts WHERE id = NEW.shift_id;
IF n_id IS NULL THEN
  LEAVE trg;
END IF;
${lockAdm("n_admission_id")}
${tail.trim()}
`,
  });
}

// ======================================================================================================
// guard_effective_consumable -> effective_consumable_source
// ======================================================================================================
trig({
  name: "effective_consumable_source",
  table: "nursing_consumables",
  pg: "effective_consumable_source",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF NOT EXISTS(SELECT 1 FROM effective_room_stays s WHERE s.id = NEW.stay_id AND s.admission_id = NEW.admission_id AND s.bed_id = NEW.bed_id AND NEW.used_at >= s.started_at AND (s.ended_at IS NULL OR NEW.used_at < s.ended_at)) THEN
  ${sig("Consumable must retain its actual effective physical source unit")}
END IF;
`,
});

// ======================================================================================================
// guard_exception_attendance_end -> exception_attendance_end
// ======================================================================================================
trig({
  name: "exception_attendance_end",
  table: "nursing_shift_ends",
  pg: "exception_attendance_end",
  vars: [["episode", "UUID"], ["e_id", "UUID"]],
  body: `
SELECT admission_id INTO episode FROM nursing_shifts WHERE id = NEW.shift_id;
${lockAdm("episode")}
IF EXISTS(SELECT 1 FROM exception_evidence WHERE shift_id = NEW.shift_id AND actual_at > NEW.ended_at) THEN
  ${sig("Attendance cannot end before witnessed physical exception evidence")}
END IF;
`,
});

// ======================================================================================================
// guard_exception_evidence -> exception_evidence_source
// ======================================================================================================
trig({
  name: "exception_evidence_source",
  table: "exception_evidence",
  pg: "exception_evidence_source",
  vars: [
    ["e_id", "UUID"], ["e_status", V], ["e_admitted_at", TS], ["e_admitting_doctor_id", V],
    ["n_id", "UUID"], ["n_admission_id", "UUID"], ["n_nurse_id", V], ["n_started_at", TS],
  ],
  body: `
${lockAdm("NEW.admission_id", ["id", "status", "admitted_at", "admitting_doctor_id"], ["e_id", "e_status", "e_admitted_at", "e_admitting_doctor_id"])}
IF (e_status <> 'ADMITTED' AND NOT (e_status = 'DISCHARGED' AND NEW.kind IN ('ROOM_CUTOFF','PROFESSIONAL_REVIEW'))) OR NEW.actual_at < e_admitted_at OR NEW.actual_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.actual_at OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.signed_by AND role = NEW.role AND NOT banned) THEN
  ${sig("Current professional evidence with factual episode time required")}
END IF;
IF NEW.kind = 'PROFESSIONAL_REVIEW' AND NOT EXISTS(SELECT 1 FROM admin_exceptions x JOIN exceptional_departures d ON d.id = x.source_id WHERE x.id = NEW.exception_id AND x.admission_id = e_id AND x.type = 'POST_DISCHARGE_CORRECTION' AND x.disposition = 'AMEND' AND x.correction_kind = 'DISPOSITION_REVIEW' AND x.source_id = NEW.source_id AND d.admission_id = e_id) THEN
  ${sig("Professional follow-up requires specific retained departure authority")}
END IF;
IF NEW.kind = 'ROOM_CUTOFF' AND NOT EXISTS(SELECT 1 FROM admin_exceptions x WHERE x.id = NEW.exception_id AND x.admission_id = e_id AND x.type = 'ROOM_CUTOFF_CORRECTION' AND x.disposition = 'AMEND' AND x.source_id = NEW.source_id) THEN
  ${sig("Cutoff witness must bind retained original authority")}
END IF;
IF NEW.role = 'DOCTOR' AND e_admitting_doctor_id <> NEW.signed_by THEN
  ${sig("Assigned Doctor evidence required")}
END IF;
IF NEW.role = 'NURSE' THEN
  SELECT id, admission_id, nurse_id, started_at INTO n_id, n_admission_id, n_nurse_id, n_started_at FROM nursing_shifts WHERE id = NEW.shift_id;
  IF NOT (n_admission_id <=> e_id) OR NOT (n_nurse_id <=> NEW.signed_by) OR NEW.actual_at < n_started_at OR EXISTS(SELECT 1 FROM effective_shift_ends WHERE shift_id = n_id AND ended_at < NEW.actual_at) OR NOT EXISTS(SELECT 1 FROM nurse_assignments a WHERE a.admission_id = e_id AND a.nurse_id = NEW.signed_by AND NOT EXISTS(SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = a.id)) THEN
    ${sig("Current assigned Nurse and actual attendance required")}
  END IF;
END IF;
IF NEW.vacated_at IS NOT NULL AND (NEW.vacated_at < e_admitted_at OR NEW.vacated_at > NEW.actual_at) THEN
  ${sig("Physical vacancy must precede hospital exit")}
END IF;
`,
});

// ======================================================================================================
// guard_exception_followup -> exception_followups_source
// ======================================================================================================
trig({
  name: "exception_followups_source",
  table: "exception_followups",
  pg: "exception_followups_source",
  vars: [
    ["e_id", "UUID"], ["x_id", "UUID"], ["x_admission_id", "UUID"], ["x_follow_up_owner_id", V], ["staff_role", V], ["current_owner", V],
  ],
  body: `
${lockAdm("NEW.admission_id")}
SELECT id, admission_id, follow_up_owner_id INTO x_id, x_admission_id, x_follow_up_owner_id FROM admin_exceptions WHERE id = NEW.exception_id;
SELECT role INTO staff_role FROM staff_user WHERE id = NEW.signed_by AND COALESCE(banned, 0) = 0;
SELECT owner_id INTO current_owner FROM exception_followups WHERE exception_id = x_id ORDER BY signed_at DESC LIMIT 1;
SET current_owner = COALESCE(current_owner, x_follow_up_owner_id);
IF NOT (x_admission_id <=> NEW.admission_id) OR staff_role IS NULL OR (staff_role <> 'ADMIN' AND (NEW.signed_by <> current_owner OR NEW.owner_id <> current_owner)) OR NOT ${activeStaff("NEW.owner_id")} THEN
  ${sig("Current accountable owner or Admin must record follow-up")}
END IF;
`,
});

// ======================================================================================================
// guard_exceptional_departure -> exceptional_departure_source
// ======================================================================================================
const careFactsUnion = (episodeVar) => `SELECT actual_at AS t FROM medication_administrations WHERE admission_id = ${episodeVar}
    UNION ALL SELECT observed_at FROM nursing_observations WHERE admission_id = ${episodeVar}
    UNION ALL SELECT used_at FROM nursing_consumables WHERE admission_id = ${episodeVar}
    UNION ALL SELECT transferred_at FROM admission_transfers WHERE admission_id = ${episodeVar}
    UNION ALL SELECT n.ended_at FROM effective_shift_ends n JOIN nursing_shifts h ON h.id = n.shift_id WHERE h.admission_id = ${episodeVar}`;
trig({
  name: "exceptional_departure_source",
  table: "exceptional_departures",
  pg: "exceptional_departure_source",
  vars: [
    ["e_id", "UUID"], ["e_status", V],
    ["a_admission_id", "UUID"], ["a_disposition", V], ["a_evidence_ids", J],
    ["p_id", "UUID"], ["p_admission_id", "UUID"], ["p_kind", V], ["p_actual_at", TS], ["p_vacated_at", TS],
    ["s_admission_id", "UUID"], ["s_ended_at", TS],
  ],
  body: `
${lockAdm("NEW.admission_id", ["id", "status"], ["e_id", "e_status"])}
SELECT admission_id, disposition, evidence_ids INTO a_admission_id, a_disposition, a_evidence_ids FROM admin_exceptions WHERE id = NEW.exception_id;
SELECT id, admission_id, kind, actual_at, vacated_at INTO p_id, p_admission_id, p_kind, p_actual_at, p_vacated_at FROM exception_evidence WHERE id = NEW.physical_evidence_id;
SELECT admission_id, ended_at INTO s_admission_id, s_ended_at FROM effective_room_stays WHERE id = NEW.stay_id LIMIT 1;
IF e_status <> 'ADMITTED' OR NOT (a_admission_id <=> e_id) OR a_disposition <> 'EXCEPTIONAL_EXIT' OR NOT (p_admission_id <=> e_id) OR p_kind <> 'PHYSICAL_EXIT' OR NOT (p_actual_at <=> NEW.departed_at) OR NOT (s_admission_id <=> e_id) OR NOT (s_ended_at <=> p_vacated_at) OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.signed_by AND role = 'ADMIN' AND NOT banned) OR EXISTS(SELECT 1 FROM departures WHERE admission_id = e_id) THEN
  ${sig("Actual source-linked exceptional departure required")}
END IF;
IF NOT ${jsonHas("a_evidence_ids", "p_id")} THEN
  ${sig("Actual departure witness must be included in authority")}
END IF;
IF EXISTS(SELECT 1 FROM (
    ${careFactsUnion("e_id")}
  ) facts WHERE t > NEW.departed_at) THEN
  ${sig("Recorded actual care or attendance continues after claimed departure")}
END IF;
`,
});

// ======================================================================================================
// guard_final_exit_chronology -> 3 triggers
// ======================================================================================================
trig({
  name: "actual_doctor_exit_chronology",
  table: "exception_evidence",
  pg: "actual_doctor_exit_chronology",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF NEW.role = 'DOCTOR' AND NEW.kind IN ('DEATH','EXTERNAL_TRANSFER','AGAINST_ADVICE','PLANNED_EXIT') AND EXISTS(SELECT 1 FROM (SELECT departed_at FROM departures WHERE admission_id = e_id UNION ALL SELECT departed_at FROM exceptional_departures WHERE admission_id = e_id) d WHERE d.departed_at < NEW.actual_at) THEN
  ${sig("Actual professional disposition cannot occur after actual hospital exit")}
END IF;
`,
});
trig({
  name: "planned_exception_instruction",
  table: "admin_exceptions",
  pg: "planned_exception_instruction",
  vars: [["e_id", "UUID"]],
  body: `
${lockAdm("NEW.admission_id")}
IF NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NEW.disposition = 'EXCEPTIONAL_EXIT' THEN
  SET @ignored = assert_planned_exit_instruction(e_id, NEW.evidence_ids);
END IF;
`,
});
trig({
  name: "selected_doctor_exit_chronology",
  table: "exceptional_departures",
  pg: "selected_doctor_exit_chronology",
  vars: [["e_id", "UUID"], ["a_type", V], ["a_evidence_ids", J], ["required_kind", V]],
  body: `
${lockAdm("NEW.admission_id")}
SELECT type, evidence_ids INTO a_type, a_evidence_ids FROM admin_exceptions WHERE id = NEW.exception_id;
SET required_kind = CASE WHEN a_type IN ('DEATH','EXTERNAL_TRANSFER','AGAINST_ADVICE') THEN a_type WHEN a_type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') THEN 'PLANNED_EXIT' END;
IF required_kind IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM exception_evidence p WHERE p.admission_id = e_id AND p.role = 'DOCTOR' AND p.kind = required_kind AND ${jsonHas("a_evidence_ids", "p.id")} AND p.actual_at <= NEW.departed_at)
   OR EXISTS(SELECT 1 FROM exception_evidence p WHERE p.admission_id = e_id AND p.role = 'DOCTOR' AND p.kind = required_kind AND ${jsonHas("a_evidence_ids", "p.id")} AND p.actual_at > NEW.departed_at)) THEN
  ${sig("Selected actual Doctor disposition cannot follow the witnessed hospital exit")}
END IF;
IF required_kind = 'PLANNED_EXIT' THEN
  SET @ignored = assert_planned_exit_instruction(e_id, a_evidence_ids);
END IF;
`,
});

// ======================================================================================================
// guard_final_financial_source -> final_charge_source (charges) / final_reversal_source (charge_reversals)
// ======================================================================================================
const finVarsCommon = [
  ["e_id", "UUID"], ["e_status", V], ["e_bill_revision", "INT"], ["e_hospital_id", "UUID"], ["e_admitting_doctor_id", V],
  ["staff_role", V],
  ["a_admission_id", "UUID"], ["a_type", V], ["a_disposition", V], ["a_bill_version", "INT"], ["a_correction_kind", V], ["a_source_id", "UUID"],
  ["b_id", "UUID"], ["b_category", TX], ["b_item_id", TX], ["b_quantity", TX], ["b_unit", TX], ["b_tariff_version_id", "UUID"],
  ["b_order_id", "UUID"], ["b_round_id", "UUID"], ["b_created_at", TS],
  ["policy", J],
];
const loadAdminAuthority = `SELECT admission_id, type, disposition, CAST(JSON_VALUE(snapshot, '$.billVersion') AS SIGNED), correction_kind, source_id INTO a_admission_id, a_type, a_disposition, a_bill_version, a_correction_kind, a_source_id FROM admin_exceptions WHERE id = NEW.correction_exception_id;
IF NOT (e_status <=> 'DISCHARGED') OR NEW.actor_type <> 'staff' OR staff_role IS NULL OR NOT (a_admission_id <=> e_id) OR NOT (a_type <=> 'POST_DISCHARGE_CORRECTION') OR NOT (a_disposition <=> 'AMEND') OR NOT (a_bill_version <=> e_bill_revision) THEN
  ${sig("Closed financial effect needs fresh exact Admin authority")}
END IF;`;
const chargeSourceChecks = `SELECT id, category, item_id, quantity, unit, tariff_version_id, order_id, round_id, created_at INTO b_id, b_category, b_item_id, b_quantity, b_unit, b_tariff_version_id, b_order_id, b_round_id, b_created_at FROM care_billing_events WHERE CAST(id AS CHAR) = NEW.source_event_id AND admission_id = e_id LIMIT 1;
IF a_correction_kind = 'CARE_BILLING' THEN
  IF NOT (b_id <=> a_source_id) OR NOT (b_category <=> NEW.category) OR NOT (b_item_id <=> NEW.item_id) OR NOT (b_quantity <=> NEW.quantity) OR NOT (b_unit <=> NEW.unit) OR NOT (b_tariff_version_id <=> NEW.tariff_version_id) OR NEW.initial_status <> 'FINAL'
     OR NOT ((b_category = 'consultation' AND staff_role = 'DOCTOR' AND e_admitting_doctor_id = NEW.actor_id AND EXISTS(SELECT 1 FROM clinical_rounds r WHERE r.id = b_round_id AND r.admission_id = e_id)) OR (b_category = 'consumable' AND staff_role = 'NURSE' AND EXISTS(SELECT 1 FROM nursing_consumables n WHERE n.id = b_id AND n.admission_id = e_id AND n.item_id = b_item_id AND n.quantity = b_quantity AND n.unit = b_unit) AND EXISTS(SELECT 1 FROM nurse_assignments n WHERE n.admission_id = e_id AND n.nurse_id = NEW.actor_id AND NOT EXISTS(SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = n.id)))) THEN
    ${sig("Closed care fee requires original performed source quantity pin and current proper role")}
  END IF;
  IF NOT EXISTS(SELECT 1 FROM (SELECT signed_at FROM departures WHERE admission_id = e_id UNION ALL SELECT signed_at FROM exceptional_departures WHERE admission_id = e_id) d WHERE b_created_at <= d.signed_at) THEN
    ${sig("Closed care pricing cannot create new retrospective clinical work")}
  END IF;
ELSEIF a_correction_kind IN ('LAB_REPORT','LAB_BILLING') THEN
  IF NOT (staff_role <=> 'LAB') OR NOT (b_order_id <=> a_source_id) OR b_category NOT IN ('lab','radiology') OR NOT EXISTS(SELECT 1 FROM lab_processing WHERE order_id = b_order_id) THEN
    ${sig("Closed diagnostic fee requires original performed Lab source")}
  END IF;
ELSE
  ${sig("No authority for this closed charge")}
END IF;
SELECT payload INTO policy FROM setting_versions WHERE id = NEW.tariff_version_id AND hospital_id = e_hospital_id;
IF NOT (JSON_VALUE(policy, '$.type') <=> 'billable-item') OR NOT ((JSON_VALUE(policy, '$.code') COLLATE utf8mb4_nopad_bin) <=> NEW.item_id) OR NOT ((JSON_VALUE(policy, '$.category') COLLATE utf8mb4_nopad_bin) <=> NEW.category) OR NOT ((JSON_VALUE(policy, '$.unit') COLLATE utf8mb4_nopad_bin) <=> NEW.unit) OR NOT (NEW.rate_paise <=> CAST(ROUND(CAST(JSON_VALUE(policy, '$.amount') AS DECIMAL(30,6)), 0) AS SIGNED)) OR NOT (NEW.amount_paise <=> CAST(ROUND(CAST(JSON_VALUE(policy, '$.amount') AS DECIMAL(30,6)) * CAST(NEW.quantity AS DECIMAL(30,6)), 0) AS SIGNED)) THEN
  ${sig("Closed charge must retain the exact configured rate and original quantity")}
END IF;`;

trig({
  name: "final_charge_source",
  table: "charges",
  pg: "final_charge_source",
  vars: finVarsCommon,
  body: `
${lockAdm("NEW.admission_id", ["id", "status", "bill_revision", "hospital_id", "admitting_doctor_id"], ["e_id", "e_status", "e_bill_revision", "e_hospital_id", "e_admitting_doctor_id"])}
SELECT role INTO staff_role FROM staff_user WHERE id = NEW.actor_id AND NOT COALESCE(banned, 0);
IF NEW.correction_exception_id IS NOT NULL THEN
  ${ind(loadAdminAuthority, 2).trim()}
  ${ind(chargeSourceChecks, 2).trim()}
ELSEIF e_status = 'DISCHARGED' AND NEW.category <> 'room' THEN
  ${sig("Closed non-room money requires exact source-bound amendment authority")}
END IF;
`,
});

trig({
  name: "final_reversal_source",
  table: "charge_reversals",
  pg: "final_reversal_source",
  vars: [
    ...finVarsCommon,
    ["c_id", "UUID"], ["c_admission_id", "UUID"], ["c_source_event_id", V], ["c_category", TX], ["c_amount_paise", "BIGINT"],
    ["prior", "BIGINT"],
    ["amend_id", "UUID"], ["amend_stay_id", "UUID"], ["amend_admission_id", "UUID"], ["amend_signed_by", TX],
    ["st_id", "UUID"], ["st_amendment_id", "UUID"], ["st_started_at", TS], ["st_ended_at", TS], ["st_tariff_version_id", "UUID"],
    ["elapsed", "DECIMAL(40,6)"], ["unit_ms", "DECIMAL(40,6)"], ["rate_v", "DECIMAL(40,6)"], ["due", "DECIMAL(40,6)"], ["net_v", "DECIMAL(40,6)"],
  ],
  body: `
SELECT id, admission_id, source_event_id, category, amount_paise INTO c_id, c_admission_id, c_source_event_id, c_category, c_amount_paise FROM charges WHERE id = NEW.charge_id;
${lockAdm("c_admission_id", ["id", "status", "bill_revision", "hospital_id", "admitting_doctor_id"], ["e_id", "e_status", "e_bill_revision", "e_hospital_id", "e_admitting_doctor_id"])}
SELECT role INTO staff_role FROM staff_user WHERE id = NEW.actor_id AND NOT COALESCE(banned, 0);
SELECT COALESCE(SUM(amount_paise), 0) INTO prior FROM charge_reversals WHERE charge_id = c_id;
IF prior + NEW.amount_paise > c_amount_paise THEN
  ${sig("Reversal exceeds remaining original source")}
END IF;
IF c_category = 'room' OR c_source_event_id LIKE 'room:%' THEN
  SELECT id, stay_id, admission_id, signed_by INTO amend_id, amend_stay_id, amend_admission_id, amend_signed_by FROM stay_boundary_amendments WHERE id = NEW.physical_amendment_id;
  SELECT id, amendment_id, started_at, ended_at, tariff_version_id INTO st_id, st_amendment_id, st_started_at, st_ended_at, st_tariff_version_id FROM effective_room_stays WHERE id = amend_stay_id LIMIT 1;
  IF NEW.correction_exception_id IS NOT NULL OR NEW.actor_type <> 'staff' OR NOT (staff_role <=> 'ADMIN')
     OR amend_id IS NULL OR NOT (st_amendment_id <=> amend_id) OR NOT (amend_admission_id <=> e_id)
     OR NOT (amend_signed_by <=> NEW.actor_id) OR c_source_event_id NOT LIKE CONCAT('room:', st_id, ':%') THEN
    ${sig("Room reversal requires the current original-source physical amendment")}
  END IF;
  SELECT payload INTO policy FROM setting_versions WHERE id = st_tariff_version_id;
  SET elapsed = GREATEST(0, COALESCE(FLOOR(UNIX_TIMESTAMP(st_ended_at) * 1000) - FLOOR(UNIX_TIMESTAMP(st_started_at) * 1000) - COALESCE(CAST(JSON_VALUE(policy, '$.graceMinutes') AS DECIMAL(30,6)), 0) * 60000, 0));
  SET unit_ms = CASE WHEN JSON_VALUE(policy, '$.basis') = 'hour' THEN 3600000 ELSE 86400000 END;
  SET rate_v = CAST(JSON_VALUE(policy, '$.amount') AS DECIMAL(30,6));
  SET due = CASE WHEN JSON_VALUE(policy, '$.rounding') = 'started-unit' THEN (CAST(FLOOR(elapsed + unit_ms - 1) AS SIGNED) DIV unit_ms) * rate_v ELSE (CAST(FLOOR(elapsed * rate_v + unit_ms / 2) AS SIGNED) DIV unit_ms) END;
  SELECT COALESCE(SUM(ch.amount_paise - COALESCE((SELECT SUM(r.amount_paise) FROM charge_reversals r WHERE r.charge_id = ch.id), 0)), 0) INTO net_v FROM charges ch WHERE ch.admission_id = e_id AND ch.source_event_id LIKE CONCAT('room:', st_id, ':%');
  IF net_v - NEW.amount_paise < due THEN
    ${sig("Physical correction cannot waive occupied time or double-credit the pinned room rate")}
  END IF;
  LEAVE trg;
END IF;
IF NEW.physical_amendment_id IS NOT NULL THEN
  ${sig("Physical amendment only corrects its original room source")}
END IF;
IF NEW.correction_exception_id IS NOT NULL THEN
  ${ind(loadAdminAuthority, 2).trim()}
  IF NOT (a_correction_kind <=> 'REVERSE_CHARGE') OR NOT (a_source_id <=> c_id) OR staff_role NOT IN ('ADMIN','BILLING') THEN
    ${sig("Closed reversal requires proper Billing role and original non-room charge")}
  END IF;
ELSEIF e_status = 'DISCHARGED' AND c_category <> 'room' THEN
  ${sig("Closed non-room money requires exact source-bound amendment authority")}
END IF;
`,
});

// ======================================================================================================
// guard_insurance_source -> 3 triggers
// ======================================================================================================
const insHead = `SELECT id, admission_id INTO c_id, c_admission_id FROM insurance_cases WHERE id = NEW.case_id;
SELECT id INTO e_id FROM admissions WHERE id = c_admission_id FOR UPDATE;`;
const insVars = [["c_id", "UUID"], ["c_admission_id", "UUID"], ["e_id", "UUID"], ["source_case", "UUID"]];
trig({
  name: "insurance_document_source",
  table: "insurance_documents",
  pg: "insurance_document_source",
  vars: insVars,
  body: `
${insHead}
IF NEW.replaces_document_id IS NOT NULL THEN
  SELECT case_id INTO source_case FROM insurance_documents WHERE id = NEW.replaces_document_id;
  IF NOT (source_case <=> c_id) THEN
    ${sig("Document replacement requires same case")}
  END IF;
END IF;
`,
});
trig({
  name: "insurance_decision_source",
  table: "insurance_decisions",
  pg: "insurance_decision_source",
  vars: insVars,
  body: `
${insHead}
SELECT case_id INTO source_case FROM insurance_events WHERE id = NEW.policy_event_id AND kind = 'POLICY';
IF NOT (source_case <=> c_id) THEN
  ${sig("Decision requires same-case external policy evidence")}
END IF;
`,
});
trig({
  name: "insurance_resolution_source",
  table: "insurance_transfer_resolutions",
  pg: "insurance_resolution_source",
  vars: insVars,
  body: `
${insHead}
IF NOT EXISTS(SELECT 1 FROM transfer_insurance_tasks WHERE id = NEW.task_id AND admission_id = c_admission_id) THEN
  ${sig("Transfer resolution requires same episode")}
END IF;
IF NEW.decision_id IS NOT NULL THEN
  SELECT case_id INTO source_case FROM insurance_decisions WHERE id = NEW.decision_id;
ELSE
  SELECT case_id INTO source_case FROM insurance_conversions WHERE id = NEW.conversion_id;
END IF;
IF NOT (source_case <=> c_id) THEN
  ${sig("Transfer resolution requires same-case evidence")}
END IF;
`,
});

// ======================================================================================================
// guard_lab_disposition -> lab_disposition_source
// ======================================================================================================
trig({
  name: "lab_disposition_source",
  table: "lab_dispositions",
  pg: "lab_disposition_source",
  vars: [
    ["o_id", "UUID"], ["o_admission_id", "UUID"], ["o_kind", TX], ["e_id", "UUID"],
    ["c_id", "UUID"], ["c_initial_status", TX], ["c_amount_paise", "BIGINT"],
    ["r_id", "UUID"], ["r_charge_id", "UUID"], ["r_amount_paise", "BIGINT"],
  ],
  body: `
SELECT id, admission_id, kind INTO o_id, o_admission_id, o_kind FROM clinical_orders WHERE id = NEW.order_id;
SELECT id INTO e_id FROM admissions WHERE id = o_admission_id FOR UPDATE;
IF o_kind NOT IN ('LAB','RADIOLOGY') OR o_admission_id <> NEW.admission_id OR NOT EXISTS(SELECT 1 FROM clinical_task_events WHERE id = NEW.stop_event_id AND order_id = o_id AND status = 'STOPPED') THEN
  ${sig("Disposition requires actual stopped diagnostic source")}
END IF;
IF EXISTS(SELECT 1 FROM lab_samples WHERE order_id = o_id) OR EXISTS(SELECT 1 FROM lab_processing WHERE order_id = o_id) OR EXISTS(SELECT 1 FROM lab_reports WHERE order_id = o_id) THEN
  ${sig("Performed diagnostic work cannot be cancelled as unperformed")}
END IF;
SELECT ch.id, ch.initial_status, ch.amount_paise INTO c_id, c_initial_status, c_amount_paise FROM charges ch JOIN care_billing_events b ON CAST(b.id AS CHAR) = ch.source_event_id WHERE b.order_id = o_id LIMIT 1;
IF c_id IS NOT NULL THEN
  IF c_initial_status <> 'PENDING' OR EXISTS(SELECT 1 FROM charge_finalizations WHERE charge_id = c_id) THEN
    ${sig("Only original pending source can receive unperformed disposition")}
  END IF;
  IF c_amount_paise > 0 THEN
    SELECT id, charge_id, amount_paise INTO r_id, r_charge_id, r_amount_paise FROM charge_reversals WHERE id = NEW.reversal_id;
    IF r_id IS NULL OR r_charge_id <> c_id OR r_amount_paise <> c_amount_paise OR (SELECT COALESCE(SUM(amount_paise), 0) FROM charge_reversals WHERE charge_id = c_id) <> c_amount_paise THEN
      ${sig("Disposition must reverse the exact original source amount")}
    END IF;
  ELSEIF NEW.reversal_id IS NOT NULL THEN
    ${sig("Zero-price source needs no fake reversal")}
  END IF;
ELSEIF NEW.reversal_id IS NOT NULL THEN
  ${sig("Disposition cannot reverse a missing source")}
END IF;
`,
});

// ======================================================================================================
// guard_lab_source -> lab_samples_source / lab_processing_source / lab_reports_source
// ======================================================================================================
for (const table of ["lab_samples", "lab_processing", "lab_reports"]) {
  const name = `${table}_source`;
  let mid;
  if (table === "lab_samples") {
    mid = `IF o_kind <> 'LAB' OR NEW.patient_id <> e_patient_id OR EXISTS(SELECT 1 FROM clinical_task_events WHERE order_id = o_id AND status = 'STOPPED') THEN
  ${sig("Sample patient/order mismatch or stopped source")}
END IF;`;
  } else {
    mid = `SELECT id INTO s_id FROM lab_samples WHERE order_id = o_id LIMIT 1;
IF (o_kind = 'LAB' AND (s_id IS NULL OR NOT (NEW.sample_id <=> s_id))) OR (o_kind = 'RADIOLOGY' AND NEW.sample_id IS NOT NULL) THEN
  ${sig("Diagnostic sample binding mismatch")}
END IF;`;
    if (table === "lab_processing") {
      mid += `
IF EXISTS(SELECT 1 FROM clinical_task_events WHERE order_id = o_id AND status = 'STOPPED') THEN
  ${sig("Doctor-stopped work cannot begin processing")}
END IF;`;
    } else {
      mid += `
SELECT id, sample_id INTO p_id, p_sample_id FROM lab_processing WHERE order_id = o_id LIMIT 1;
IF p_id IS NULL OR NOT (NEW.sample_id <=> p_sample_id) THEN
  ${sig("Actual processing is required before reporting")}
END IF;`;
    }
  }
  trig({
    name,
    table,
    pg: name,
    vars: [
      ["o_id", "UUID"], ["o_admission_id", "UUID"], ["o_kind", TX], ["e_patient_id", "UUID"], ["s_id", "UUID"],
      ["p_id", "UUID"], ["p_sample_id", "UUID"], ["e_id", "UUID"],
    ],
    body: `
SELECT id, admission_id, kind INTO o_id, o_admission_id, o_kind FROM clinical_orders WHERE id = NEW.order_id;
SELECT id, patient_id INTO e_id, e_patient_id FROM admissions WHERE id = o_admission_id FOR UPDATE;
IF o_kind NOT IN ('LAB','RADIOLOGY') OR NEW.admission_id <> o_admission_id THEN
  ${sig("Diagnostic order/episode mismatch")}
END IF;
${mid}
IF EXISTS(SELECT 1 FROM lab_dispositions WHERE order_id = o_id) THEN
  ${sig("Unperformed diagnostic order was disposed")}
END IF;
`,
  });
}

// ======================================================================================================
// guard_legacy_clinical_workflow -> aa_mvp_legacy_workflow on 22 tables (to_jsonb(NEW) probing resolved per table)
// ======================================================================================================
const legacy = {
  care_billing_events: {}, care_occurrences: {}, care_tasks: {},
  clinical_addenda: { via: ["note_id", "clinical_rounds"] }, clinical_orders: {}, clinical_rounds: {}, clinical_summaries: {},
  clinical_task_events: { via: ["order_id", "clinical_orders"] }, exception_evidence: {}, lab_dispositions: {}, lab_processing: {},
  lab_report_addenda: { via: ["report_id", "lab_reports"] }, lab_reports: {}, lab_samples: {}, medication_administrations: {},
  nursing_addenda: {}, nursing_consumables: {}, nursing_observations: {},
  pharmacy_movements: { adm: true, via: ["order_id", "clinical_orders"] }, pharmacy_preparations: {},
  transfer_order_cancellations: {}, transfer_orders: {},
};
for (const [table, cfg] of Object.entries(legacy)) {
  // admission_id is NOT NULL on every legacy table except pharmacy_movements; tables without it probe order_id/note_id/report_id.
  const hasAdm = !cfg.via || cfg.adm;
  const lookup = cfg.via
    ? `IF episode IS NULL THEN
  SELECT admission_id INTO episode FROM ${cfg.via[1]} WHERE id = NEW.${cfg.via[0]};
END IF;`
    : "";
  trig({
    name: `aa_mvp_legacy_workflow_${table}`,
    table,
    pg: "aa_mvp_legacy_workflow",
    vars: [["l_key", V], ["episode", "UUID"], ["e_id", "UUID"]],
    body: `
${SHARED_SETTINGS_LOCK}
SET episode = ${hasAdm ? "NEW.admission_id" : "NULL"};
${lookup}
IF episode IS NOT NULL THEN
  ${lockAdm("episode")}
  IF EXISTS(SELECT 1 FROM admissions WHERE id = episode AND workflow_version <> 1) THEN
    ${sig("Legacy chart, Doctor-login and native department sources require a version 1 episode")}
  END IF;
END IF;
`,
  });
}

// ---- output ---------------------------------------------------------------------------------------------
const names = new Set();
for (const b of blocks) {
  if (names.has(b.name)) throw new Error(`duplicate trigger name ${b.name}`);
  names.add(b.name);
}
const header = `-- T1.sql: MariaDB 11.8 port of the PostgreSQL trigger group T1 (generated by T1.gen.mjs; do not hand-edit).
-- Source functions: check_pharmacy_stock_ledger .. guard_legacy_clinical_workflow (dump lines 59-625), see below.
-- Each block starts with a header comment line and ends with '-- END TRIGGER'. A block is one DROP TRIGGER IF EXISTS
-- statement (ends with ';') followed by one CREATE TRIGGER statement that ends at its final 'END' line (no trailing
-- semicolon, no DELIMITER). Runner: send the DROP line, then the remaining text of the block, as separate statements.
-- Merge/order by (table, timing, event, pg_name); same-event triggers fire in creation order.
-- Lock key for pg_advisory_xact_lock_shared(729104211) is hims_locks.lock_key = '729104211' (shared row lock);
-- the app's exclusive taker must use the same key string '729104211'.
-- Not here (CONSTRAINT TRIGGERs, see docs/agent/MARIADB_PORT_GAPS.md): closed_charge_result, closed_reversal_result,
-- pharmacy_movement_matches_stock, pharmacy_stock_matches_ledger.
-- Errors: SIGNAL SQLSTATE '45000' (errno 1644) with the original PostgreSQL message text; ERRCODE 23514 is not carried.

`;
fs.writeFileSync(path.join(here, "T1.sql"), header + blocks.map((b) => b.text).join("\n"));
console.log(`wrote ${blocks.length} MariaDB triggers`);
