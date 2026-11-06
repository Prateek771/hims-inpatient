-- 0002_helpers.sql: MariaDB 11.8 port of the 8 NON-trigger PL/pgSQL functions of the `hims` schema.
-- Idempotent (DROP FUNCTION IF EXISTS before each CREATE), no schema prefix, same names, same parameter order.
-- Statements are separated with `DELIMITER $$` (mariadb client syntax). A programmatic runner must honour the
-- DELIMITER directive (or split on lines that are exactly `$$`).
--
-- CALL FORMS (all are FUNCTIONS, so they work in triggers, other functions and plain SQL):
--   Former `RETURNS void` functions return TINYINT 1 and are called for their side effect / error. In a trigger or
--   routine body use a plain assignment (PERFORM equivalent):
--     SET @ignored = assert_planned_exit_instruction(episode_uuid, evidence_ids_json);
--     SET @ignored = mvp_finance_guard(episode_uuid, payload_json);
--     SET @ignored = invalidate_clearances(episode_uuid, first_gate, changed_kind, changed_ids_json);
--   DO NOT use `DO fn(...)`: MariaDB's DO statement swallows the function's SIGNAL (it becomes a warning and the
--   triggering statement succeeds). Verified in a scratch trigger: `SET @ignored = fn(...)` raises errno 1644 as intended.
--   Value functions:
--     SET v = mvp_assigned(episode_uuid, staff_id);               -- TINYINT 1/0 (was boolean)
--     SET v = mvp_current(episode_uuid, kind);                    -- UUID or NULL
--     SET v = mvp_current_responsibility(episode_uuid);           -- JSON text (LONGTEXT); read with JSON_VALUE(v,'$.decisionId'),
--                                                                 --   JSON_VALUE(v,'$.responsibility.allocationComplete') (see boolean note)
--     SET v = mvp_delay_allocation_amendment(episode_uuid, decision_uuid); -- UUID or NULL
--     SET v = mvp_economic_basis(episode_uuid);                   -- 64 lowercase hex chars (SHA-256)
--
-- NOTES FOR CALLERS
--  * Errors: every RAISE EXCEPTION became SIGNAL SQLSTATE '45000' (errno 1644) with the original MESSAGE_TEXT
--    (the original ERRCODE 23514 is not carried; match on the message).
--  * jsonb arguments are JSON/LONGTEXT. `jsonb ? text` (key or string-element membership) is implemented inside
--    assert_planned_exit_instruction for BOTH an array of id strings and an object keyed by id.
--  * JSON booleans: MariaDB JSON_VALUE returns 1/0 (not 'true'/'false') for JSON true/false, and 'true'/'false'
--    for the JSON *strings* "true"/"false". Compare with `IN ('true','1')` when testing a boolean flag.
--    mvp_current_responsibility emits real JSON true/false for stale/allocationComplete.
--  * JSON_OBJECT quotes bare routine variables of numeric type as strings ({"a": "5"}); add `+ 0` (var + 0) when a JSON
--    number is wanted. Booleans: build with JSON_EXTRACT('[true]','$[0]') / JSON_EXTRACT('[false]','$[0]').
--  * Text parameters are declared utf8mb4_nopad_bin to match the tables (case/space-sensitive like PostgreSQL text).
--  * Tie-break ordering on uuid ids uses CAST(id AS CHAR) so ordering is the PostgreSQL byte order of the canonical
--    text form (the native UUID type sorts by time-segment order instead).
--  * mvp_finance_guard / invalidate_clearances take row locks (SELECT ... FOR UPDATE on admissions) and invalidate_clearances
--    writes mvp_invalidations / clearance_invalidations, exactly as the PostgreSQL versions did.
--  * mvp_finance_guard reads the view `effective_room_vacations` (0003_views.sql); apply order 0001, 0002, 0003 is
--    fine because routine bodies resolve tables at call time.

DELIMITER $$

DROP FUNCTION IF EXISTS assert_planned_exit_instruction$$
CREATE FUNCTION assert_planned_exit_instruction(episode UUID, selected LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)
RETURNS TINYINT
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_last_return DATETIME(6) DEFAULT NULL;
  DECLARE v_selected_ok TINYINT DEFAULT 0;

  IF EXISTS (
    SELECT 1 FROM exception_evidence p
    WHERE p.admission_id = episode AND p.kind = 'RETURN_TO_BED'
      AND NOT EXISTS (SELECT 1 FROM exception_evidence c WHERE c.kind = 'RETURN_CANCELLED' AND c.source_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM room_returns r WHERE r.doctor_evidence_id = p.id)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planned departure requires actual return or source-bound Doctor reconsideration';
  END IF;

  SELECT MAX(returned_at) INTO v_last_return FROM room_returns WHERE admission_id = episode;

  IF v_last_return IS NOT NULL THEN
    -- selected ? p.id::text : id appears as an object key or as a string element of an array
    SELECT EXISTS (
      SELECT 1 FROM exception_evidence p
      WHERE p.admission_id = episode AND p.role = 'DOCTOR' AND p.kind = 'PLANNED_EXIT'
        AND (JSON_CONTAINS_PATH(selected, 'one', CONCAT('$."', p.id, '"'))
             OR JSON_CONTAINS(selected, JSON_QUOTE(CAST(p.id AS CHAR))))
        AND p.actual_at >= v_last_return AND p.signed_at >= v_last_return
    ) INTO v_selected_ok;
    IF NOT v_selected_ok THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual return requires fresh appropriate Doctor exit disposition';
    END IF;
  END IF;
  RETURN 1;
END$$

DROP FUNCTION IF EXISTS invalidate_clearances$$
CREATE FUNCTION invalidate_clearances(
  episode UUID,
  first_gate TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin,
  changed_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin,
  changed_ids LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)
RETURNS TINYINT
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_version INT DEFAULT NULL;
  DECLARE v_ids_text LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

  SELECT workflow_version INTO v_version FROM admissions WHERE id = episode FOR UPDATE;

  IF v_version = 2 THEN
    IF EXISTS (SELECT 1 FROM admissions WHERE id = episode AND status = 'DISCHARGED') THEN
      RETURN 1;
    END IF;
    -- jsonb::text prints normalised `["a", "b"]`; JSON_EXTRACT gives the same separators.
    SET v_ids_text = JSON_EXTRACT(changed_ids, '$');
    INSERT INTO mvp_invalidations (event_id, kind, source_id)
    SELECT e.id, changed_kind, v_ids_text FROM mvp_events e
    WHERE e.admission_id = episode
      AND (e.action = 'finance'
           OR (e.action IN ('check', 'n-a')
               AND ((first_gate = 'PHARMACY' AND e.check_key = 'PHARMACY')
                    OR (first_gate = 'NURSING' AND e.check_key = 'NURSING')
                    OR (changed_kind LIKE 'insurance%' AND e.check_key = 'INSURANCE'))))
      AND NOT EXISTS (SELECT 1 FROM mvp_invalidations i WHERE i.event_id = e.id);
    RETURN 1;
  END IF;

  -- array_position(ARRAY[gates], x) is NULL for an unknown gate: NULLIF(FIELD(),0) keeps that behaviour.
  INSERT INTO clearance_invalidations (seal_id, change_kind, changed_record_ids)
  SELECT s.id, changed_kind, changed_ids FROM clearance_seals s
  WHERE s.admission_id = episode
    AND NULLIF(FIELD(s.gate, 'DOCTOR', 'PHARMACY', 'NURSING', 'BILLING'), 0)
        >= NULLIF(FIELD(first_gate, 'DOCTOR', 'PHARMACY', 'NURSING', 'BILLING'), 0)
    AND NOT EXISTS (SELECT 1 FROM clearance_invalidations i WHERE i.seal_id = s.id);
  RETURN 1;
END$$

DROP FUNCTION IF EXISTS mvp_assigned$$
CREATE FUNCTION mvp_assigned(episode UUID, actor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin)
RETURNS TINYINT
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_user u JOIN nurse_assignments a ON a.nurse_id = u.id
    WHERE u.id = actor AND u.role = 'NURSE' AND NOT COALESCE(u.banned, 0)
      AND a.admission_id = episode
      AND NOT EXISTS (SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = a.id));
END$$

DROP FUNCTION IF EXISTS mvp_current$$
CREATE FUNCTION mvp_current(episode UUID, kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin)
RETURNS UUID
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_id UUID DEFAULT NULL;
  DECLARE v_clinical UUID DEFAULT NULL;
  DECLARE v_checklist UUID DEFAULT NULL;
  DECLARE v_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_approval UUID DEFAULT NULL;
  DECLARE v_latest_checklist UUID DEFAULT NULL;
  DECLARE v_ok TINYINT DEFAULT NULL;

  SELECT e.id, e.clinical_id, e.checklist_id, e.status
    INTO v_id, v_clinical, v_checklist, v_status
  FROM mvp_events e
  WHERE e.admission_id = episode
    AND (CASE WHEN kind IN ('doctor-approval', 'checklist', 'finance') THEN e.action = kind
              ELSE e.action IN ('check', 'n-a') AND e.check_key = kind END)
  ORDER BY e.recorded_at DESC, CAST(e.id AS CHAR) DESC
  LIMIT 1;

  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM mvp_invalidations i WHERE i.event_id = v_id) THEN RETURN NULL; END IF;

  SELECT id INTO v_approval FROM mvp_events
   WHERE admission_id = episode AND action = 'doctor-approval'
   ORDER BY recorded_at DESC, CAST(id AS CHAR) DESC LIMIT 1;
  SELECT id INTO v_latest_checklist FROM mvp_events
   WHERE admission_id = episode AND action = 'checklist'
   ORDER BY recorded_at DESC, CAST(id AS CHAR) DESC LIMIT 1;

  SET v_ok = (kind = 'doctor-approval' OR v_clinical = v_approval)
         AND (kind IN ('doctor-approval', 'checklist') OR v_checklist = v_latest_checklist)
         AND (kind IN ('doctor-approval', 'checklist', 'finance') OR v_status IN ('COMPLETE', 'NA'));
  IF v_ok IS TRUE THEN RETURN v_id; END IF;
  RETURN NULL;
END$$

DROP FUNCTION IF EXISTS mvp_economic_basis$$
CREATE FUNCTION mvp_economic_basis(episode UUID)
RETURNS TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_old_len BIGINT UNSIGNED;
  DECLARE v_charges LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
  DECLARE v_reversals LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

  -- GROUP_CONCAT silently truncates at group_concat_max_len; raise it for the duration of this call.
  SET v_old_len = @@session.group_concat_max_len;
  SET SESSION group_concat_max_len = 1073741824;

  SET v_charges = COALESCE((
    SELECT GROUP_CONCAT(
      CONCAT('{"id":"', c.id, '","source":', JSON_QUOTE(c.source_event_id),
             ',"status":"', CASE WHEN c.initial_status = 'FINAL'
                                   OR EXISTS (SELECT 1 FROM charge_finalizations f WHERE f.charge_id = c.id)
                                 THEN 'FINAL' ELSE 'PENDING' END,
             '","amount":"', c.amount_paise, '","tariff":"', c.tariff_version_id, '"}')
      ORDER BY c.created_at, CAST(c.id AS CHAR) SEPARATOR ',')
    FROM charges c WHERE c.admission_id = episode), '');

  SET v_reversals = COALESCE((
    SELECT GROUP_CONCAT(
      CONCAT('{"id":"', r.id, '","chargeId":"', r.charge_id, '","amount":"', r.amount_paise, '"}')
      ORDER BY CAST(r.id AS CHAR) SEPARATOR ',')
    FROM charge_reversals r JOIN charges c ON c.id = r.charge_id WHERE c.admission_id = episode), '');

  SET SESSION group_concat_max_len = v_old_len;
  RETURN SHA2(CONCAT('{"charges":[', v_charges, '],"reversals":[', v_reversals, ']}'), 256);
END$$

DROP FUNCTION IF EXISTS mvp_delay_allocation_amendment$$
CREATE FUNCTION mvp_delay_allocation_amendment(episode UUID, decision UUID)
RETURNS UUID
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_result UUID DEFAULT NULL;

  SELECT m.id INTO v_result
  FROM mvp_exceptional_departures departure
  JOIN mvp_exception_events authority ON authority.id = departure.authority_id
  JOIN insurance_cases c ON c.admission_id = departure.admission_id
                        AND c.id = JSON_VALUE(authority.payload, '$.sourceId')
  JOIN insurance_decisions d ON d.case_id = c.id AND d.id = decision
  JOIN post_discharge_amendments m ON m.admission_id = departure.admission_id AND m.kind = 'INSURANCE_DECISION'
                                  AND m.source_id = c.id AND m.result_id = d.id
  JOIN admin_exceptions a ON a.id = m.exception_id AND a.admission_id = m.admission_id
                         AND a.type = 'POST_DISCHARGE_CORRECTION' AND a.disposition = 'AMEND'
                         AND a.correction_kind = 'INSURANCE_DECISION' AND a.source_id = c.id
  WHERE departure.admission_id = episode AND authority.type = 'INSURANCE_DELAY'
    -- ((payload->financial->responsibility->>allocationComplete)::boolean IS DISTINCT FROM true)
    AND COALESCE(JSON_VALUE(authority.payload, '$.financial.responsibility.allocationComplete') IN ('true', '1'), 0) = 0
    AND d.id = (SELECT x.id FROM insurance_decisions x WHERE x.case_id = c.id
                ORDER BY x.case_version DESC LIMIT 1)
    AND a.signed_at >= departure.departed_at AND m.signed_at >= a.signed_at AND d.recorded_at >= a.signed_at
  ORDER BY m.signed_at DESC, CAST(m.id AS CHAR) DESC
  LIMIT 1;

  RETURN v_result;
END$$

DROP FUNCTION IF EXISTS mvp_current_responsibility$$
CREATE FUNCTION mvp_current_responsibility(episode UUID)
RETURNS LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_case_id UUID DEFAULT NULL;
  DECLARE v_review_revision INT DEFAULT NULL;
  DECLARE v_dec_id UUID DEFAULT NULL;
  DECLARE v_dec_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_dec_policy UUID DEFAULT NULL;
  DECLARE v_dec_approved BIGINT DEFAULT NULL;
  DECLARE v_dec_bps INT DEFAULT NULL;
  DECLARE v_dec_alloc LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_policy_id UUID DEFAULT NULL;
  DECLARE v_conv_id UUID DEFAULT NULL;
  DECLARE v_conv_alloc LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_review_id UUID DEFAULT NULL;
  DECLARE v_review_insurer BIGINT DEFAULT NULL;
  DECLARE v_review_patient BIGINT DEFAULT NULL;
  DECLARE v_review_basis TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_review_net BIGINT DEFAULT NULL;
  DECLARE v_basis TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_current_basis TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_current_net DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_net DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_eligible DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_insurer DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_patient DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_unallocated DECIMAL(38,0) DEFAULT 0;
  DECLARE v_copay DECIMAL(38,0) DEFAULT 0;
  DECLARE v_nonpayable DECIMAL(38,0) DEFAULT 0;
  DECLARE v_patient_cash DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_insurer_cash DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_patient_applied DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_stale TINYINT DEFAULT 0;
  DECLARE v_complete TINYINT DEFAULT 0;
  DECLARE v_known TINYINT DEFAULT 0;
  DECLARE v_resp LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

  SELECT payment_route INTO v_route FROM admissions WHERE id = episode;
  SET v_basis = mvp_economic_basis(episode);

  SELECT COALESCE(SUM(ch.amount_paise - COALESCE((SELECT SUM(rv.amount_paise) FROM charge_reversals rv WHERE rv.charge_id = ch.id), 0)), 0)
    INTO v_net
  FROM charges ch
  WHERE ch.admission_id = episode
    AND (ch.initial_status = 'FINAL' OR EXISTS (SELECT 1 FROM charge_finalizations cf WHERE cf.charge_id = ch.id));

  SELECT id, review_revision INTO v_case_id, v_review_revision FROM insurance_cases WHERE admission_id = episode LIMIT 1;

  SELECT id, status, policy_event_id, approved_paise, co_pay_bps, allocation
    INTO v_dec_id, v_dec_status, v_dec_policy, v_dec_approved, v_dec_bps, v_dec_alloc
  FROM insurance_decisions WHERE case_id = v_case_id ORDER BY case_version DESC LIMIT 1;

  SELECT id INTO v_policy_id FROM insurance_events
   WHERE case_id = v_case_id AND kind = 'POLICY' ORDER BY case_version DESC LIMIT 1;

  SELECT id, allocation INTO v_conv_id, v_conv_alloc FROM insurance_conversions WHERE case_id = v_case_id LIMIT 1;

  SELECT id, insurer_paise, patient_paise, bill_basis, net_paise
    INTO v_review_id, v_review_insurer, v_review_patient, v_review_basis, v_review_net
  FROM self_pay_reviews WHERE admission_id = episode ORDER BY created_at DESC, CAST(id AS CHAR) DESC LIMIT 1;

  SET v_current_basis = COALESCE(JSON_VALUE(v_conv_alloc, '$.billBasis'), JSON_VALUE(v_dec_alloc, '$.billBasis'));
  SET v_current_net = COALESCE(CAST(JSON_VALUE(v_conv_alloc, '$.netBillPaise') AS DECIMAL(38,0)),
                               CAST(JSON_VALUE(v_dec_alloc, '$.netBillPaise') AS DECIMAL(38,0)));

  IF v_route = 'SELF_PAY' THEN
    SET v_known = 1, v_insurer = 0, v_patient = v_net;
    IF v_conv_id IS NOT NULL THEN
      IF v_review_id IS NOT NULL THEN
        SET v_insurer = v_review_insurer, v_patient = v_review_patient,
            v_current_basis = v_review_basis, v_current_net = v_review_net;
      ELSE
        SET v_insurer = CAST(JSON_VALUE(v_conv_alloc, '$.retainedInsurerLiabilityPaise') AS DECIMAL(38,0)),
            v_patient = CAST(JSON_VALUE(v_conv_alloc, '$.verifiedPatientLiabilityPaise') AS DECIMAL(38,0));
      END IF;
    END IF;
  ELSEIF v_dec_id IS NOT NULL THEN
    SET v_known = 1;
    SET v_eligible = CAST(JSON_VALUE(v_dec_alloc, '$.eligibleBillPaise') AS DECIMAL(38,0));
    SET v_copay = FLOOR((v_eligible * v_dec_bps + 5000) / 10000);
    SET v_nonpayable = CAST(JSON_VALUE(v_dec_alloc, '$.netBillPaise') AS DECIMAL(38,0)) - v_eligible;
    -- least() ignores NULL arguments in PostgreSQL
    SET v_insurer = COALESCE(LEAST(v_dec_approved, v_eligible - v_copay), v_dec_approved, v_eligible - v_copay);
    SET v_patient = COALESCE(CAST(JSON_VALUE(v_dec_alloc, '$.verifiedPatientLiabilityPaise') AS DECIMAL(38,0)),
                             v_copay + v_nonpayable);
    SET v_unallocated = CAST(JSON_VALUE(v_dec_alloc, '$.netBillPaise') AS DECIMAL(38,0)) - v_insurer - v_patient;
  END IF;

  IF v_conv_id IS NOT NULL OR v_dec_id IS NOT NULL THEN
    SET v_stale = NOT (v_current_basis <=> v_basis) OR NOT (v_current_net <=> v_net)
                  OR (v_route = 'INSURED' AND NOT (v_policy_id <=> v_dec_policy));
  END IF;

  SELECT COALESCE(SUM(CASE WHEN q.party = 'PATIENT' THEN q.net_amount END), 0),
         COALESCE(SUM(CASE WHEN q.party = 'INSURER' THEN q.net_amount END), 0),
         COALESCE(SUM(CASE WHEN q.party = 'PATIENT' AND q.kind = 'PAYMENT' THEN q.net_amount END), 0)
    INTO v_patient_cash, v_insurer_cash, v_patient_applied
  FROM (SELECT r.party, r.kind,
               r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0) AS net_amount
        FROM receipts r WHERE r.admission_id = episode) q;

  SELECT v_patient_applied + COALESCE(SUM(a.amount_paise), 0) INTO v_patient_applied
  FROM receipt_allocations a JOIN receipts r ON r.id = a.receipt_id
  WHERE r.admission_id = episode
    AND NOT EXISTS (SELECT 1 FROM allocation_cancellations x WHERE x.allocation_id = a.id);

  SET v_complete = v_known AND NOT v_stale AND v_unallocated = 0 AND (v_route = 'SELF_PAY' OR v_dec_status <> 'PENDING');

  IF v_known THEN
    SET v_resp = JSON_OBJECT(
      'insurerPaise', CAST(v_insurer AS CHAR),
      'patientPaise', CAST(v_patient AS CHAR),
      'unallocatedPaise', CAST(v_unallocated AS CHAR),
      'coPayPaise', CAST(v_copay AS CHAR),
      'nonPayablePaise', CAST(v_nonpayable AS CHAR),
      'stale', CASE WHEN v_stale IS NULL THEN NULL WHEN v_stale THEN JSON_EXTRACT('[true]', '$[0]') ELSE JSON_EXTRACT('[false]', '$[0]') END,
      'allocationComplete', CASE WHEN v_complete IS NULL THEN NULL WHEN v_complete THEN JSON_EXTRACT('[true]', '$[0]') ELSE JSON_EXTRACT('[false]', '$[0]') END,
      'insurerOutstandingPaise', CAST(COALESCE(GREATEST(v_insurer - v_insurer_cash, 0), 0) AS CHAR),
      'patientOutstandingPaise', CAST(COALESCE(GREATEST(v_patient - v_patient_applied, 0), 0) AS CHAR),
      'insurerExcessPaise', CAST(COALESCE(GREATEST(v_insurer_cash - v_insurer, 0), 0) AS CHAR),
      'patientExcessPaise', CAST(COALESCE(GREATEST(v_patient_cash - v_patient, 0), 0) AS CHAR));
  END IF;

  RETURN JSON_OBJECT(
    'responsibility', JSON_EXTRACT(v_resp, '$'),
    'caseId', v_case_id,
    'reviewRevision', v_review_revision + 0, -- + 0: JSON_OBJECT quotes bare routine variables as strings
    'policyId', v_policy_id,
    'decisionId', v_dec_id,
    'conversionId', v_conv_id,
    'selfPayReviewId', v_review_id,
    'insurerAuthorizedPaise', CAST(COALESCE(v_dec_approved, 0) AS CHAR));
END$$

DROP FUNCTION IF EXISTS mvp_finance_guard$$
CREATE FUNCTION mvp_finance_guard(episode UUID, selected LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)
RETURNS TINYINT
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_bill_revision INT DEFAULT NULL;
  DECLARE v_case_id UUID DEFAULT NULL;
  DECLARE v_dec_id UUID DEFAULT NULL;
  DECLARE v_dec_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_dec_policy UUID DEFAULT NULL;
  DECLARE v_dec_approved BIGINT DEFAULT NULL;
  DECLARE v_dec_bps INT DEFAULT NULL;
  DECLARE v_dec_alloc LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_latest_policy UUID DEFAULT NULL;
  DECLARE v_net DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_ins DECIMAL(38,0) DEFAULT 0;
  DECLARE v_patient DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_patient_cash DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_patient_applied DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_insurer_cash DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_deposits DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_allocated DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_eligible DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_copay DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_conv_ins DECIMAL(38,0) DEFAULT NULL;
  DECLARE v_conv_patient DECIMAL(38,0) DEFAULT NULL;

  SELECT payment_route, bill_revision INTO v_route, v_bill_revision FROM admissions WHERE id = episode FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM effective_room_vacations WHERE admission_id = episode)
     OR EXISTS (SELECT 1
                FROM (SELECT 'NURSING' AS k UNION ALL SELECT 'PHARMACY' UNION ALL SELECT 'INSURANCE' UNION ALL SELECT 'DIAGNOSTICS') ks
                WHERE mvp_current(episode, ks.k) IS NULL)
     OR EXISTS (SELECT 1 FROM charges ch
                WHERE ch.admission_id = episode AND ch.initial_status = 'PENDING'
                  AND NOT EXISTS (SELECT 1 FROM charge_finalizations f WHERE f.charge_id = ch.id)
                  AND ch.amount_paise > COALESCE((SELECT SUM(rv.amount_paise) FROM charge_reversals rv WHERE rv.charge_id = ch.id), 0))
     OR EXISTS (SELECT 1 FROM transfer_insurance_tasks t
                WHERE t.admission_id = episode
                  AND NOT EXISTS (SELECT 1 FROM insurance_transfer_resolutions r WHERE r.task_id = t.id))
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current applicable checks, actual vacancy and reconciled sources required';
  END IF;

  SELECT COALESCE(SUM(ch.amount_paise - COALESCE((SELECT SUM(rv.amount_paise) FROM charge_reversals rv WHERE rv.charge_id = ch.id), 0)), 0)
    INTO v_net
  FROM charges ch
  WHERE ch.admission_id = episode
    AND (ch.initial_status = 'FINAL' OR EXISTS (SELECT 1 FROM charge_finalizations cf WHERE cf.charge_id = ch.id));
  SET v_patient = v_net;

  IF v_route = 'INSURED' THEN
    SELECT id INTO v_case_id FROM insurance_cases WHERE admission_id = episode LIMIT 1;
    SELECT id, status, policy_event_id, approved_paise, co_pay_bps, allocation
      INTO v_dec_id, v_dec_status, v_dec_policy, v_dec_approved, v_dec_bps, v_dec_alloc
    FROM insurance_decisions WHERE case_id = v_case_id ORDER BY case_version DESC LIMIT 1;
    SELECT id INTO v_latest_policy FROM insurance_events
     WHERE case_id = v_case_id AND kind = 'POLICY' ORDER BY case_version DESC LIMIT 1;

    IF v_dec_id IS NULL OR v_dec_status = 'PENDING'
       OR NOT (CAST(JSON_VALUE(v_dec_alloc, '$.netBillPaise') AS DECIMAL(38,0)) <=> v_net)
       OR NOT (JSON_VALUE(selected, '$.financial.decisionId') <=> CAST(v_dec_id AS CHAR))
       OR NOT (v_dec_policy <=> v_latest_policy)
    THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current externally verified accepted responsibility required';
    END IF;
    SET v_eligible = CAST(JSON_VALUE(v_dec_alloc, '$.eligibleBillPaise') AS DECIMAL(38,0));
    SET v_copay = FLOOR((v_eligible * v_dec_bps + 5000) / 10000);
    SET v_ins = COALESCE(LEAST(v_dec_approved, v_eligible - v_copay), v_dec_approved, v_eligible - v_copay);
    SET v_patient = COALESCE(CAST(JSON_VALUE(v_dec_alloc, '$.verifiedPatientLiabilityPaise') AS DECIMAL(38,0)),
                             v_copay + v_net - v_eligible);
  ELSE
    IF EXISTS (SELECT 1 FROM insurance_conversions x JOIN insurance_cases cc ON cc.id = x.case_id WHERE cc.admission_id = episode) THEN
      -- Self-pay conversions retain their reviewed historical external liability; no fabricated cash.
      SELECT COALESCE(CAST(JSON_VALUE(x.allocation, '$.retainedInsurerLiabilityPaise') AS DECIMAL(38,0)), 0),
             COALESCE(CAST(JSON_VALUE(x.allocation, '$.verifiedPatientLiabilityPaise') AS DECIMAL(38,0)), v_net)
        INTO v_conv_ins, v_conv_patient
      FROM insurance_conversions x JOIN insurance_cases cc ON cc.id = x.case_id
      WHERE cc.admission_id = episode LIMIT 1;
      SET v_ins = v_conv_ins, v_patient = v_conv_patient;
    END IF;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN q.party = 'PATIENT' THEN q.net_amount END), 0),
         COALESCE(SUM(CASE WHEN q.party = 'INSURER' THEN q.net_amount END), 0),
         COALESCE(SUM(CASE WHEN q.kind <> 'PAYMENT' THEN q.net_amount END), 0),
         COALESCE(SUM(CASE WHEN q.party = 'PATIENT' AND q.kind = 'PAYMENT' THEN q.net_amount END), 0)
    INTO v_patient_cash, v_insurer_cash, v_deposits, v_patient_applied
  FROM (SELECT r.party, r.kind,
               r.amount_paise - COALESCE((SELECT SUM(f.amount_paise) FROM receipt_refunds f WHERE f.receipt_id = r.id), 0) AS net_amount
        FROM receipts r WHERE r.admission_id = episode) q;

  SELECT COALESCE(SUM(a.amount_paise), 0) INTO v_allocated
  FROM receipt_allocations a JOIN receipts r ON r.id = a.receipt_id
  WHERE r.admission_id = episode
    AND NOT EXISTS (SELECT 1 FROM allocation_cancellations x WHERE x.allocation_id = a.id);
  SET v_patient_applied = v_patient_applied + v_allocated;

  IF v_ins < 0 OR v_patient < 0 OR v_ins + v_patient <> v_net OR v_patient_applied <> v_patient
     OR v_patient_cash <> v_patient OR v_insurer_cash > v_ins OR v_deposits <> v_allocated
     OR NOT (CAST(JSON_VALUE(selected, '$.bill.revision') AS SIGNED) <=> v_bill_revision)
     OR NOT (CAST(JSON_VALUE(selected, '$.bill.netPaise') AS DECIMAL(38,0)) <=> v_net)
     OR NOT (CAST(JSON_VALUE(selected, '$.financial.responsibility.insurerPaise') AS DECIMAL(38,0)) <=> v_ins)
     OR NOT (CAST(JSON_VALUE(selected, '$.financial.responsibility.patientPaise') AS DECIMAL(38,0)) <=> v_patient)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact reconciled patient settlement and accepted insurer responsibility required; receivable is distinct from cash';
  END IF;
  RETURN 1;
END$$

DELIMITER ;
