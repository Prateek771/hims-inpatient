-- NOTE: the shared settings/staff lock ('729104211') that PostgreSQL triggers took is NOT taken here: every command takes it
-- first (admissionOperator), and trigger-level shared locks deadlocked with queued exclusive takers under concurrency.
-- T2.sql: MariaDB 11.8 port of PostgreSQL trigger group T2 (guard_mvp_closed_receipt .. guard_pharmacy_batch_identity).
-- Source: tmp/port/pg-final-schema.sql. 28 PostgreSQL triggers -> 25 MariaDB triggers (one per event; none needed splitting).
-- The 3 CONSTRAINT TRIGGERs (mvp_closed_receipt, mvp_external_charge_pair, mvp_transfer_effects) cannot exist in MariaDB;
-- they are documented in docs/agent/MARIADB_PORT_GAPS.md (T2 section) with the query the app runs before COMMIT.
-- Requires 0001_tables.sql, 0002_helpers.sql and 0003_views.sql.
-- Block format: header line, DROP TRIGGER IF EXISTS, one CREATE TRIGGER (no DELIMITER), '-- END TRIGGER'.
--
-- Translation rules used in every block
--  * RAISE EXCEPTION -> SIGNAL SQLSTATE '45000' with the identical message text (ERRCODE 23514 is not carried).
--  * pg_advisory_xact_lock[_shared](k) -> hims_locks row lock (INSERT IGNORE + SELECT .. LOCK IN SHARE MODE / FOR UPDATE).
--    Keys: '729104211' (shared settings/staff lock), 'availability-coordinator', 'doctor-directory:<uuid>', 'patient-identification:<uuid>'.
--  * SELECT .. INTO row variables -> scalar v_ variables; SELECT .. FOR SHARE -> LOCK IN SHARE MODE.
--  * PERFORM void_fn(..) -> SET @ignored = fn(..) (DO would swallow the SIGNAL).
--  * jsonb ->> -> JSON_VALUE(.. ) COLLATE utf8mb4_nopad_bin (JSON columns are utf8mb4_bin); JSON booleans come back as '1'/'0'.
--  * payload/snapshot ISO timestamps (->> ::timestamptz) are parsed with a CASE: trailing Z stripped, +hh:mm offsets converted to UTC.
--    A malformed value parses to NULL and is rejected wherever the PostgreSQL cast would have raised.
--  * clock_timestamp() -> UTC_TIMESTAMP(6) (statement start time; session time zone is UTC).
--  * IS DISTINCT FROM -> NOT (a <=> b).  uuid ::text comparisons use CAST(.. AS CHAR) COLLATE utf8mb4_nopad_bin.
--  * WHEN (..) clauses and UPDATE OF col become IF .. LEAVE trg at the top of the body.
--  * UPDATE admissions SET version=version (row-lock idiom) -> SELECT .. FOR UPDATE (no write, no trigger firing).
--  * jsonb_set(NEW.payload, '{outstandingObligations}', ..) -> SET NEW.payload = JSON_SET(..) (allowed in BEFORE INSERT).
--  * The two mvp_transfer_* instruction triggers still UPDATE admissions SET version=version+1 (a different table: legal).

-- TRIGGER name=availability_coordinator_authority table=availability_coordinators timing=BEFORE event=INSERT pg_name=availability_coordinator_authority
DROP TRIGGER IF EXISTS `availability_coordinator_authority`;
CREATE TRIGGER `availability_coordinator_authority` BEFORE INSERT ON `availability_coordinators` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_actor_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_latest INT DEFAULT NULL;
  SELECT role INTO v_actor_role FROM staff_user WHERE id = NEW.recorded_by AND banned = 0 LOCK IN SHARE MODE;
  IF v_actor_role IS NULL OR NEW.recorded_at > UTC_TIMESTAMP(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active attributable staff required'; END IF;
  SET v_key = 'availability-coordinator';
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SET v_latest = (SELECT COALESCE(MAX(`version`), 0) FROM availability_coordinators);
  IF v_actor_role <> 'ADMIN' OR NEW.`version` <> v_latest + 1
     OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.nurse_id AND role = 'NURSE' AND banned = 0)
     OR (NEW.backup_nurse_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.backup_nurse_id AND role = 'NURSE' AND banned = 0))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Admin must designate active Nurse responsibility and backup'; END IF;
END
-- END TRIGGER

-- TRIGGER name=doctor_availability_authority table=doctor_availability timing=BEFORE event=INSERT pg_name=doctor_availability_authority
DROP TRIGGER IF EXISTS `doctor_availability_authority`;
CREATE TRIGGER `doctor_availability_authority` BEFORE INSERT ON `doctor_availability` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_actor_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_latest INT DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_nurse VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_backup VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_starts DATETIME(6) DEFAULT NULL;
  DECLARE v_c_ends DATETIME(6) DEFAULT NULL;
  SELECT role INTO v_actor_role FROM staff_user WHERE id = NEW.recorded_by AND banned = 0 LOCK IN SHARE MODE;
  IF v_actor_role IS NULL OR NEW.recorded_at > UTC_TIMESTAMP(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active attributable staff required'; END IF;
  -- The shared staff/roster lock and directory lock match the command lock order.
  SET v_key = 'availability-coordinator';
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SELECT id, nurse_id, backup_nurse_id, starts_at, ends_at INTO v_c_id, v_c_nurse, v_c_backup, v_c_starts, v_c_ends
    FROM availability_coordinators WHERE starts_at <= UTC_TIMESTAMP(6) AND ends_at > UTC_TIMESTAMP(6) ORDER BY `version` DESC LIMIT 1;
  SET v_key = CONCAT('doctor-directory:', NEW.doctor_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SET v_latest = (SELECT COALESCE(MAX(`version`), 0) FROM doctor_availability WHERE doctor_id = NEW.doctor_id);
  IF v_actor_role <> 'NURSE' OR v_c_id IS NULL OR NOT (NEW.coordinator_id <=> v_c_id)
     OR (NOT (NEW.recorded_by <=> v_c_nurse) AND NOT (NEW.recorded_by <=> v_c_backup))
     OR NEW.starts_at < v_c_starts OR NEW.ends_at > v_c_ends OR NEW.`version` <> v_latest + 1
     OR NOT COALESCE((SELECT active FROM doctor_directory_versions WHERE doctor_id = NEW.doctor_id ORDER BY `version` DESC LIMIT 1), 0)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current designated Nurse and active Doctor availability version required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=doctor_directory_version_authority table=doctor_directory_versions timing=BEFORE event=INSERT pg_name=doctor_directory_version_authority
DROP TRIGGER IF EXISTS `doctor_directory_version_authority`;
CREATE TRIGGER `doctor_directory_version_authority` BEFORE INSERT ON `doctor_directory_versions` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_actor_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_latest INT DEFAULT NULL;
  SELECT role INTO v_actor_role FROM staff_user WHERE id = NEW.recorded_by AND banned = 0 LOCK IN SHARE MODE;
  IF v_actor_role IS NULL OR NEW.recorded_at > UTC_TIMESTAMP(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active attributable staff required'; END IF;
  SET v_key = CONCAT('doctor-directory:', NEW.doctor_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SET v_latest = (SELECT COALESCE(MAX(`version`), 0) FROM doctor_directory_versions WHERE doctor_id = NEW.doctor_id);
  IF v_actor_role <> 'ADMIN' OR NEW.`version` <> v_latest + 1
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current Admin and next Doctor directory version required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_episode_version table=admissions timing=BEFORE event=UPDATE pg_name=mvp_episode_version
DROP TRIGGER IF EXISTS `mvp_episode_version`;
CREATE TRIGGER `mvp_episode_version` BEFORE UPDATE ON `admissions` FOR EACH ROW
trg: BEGIN

  IF NOT (NEW.workflow_version <=> OLD.workflow_version) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Episode workflow cannot be silently reinterpreted'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_document_source table=discharge_documents timing=BEFORE event=INSERT pg_name=mvp_document_source
DROP TRIGGER IF EXISTS `mvp_document_source`;
CREATE TRIGGER `mvp_document_source` BEFORE INSERT ON `discharge_documents` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_banned TINYINT DEFAULT NULL;
  DECLARE v_a_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_clinical UUID DEFAULT NULL;
  DECLARE v_finance UUID DEFAULT NULL;
  DECLARE v_p_id UUID DEFAULT NULL;
  DECLARE v_p_version INT DEFAULT NULL;
  -- WHEN ((new.snapshot -> 'exception') IS NULL OR (new.snapshot -> 'exception') = 'null'::jsonb)
  IF NOT (COALESCE(JSON_TYPE(JSON_EXTRACT(NEW.snapshot, '$.exception')), 'NULL') = 'NULL') THEN LEAVE trg; END IF;
  SELECT id, role, banned, name INTO v_a_id, v_a_role, v_a_banned, v_a_name FROM staff_user WHERE id = NEW.created_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NEW.schema_version = 1 THEN
    IF v_e_wv <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MVP documents require explicit provenance schema'; END IF;
    LEAVE trg;
  END IF;
  IF v_e_wv <> 2 OR v_a_id IS NULL OR COALESCE(v_a_banned, 0) <> 0 OR NOT (v_a_role IN ('ADMIN','BILLING') OR mvp_assigned(v_e_id, v_a_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current authorized document staff required'; END IF;
  SET v_clinical = mvp_current(v_e_id, 'doctor-approval');
  SET v_finance = mvp_current(v_e_id, 'finance');
  IF v_e_status = 'DISCHARGED' THEN
    SET v_finance = (SELECT mvp_finance_id FROM departures WHERE admission_id = v_e_id LIMIT 1);
    SET v_clinical = (SELECT clinical_id FROM mvp_events WHERE id = v_finance);
  END IF;
  SELECT id, `version` INTO v_p_id, v_p_version FROM discharge_documents WHERE admission_id = v_e_id ORDER BY `version` DESC LIMIT 1;
  IF v_clinical IS NULL OR (NEW.kind = 'FINAL' AND v_finance IS NULL) OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.clinical.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_clinical AS CHAR) COLLATE utf8mb4_nopad_bin)) OR (NEW.kind = 'FINAL' AND NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.finance.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_finance AS CHAR) COLLATE utf8mb4_nopad_bin)))
     OR NEW.`version` <> COALESCE(v_p_version, 0) + 1 OR NOT (NEW.replaces_document_id <=> v_p_id) OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.schemaVersion') AS SIGNED) <=> 2) OR NOT ((JSON_VALUE(NEW.snapshot, '$.kind') COLLATE utf8mb4_nopad_bin) <=> NEW.kind)
     OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.admission.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_e_id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.documentId')) COLLATE utf8mb4_nopad_bin) <=> (CAST(NEW.id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.version') AS SIGNED) <=> NEW.`version`) OR NOT ((JSON_VALUE(NEW.snapshot, '$.sourceHash') COLLATE utf8mb4_nopad_bin) <=> NEW.source_hash) OR NOT ((CASE WHEN JSON_VALUE(NEW.snapshot, '$.createdAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.snapshot, '$.createdAt'), CHAR_LENGTH(JSON_VALUE(NEW.snapshot, '$.createdAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.snapshot, '$.createdAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.snapshot, '$.createdAt')) AS DATETIME(6)) END) <=> NEW.created_at)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact immutable authorized MVP paper sources required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_event_source table=mvp_events timing=BEFORE event=INSERT pg_name=mvp_event_source
DROP TRIGGER IF EXISTS `mvp_event_source`;
CREATE TRIGGER `mvp_event_source` BEFORE INSERT ON `mvp_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_banned TINYINT DEFAULT NULL;
  DECLARE v_a_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_clinical UUID DEFAULT NULL;
  DECLARE v_checklist UUID DEFAULT NULL;
  DECLARE v_src DATETIME(6) DEFAULT NULL;
  DECLARE v_del DATETIME(6) DEFAULT NULL;
  DECLARE v_dummy TINYINT DEFAULT NULL;
  DECLARE v_fin UUID DEFAULT NULL;
  DECLARE v_d_adm UUID DEFAULT NULL;
  DECLARE v_d_schema INT DEFAULT NULL;
  DECLARE v_d_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_d_hash TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_d_version INT DEFAULT NULL;
  DECLARE v_d_created DATETIME(6) DEFAULT NULL;
  DECLARE v_d_snapshot LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  SELECT id, role, banned, name INTO v_a_id, v_a_role, v_a_banned, v_a_name FROM staff_user WHERE id = NEW.recorded_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NOT (v_e_wv <=> 2) OR NOT (v_e_status <=> 'ADMITTED') OR v_a_id IS NULL OR COALESCE(v_a_banned, 0) <> 0 OR NEW.bill_version <> v_e_bill OR NEW.recorded_at > UTC_TIMESTAMP(6)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current MVP episode, actor and bill source required'; END IF;
  SET v_src = (CASE WHEN JSON_VALUE(NEW.payload, '$.sourceTime') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.payload, '$.sourceTime'), CHAR_LENGTH(JSON_VALUE(NEW.payload, '$.sourceTime')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.payload, '$.sourceTime'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.payload, '$.sourceTime')) AS DATETIME(6)) END);
  SET v_clinical = mvp_current(v_e_id, 'doctor-approval');
  SET v_checklist = mvp_current(v_e_id, 'checklist');
  IF NEW.action IN ('doctor-approval','checklist') OR (NEW.action = 'check' AND NEW.check_key IN ('NURSING','DIAGNOSTICS')) THEN
    IF NOT mvp_assigned(v_e_id, v_a_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse records external authority and readiness'; END IF;
  ELSEIF NEW.action = 'check' THEN
    IF (NEW.check_key = 'PHARMACY' AND v_a_role <> 'PHARMACY')
       OR (NEW.check_key = 'INSURANCE' AND (v_a_role <> 'INSURANCE' OR NOT EXISTS(SELECT 1 FROM insurance_cases WHERE admission_id = v_e_id AND assigned_staff_id = v_a_id)))
       OR NEW.check_key NOT IN ('PHARMACY','INSURANCE')
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current responsible department actor required'; END IF;
  ELSEIF NEW.action = 'n-a' AND v_a_role <> 'ADMIN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Admin confirms optional applicability';
  ELSEIF NEW.action = 'finance' AND v_a_role NOT IN ('ADMIN','BILLING') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Admin or Billing final financial authority required';
  ELSEIF NEW.action = 'deliver' AND NOT (v_a_role = 'ADMIN' OR mvp_assigned(v_e_id, v_a_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse or Admin delivers papers';
  END IF;
  IF NEW.action = 'doctor-approval' THEN
    IF CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.authorizerName') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.evidence') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.clinicalSummary') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.prescription') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.followUp') COLLATE utf8mb4_nopad_bin), ''))) < 3
       OR v_src < v_e_admitted OR v_src > UTC_TIMESTAMP(6) OR v_src IS NULL
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Named external Doctor source and actual source time required'; END IF;
  ELSE
    IF v_clinical IS NULL OR NOT (NEW.clinical_id <=> v_clinical) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current external Doctor authorization required'; END IF;
    IF NEW.action <> 'checklist' AND NOT (NEW.action = 'deliver' AND (JSON_VALUE(NEW.payload, '$.kind') COLLATE utf8mb4_nopad_bin) = 'CLINICAL') AND (v_checklist IS NULL OR NOT (NEW.checklist_id <=> v_checklist))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current published checklist required'; END IF;
  END IF;
  IF NEW.action = 'checklist' THEN
    IF NOT (JSON_TYPE(JSON_EXTRACT(NEW.payload, '$.items')) <=> 'ARRAY') OR NOT (JSON_TYPE(JSON_EXTRACT(NEW.payload, '$.proposedNa')) <=> 'ARRAY') OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.remarks') COLLATE utf8mb4_nopad_bin), ''))) < 3
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published physical checklist and applicability proposal required'; END IF;
    IF JSON_LENGTH(JSON_EXTRACT(NEW.payload, '$.items')) NOT BETWEEN 1 AND 50
       OR EXISTS(SELECT 1 FROM JSON_TABLE(JSON_EXTRACT(NEW.payload, '$.items'), '$[*]' COLUMNS (i TEXT PATH '$')) jt WHERE CHAR_LENGTH(TRIM(jt.i)) < 3)
       OR EXISTS(SELECT 1 FROM JSON_TABLE(JSON_EXTRACT(NEW.payload, '$.proposedNa'), '$[*]' COLUMNS (k TEXT PATH '$')) jk WHERE jk.k NOT IN ('PHARMACY','INSURANCE','DIAGNOSTICS'))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checklist must retain actual items and optional-only applicability'; END IF;
  END IF;
  IF NEW.action = 'check' AND CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.remarks') COLLATE utf8mb4_nopad_bin), ''))) < 3 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attributed department remarks required'; END IF;
  IF NEW.action = 'check' AND (COALESCE(NEW.check_key, '') NOT IN ('NURSING','PHARMACY','INSURANCE','DIAGNOSTICS') OR COALESCE(NEW.status, '') NOT IN ('PENDING','COMPLETE'))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid attributed department status required'; END IF;
  IF NEW.action = 'check' AND NEW.check_key = 'DIAGNOSTICS' AND NEW.status = 'COMPLETE'
     AND (CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.confirmerName') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.evidence') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR v_src IS NULL OR v_src > UTC_TIMESTAMP(6))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Named external diagnostic confirmation required; Nurse is recorder'; END IF;
  IF NEW.action = 'n-a' THEN
    IF NEW.check_key NOT IN ('PHARMACY','INSURANCE','DIAGNOSTICS') OR NOT (NEW.status <=> 'NA') OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.reason') COLLATE utf8mb4_nopad_bin), ''))) < 3
       OR NOT EXISTS(SELECT 1 FROM mvp_events WHERE id = v_checklist AND JSON_CONTAINS(JSON_EXTRACT(payload, '$.proposedNa'), JSON_QUOTE(NEW.check_key)))
       OR (NEW.check_key = 'INSURANCE' AND (v_e_route <> 'SELF_PAY' OR EXISTS(SELECT 1 FROM insurance_cases WHERE admission_id = v_e_id)))
       OR (NEW.check_key = 'PHARMACY' AND EXISTS(SELECT 1 FROM charges WHERE admission_id = v_e_id AND category = 'medicine'))
       OR (NEW.check_key = 'DIAGNOSTICS' AND EXISTS(SELECT 1 FROM charges WHERE admission_id = v_e_id AND category IN ('lab','radiology')))
       OR (SELECT status FROM mvp_events WHERE admission_id = v_e_id AND check_key = NEW.check_key AND action IN ('check','n-a') ORDER BY recorded_at DESC, id DESC LIMIT 1) = 'PENDING'
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Optional N/A needs Nurse proposal, Admin reason and absence of relevant work'; END IF;
  END IF;
  IF NEW.action = 'finance' THEN SET @ignored = mvp_finance_guard(v_e_id, NEW.payload); END IF;
  IF NEW.action = 'deliver' THEN
    SET v_del = (CASE WHEN JSON_VALUE(NEW.payload, '$.deliveredAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.payload, '$.deliveredAt'), CHAR_LENGTH(JSON_VALUE(NEW.payload, '$.deliveredAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.payload, '$.deliveredAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.payload, '$.deliveredAt')) AS DATETIME(6)) END);
    SET v_fin = mvp_current(v_e_id, 'finance');
    SELECT admission_id, schema_version, kind, `hash`, `version`, created_at, snapshot INTO v_d_adm, v_d_schema, v_d_kind, v_d_hash, v_d_version, v_d_created, v_d_snapshot
      FROM discharge_documents WHERE id = JSON_VALUE(NEW.payload, '$.documentId');
    IF NOT (v_d_adm <=> v_e_id) OR NOT (v_d_schema <=> 2) OR NOT (v_d_kind <=> (JSON_VALUE(NEW.payload, '$.kind') COLLATE utf8mb4_nopad_bin)) OR NOT (v_d_hash <=> (JSON_VALUE(NEW.payload, '$.documentHash') COLLATE utf8mb4_nopad_bin)) OR NOT (v_d_version <=> CAST(JSON_VALUE(NEW.payload, '$.documentVersion') AS SIGNED))
       OR v_del IS NULL OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.recipient') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.evidence') COLLATE utf8mb4_nopad_bin), ''))) < 3
       OR v_del < v_d_created OR v_del > UTC_TIMESTAMP(6)
       OR NOT ((LOWER(JSON_VALUE(v_d_snapshot, '$.clinical.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_clinical AS CHAR) COLLATE utf8mb4_nopad_bin))
       OR (v_d_kind = 'FINAL' AND (NOT ((LOWER(JSON_VALUE(NEW.payload, '$.financeId')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_fin AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT ((LOWER(JSON_VALUE(v_d_snapshot, '$.finance.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_fin AS CHAR) COLLATE utf8mb4_nopad_bin))))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact current authorized document delivery required'; END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_source table=mvp_exception_events timing=BEFORE event=INSERT pg_name=mvp_exception_source
DROP TRIGGER IF EXISTS `mvp_exception_source`;
CREATE TRIGGER `mvp_exception_source` BEFORE INSERT ON `mvp_exception_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_banned TINYINT DEFAULT NULL;
  DECLARE v_a_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_src DATETIME(6) DEFAULT NULL;
  DECLARE v_vac DATETIME(6) DEFAULT NULL;
  DECLARE v_del DATETIME(6) DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_adm UUID DEFAULT NULL;
  DECLARE v_s_bill INT DEFAULT NULL;
  DECLARE v_s_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_d_adm UUID DEFAULT NULL;
  DECLARE v_d_schema INT DEFAULT NULL;
  DECLARE v_d_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_d_hash TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_d_created DATETIME(6) DEFAULT NULL;
  DECLARE v_d_snapshot LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_expected TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_net DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_deposits DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_allocated DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_patient_cash DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_insurer_cash DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_refunded DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_financial LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_k TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_i INT DEFAULT NULL;
  DECLARE v_obl LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '[]';
  SELECT id, role, banned, name INTO v_a_id, v_a_role, v_a_banned, v_a_name FROM staff_user WHERE id = NEW.recorded_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NOT (v_e_wv <=> 2) OR v_a_id IS NULL OR COALESCE(v_a_banned, 0) <> 0 OR NEW.bill_version <> v_e_bill OR NEW.recorded_at > UTC_TIMESTAMP(6) OR (NEW.action <> 'FOLLOWUP' AND v_e_status <> 'ADMITTED')
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current source-bound MVP exception actor and bill required'; END IF;
  IF NEW.action IN ('CLINICAL','VACANCY') AND NOT mvp_assigned(v_e_id, v_a_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse records external clinical authority and factual vacancy'; END IF;
  IF NEW.action IN ('AUTHORITY','FOLLOWUP') AND v_a_role <> 'ADMIN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Admin exception authority required'; END IF;
  IF NEW.action = 'DELIVERY' AND NOT (v_a_role = 'ADMIN' OR mvp_assigned(v_e_id, v_a_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse or Admin delivers authorized papers'; END IF;
  SELECT id, action, `type`, admission_id, bill_version, payload INTO v_s_id, v_s_action, v_s_type, v_s_adm, v_s_bill, v_s_payload FROM mvp_exception_events WHERE id = NEW.source_id;
  IF NEW.action = 'CLINICAL' THEN
    SET v_src = (CASE WHEN JSON_VALUE(NEW.payload, '$.sourceTime') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.payload, '$.sourceTime'), CHAR_LENGTH(JSON_VALUE(NEW.payload, '$.sourceTime')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.payload, '$.sourceTime'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.payload, '$.sourceTime')) AS DATETIME(6)) END);
    IF NEW.`type` NOT IN ('PLANNED_EXIT','AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH','RETURN_TO_BED','RETURN_CANCELLED') OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.authorizerName') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.evidence') COLLATE utf8mb4_nopad_bin), ''))) < 3
       OR v_src IS NULL OR v_src < v_e_admitted OR v_src > UTC_TIMESTAMP(6)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Named external clinical authorizer, source evidence and actual source time required'; END IF;
    IF NEW.`type` = 'RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM effective_room_vacations v WHERE v.id = NEW.source_id AND v.admission_id = v_e_id AND v.vacated_at <= v_src)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Return instruction binds the current actual vacancy'; END IF;
    IF NEW.`type` = 'RETURN_CANCELLED' AND (NOT (v_s_action <=> 'CLINICAL') OR NOT (v_s_type <=> 'RETURN_TO_BED') OR NOT (v_s_adm <=> v_e_id) OR v_src < (CASE WHEN JSON_VALUE(v_s_payload, '$.sourceTime') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(v_s_payload, '$.sourceTime'), CHAR_LENGTH(JSON_VALUE(v_s_payload, '$.sourceTime')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(v_s_payload, '$.sourceTime'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(v_s_payload, '$.sourceTime')) AS DATETIME(6)) END))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External reconsideration binds the original return instruction'; END IF;
    IF NEW.`type` = 'RETURN_TO_BED' AND EXISTS(SELECT 1 FROM mvp_exception_events p WHERE p.admission_id = v_e_id AND p.action = 'CLINICAL' AND p.type = 'RETURN_TO_BED' AND p.source_id = NEW.source_id
         AND NOT EXISTS(SELECT 1 FROM mvp_exception_events c WHERE c.action = 'CLINICAL' AND c.type = 'RETURN_CANCELLED' AND c.source_id = p.id)
         AND NOT EXISTS(SELECT 1 FROM mvp_room_returns r WHERE r.clinical_id = p.id))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'One unperformed return instruction per current vacancy'; END IF;
    IF NEW.`type` = 'RETURN_CANCELLED' AND (EXISTS(SELECT 1 FROM mvp_room_returns WHERE clinical_id = v_s_id)
         OR EXISTS(SELECT 1 FROM mvp_exception_events WHERE action = 'CLINICAL' AND `type` = 'RETURN_CANCELLED' AND source_id = v_s_id)
         OR NOT EXISTS(SELECT 1 FROM effective_room_vacations WHERE id = (SELECT source_id FROM mvp_exception_events WHERE id = v_s_id) AND admission_id = v_e_id))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only current unperformed and uncancelled return authority may be reconsidered'; END IF;
  ELSEIF NEW.action = 'AUTHORITY' THEN
    SET v_expected = CASE WHEN NEW.`type` IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') THEN 'PLANNED_EXIT' ELSE NEW.`type` END;
    IF NEW.`type` NOT IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL','AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH','RETURN_TO_BED')
       OR NOT (v_s_action <=> 'CLINICAL') OR NOT (v_s_type <=> v_expected) OR NOT (v_s_adm <=> v_e_id)
       OR NOT (v_s_id <=> (SELECT id FROM mvp_exception_events WHERE admission_id = v_e_id AND action = 'CLINICAL' ORDER BY recorded_at DESC, id DESC LIMIT 1))
       OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.authority') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.reason') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.evidence') COLLATE utf8mb4_nopad_bin), ''))) < 3
       OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = (JSON_VALUE(NEW.payload, '$.followUpOwnerId') COLLATE utf8mb4_nopad_bin) AND banned = 0)
       OR NOT (CAST(JSON_VALUE(NEW.payload, '$.bill.revision') AS SIGNED) <=> v_e_bill)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Explicit accountable Admin authority preserves exact clinical source, money and follow-up obligations'; END IF;
    IF NEW.`type` IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND EXISTS(SELECT 1 FROM mvp_exception_events p WHERE p.admission_id = v_e_id AND p.action = 'CLINICAL' AND p.type = 'RETURN_TO_BED'
        AND NOT EXISTS(SELECT 1 FROM mvp_exception_events c WHERE c.action = 'CLINICAL' AND c.type = 'RETURN_CANCELLED' AND c.source_id = p.id)
        AND NOT EXISTS(SELECT 1 FROM mvp_room_returns r WHERE r.clinical_id = p.id))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planned exception requires actual return or source-bound reconsideration'; END IF;
    SELECT COALESCE(SUM(ch.amount_paise - COALESCE((SELECT SUM(amount_paise) FROM charge_reversals WHERE charge_id = ch.id), 0)), 0) INTO v_net
      FROM charges ch WHERE ch.admission_id = v_e_id AND (ch.initial_status = 'FINAL' OR EXISTS(SELECT 1 FROM charge_finalizations WHERE charge_id = ch.id));
    SELECT COALESCE(SUM(CASE WHEN r.party = 'PATIENT' THEN r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0) END), 0),
           COALESCE(SUM(CASE WHEN r.party = 'INSURER' THEN r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0) END), 0)
      INTO v_patient_cash, v_insurer_cash FROM receipts r WHERE r.admission_id = v_e_id;
    SET v_refunded = (SELECT COALESCE(SUM(amount_paise), 0) FROM receipt_refunds WHERE admission_id = v_e_id);
    IF NOT (CAST(JSON_VALUE(NEW.payload, '$.bill.netPaise') AS DECIMAL(30,6)) <=> v_net) OR NOT (CAST(JSON_VALUE(NEW.payload, '$.bill.patientCashPaise') AS DECIMAL(30,6)) <=> v_patient_cash) OR NOT (CAST(JSON_VALUE(NEW.payload, '$.bill.insurerCashPaise') AS DECIMAL(30,6)) <=> v_insurer_cash) OR NOT (CAST(JSON_VALUE(NEW.payload, '$.bill.refundedPaise') AS DECIMAL(30,6)) <=> v_refunded)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exception authority cannot erase or replace actual ledger amounts'; END IF;
    SET v_financial = mvp_current_responsibility(v_e_id);
    SET v_i = 1;
    WHILE v_i <= 8 DO
      SET v_k = ELT(v_i, 'responsibility','caseId','reviewRevision','policyId','decisionId','conversionId','selfPayReviewId','insurerAuthorizedPaise');
      IF NOT (JSON_EXTRACT(v_financial, CONCAT('$.', v_k)) IS NOT NULL
              AND COALESCE(JSON_EQUALS(COALESCE(JSON_EXTRACT(NEW.payload, CONCAT('$.financial.', v_k)), 'null'), JSON_EXTRACT(v_financial, CONCAT('$.', v_k))), 0) = 1)
      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exception authority must retain the current verified party allocation and exact source'; END IF;
      SET v_i = v_i + 1;
    END WHILE;
    IF NOT COALESCE(JSON_VALUE(v_financial, '$.responsibility.allocationComplete') IN ('true','1'), 0) THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Party responsibility is unresolved or stale; explicit allocation review remains required'); END IF;
    IF CAST(JSON_VALUE(v_financial, '$.responsibility.patientOutstandingPaise') AS DECIMAL(30,6)) > 0 THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', CONCAT('Patient outstanding paise: ', JSON_VALUE(v_financial, '$.responsibility.patientOutstandingPaise'))); END IF;
    IF CAST(JSON_VALUE(v_financial, '$.responsibility.insurerOutstandingPaise') AS DECIMAL(30,6)) > 0 THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', CONCAT('Accepted insurer receivable paise: ', JSON_VALUE(v_financial, '$.responsibility.insurerOutstandingPaise'))); END IF;
    IF CAST(JSON_VALUE(v_financial, '$.responsibility.patientExcessPaise') AS DECIMAL(30,6)) > 0 OR CAST(JSON_VALUE(v_financial, '$.responsibility.insurerExcessPaise') AS DECIMAL(30,6)) > 0 THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Excess retained cash requires explicit disposition'); END IF;
    -- nested aggregates inside an IF condition raise error 1111 in stored programs, so the sums go through variables
    SET v_deposits = (SELECT COALESCE(SUM(r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0)), 0) FROM receipts r WHERE r.admission_id = v_e_id AND r.kind <> 'PAYMENT');
    SET v_allocated = (SELECT COALESCE(SUM(a.amount_paise), 0) FROM receipt_allocations a JOIN receipts r ON r.id = a.receipt_id WHERE r.admission_id = v_e_id AND NOT EXISTS(SELECT 1 FROM allocation_cancellations x WHERE x.allocation_id = a.id));
    IF v_deposits > v_allocated THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Unallocated retained deposit requires explicit disposition'); END IF;
    IF NOT EXISTS(SELECT 1 FROM effective_room_vacations WHERE admission_id = v_e_id) THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Actual room vacancy and final room-charge cutoff remain outstanding'); END IF;
    SET v_i = 1;
    WHILE v_i <= 7 DO
      SET v_k = ELT(v_i, 'doctor-approval','checklist','NURSING','PHARMACY','INSURANCE','DIAGNOSTICS','finance');
      IF mvp_current(v_e_id, v_k) IS NULL THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', CONCAT('Ordinary approval remains absent: ', v_k)); END IF;
      SET v_i = v_i + 1;
    END WHILE;
    IF EXISTS(SELECT 1 FROM charges ch WHERE ch.admission_id = v_e_id AND ch.initial_status = 'PENDING' AND NOT EXISTS(SELECT 1 FROM charge_finalizations WHERE charge_id = ch.id)
              AND ch.amount_paise > COALESCE((SELECT SUM(amount_paise) FROM charge_reversals WHERE charge_id = ch.id), 0))
    THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Pending charge sources require reconciliation'); END IF;
    IF EXISTS(SELECT 1 FROM transfer_insurance_tasks t WHERE t.admission_id = v_e_id AND NOT EXISTS(SELECT 1 FROM insurance_transfer_resolutions r WHERE r.task_id = t.id))
    THEN SET v_obl = JSON_ARRAY_APPEND(v_obl, '$', 'Transfer insurance responsibility remains unresolved'); END IF;
    SET NEW.payload = JSON_SET(NEW.payload, '$.outstandingObligations', JSON_EXTRACT(v_obl, '$'));
    IF NEW.`type` IN ('INSURANCE_DELAY','INSURANCE_DENIAL') AND (v_e_route <> 'INSURED' OR NOT EXISTS(SELECT 1 FROM insurance_cases WHERE id = JSON_VALUE(NEW.payload, '$.sourceId') AND admission_id = v_e_id))
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact external insurance case required'; END IF;
    IF NEW.`type` = 'INSURANCE_DENIAL' AND NOT ((SELECT status FROM insurance_decisions WHERE case_id = JSON_VALUE(NEW.payload, '$.sourceId') ORDER BY case_version DESC LIMIT 1) <=> 'REJECTED')
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual current external denial required'; END IF;
  ELSEIF NEW.action = 'FOLLOWUP' THEN
    IF NOT (v_s_action <=> 'AUTHORITY') OR NOT (v_s_adm <=> v_e_id) OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = (JSON_VALUE(NEW.payload, '$.ownerId') COLLATE utf8mb4_nopad_bin) AND banned = 0) OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.note') COLLATE utf8mb4_nopad_bin), ''))) < 3
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Original exception and named follow-up owner required'; END IF;
  ELSEIF NEW.action = 'VACANCY' THEN
    SET v_vac = (CASE WHEN JSON_VALUE(NEW.payload, '$.vacatedAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.payload, '$.vacatedAt'), CHAR_LENGTH(JSON_VALUE(NEW.payload, '$.vacatedAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.payload, '$.vacatedAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.payload, '$.vacatedAt')) AS DATETIME(6)) END);
    IF NOT (v_s_action <=> 'CLINICAL') OR NOT (v_s_adm <=> v_e_id) OR v_s_type IN ('RETURN_TO_BED','RETURN_CANCELLED') OR JSON_VALUE(NEW.payload, '$.vacatedAt') IS NULL OR JSON_VALUE(NEW.payload, '$.stayId') IS NULL OR JSON_VALUE(NEW.payload, '$.shiftId') IS NULL
       OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.waitingLocation') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR CHAR_LENGTH(TRIM(COALESCE((JSON_VALUE(NEW.payload, '$.handover') COLLATE utf8mb4_nopad_bin), ''))) < 3 OR v_vac IS NULL OR v_vac < v_e_admitted OR v_vac > UTC_TIMESTAMP(6)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External exit disposition and factual Nurse vacancy required'; END IF;
  ELSEIF NEW.action = 'DELIVERY' THEN
    SET v_del = (CASE WHEN JSON_VALUE(NEW.payload, '$.deliveredAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(NEW.payload, '$.deliveredAt'), CHAR_LENGTH(JSON_VALUE(NEW.payload, '$.deliveredAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(NEW.payload, '$.deliveredAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(NEW.payload, '$.deliveredAt')) AS DATETIME(6)) END);
    SELECT admission_id, schema_version, kind, `hash`, created_at, snapshot INTO v_d_adm, v_d_schema, v_d_kind, v_d_hash, v_d_created, v_d_snapshot
      FROM discharge_documents WHERE id = JSON_VALUE(NEW.payload, '$.documentId');
    IF NOT (v_s_action <=> 'AUTHORITY') OR NOT (v_s_adm <=> v_e_id) OR NOT (v_s_bill <=> v_e_bill) OR NOT (v_d_adm <=> v_e_id) OR v_d_schema <> 2 OR v_d_kind <> 'FINAL'
       OR NOT ((LOWER(JSON_VALUE(v_d_snapshot, '$.exception.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_s_id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (v_d_hash <=> (JSON_VALUE(NEW.payload, '$.documentHash') COLLATE utf8mb4_nopad_bin))
       OR v_del IS NULL OR v_del < v_d_created OR v_del > UTC_TIMESTAMP(6)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact current exceptional paper version and actual delivery required'; END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_document table=discharge_documents timing=BEFORE event=INSERT pg_name=mvp_exception_document
DROP TRIGGER IF EXISTS `mvp_exception_document`;
CREATE TRIGGER `mvp_exception_document` BEFORE INSERT ON `discharge_documents` FOR EACH ROW
trg: BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_x_id UUID DEFAULT NULL;
  DECLARE v_x_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_bill INT DEFAULT NULL;
  DECLARE v_x_source UUID DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_p_id UUID DEFAULT NULL;
  DECLARE v_p_version INT DEFAULT NULL;
  -- WHEN ((new.snapshot -> 'exception') IS NOT NULL AND (new.snapshot -> 'exception') <> 'null'::jsonb)
  IF COALESCE(JSON_TYPE(JSON_EXTRACT(NEW.snapshot, '$.exception')), 'NULL') = 'NULL' THEN LEAVE trg; END IF;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SELECT id, action, admission_id, bill_version, source_id INTO v_x_id, v_x_action, v_x_adm, v_x_bill, v_x_source FROM mvp_exception_events WHERE id = JSON_VALUE(NEW.snapshot, '$.exception.id');
  SELECT id, action INTO v_c_id, v_c_action FROM mvp_exception_events WHERE id = v_x_source;
  IF v_e_wv <> 2 OR NEW.schema_version <> 2 OR NOT (v_x_action <=> 'AUTHORITY') OR NOT (v_x_adm <=> v_e_id) OR NOT (v_c_action <=> 'CLINICAL') OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.clinical.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_c_id AS CHAR) COLLATE utf8mb4_nopad_bin))
     OR NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.created_by AND u.banned = 0 AND (u.role IN ('ADMIN','BILLING') OR mvp_assigned(v_e_id, u.id)))
     OR (v_e_status = 'ADMITTED' AND v_x_bill <> v_e_bill)
     OR (v_e_status = 'DISCHARGED' AND NOT EXISTS(SELECT 1 FROM mvp_exceptional_departures d WHERE d.admission_id = v_e_id AND d.authority_id = v_x_id))
     OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.documentId')) COLLATE utf8mb4_nopad_bin) <=> (CAST(NEW.id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.version') AS SIGNED) <=> NEW.`version`) OR NOT ((JSON_VALUE(NEW.snapshot, '$.sourceHash') COLLATE utf8mb4_nopad_bin) <=> NEW.source_hash) OR NOT ((JSON_VALUE(NEW.snapshot, '$.kind') COLLATE utf8mb4_nopad_bin) <=> NEW.kind)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact source-bound exceptional paper authority required'; END IF;
  SELECT id, `version` INTO v_p_id, v_p_version FROM discharge_documents WHERE admission_id = v_e_id ORDER BY `version` DESC LIMIT 1;
  IF NEW.`version` <> COALESCE(v_p_version, 0) + 1 OR NOT (NEW.replaces_document_id <=> v_p_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Immutable document predecessor required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_vacancy table=room_vacations timing=BEFORE event=INSERT pg_name=mvp_exception_vacancy
DROP TRIGGER IF EXISTS `mvp_exception_vacancy`;
CREATE TRIGGER `mvp_exception_vacancy` BEFORE INSERT ON `room_vacations` FOR EACH ROW
trg: BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_x_id UUID DEFAULT NULL;
  DECLARE v_x_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_source UUID DEFAULT NULL;
  DECLARE v_x_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_bill INT DEFAULT NULL;
  DECLARE v_x_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_adm UUID DEFAULT NULL;
  DECLARE v_c_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_c_source UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_started DATETIME(6) DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_v_id UUID DEFAULT NULL;
  DECLARE v_v_adm UUID DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  DECLARE v_moment DATETIME(6) DEFAULT NULL;
  DECLARE v_dummy UUID DEFAULT NULL;
  DECLARE v_w_id UUID DEFAULT NULL;
  DECLARE v_w_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_w_adm UUID DEFAULT NULL;
  DECLARE v_w_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_w_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NEW.mvp_exception_id IS NULL THEN LEAVE trg; END IF;
  SELECT id, action, admission_id, recorded_by, payload INTO v_w_id, v_w_action, v_w_adm, v_w_by, v_w_payload FROM mvp_exception_events WHERE id = NEW.mvp_exception_id;
  SELECT id, admission_id, bed_id, started_at, ended_at, last_reconciled_at INTO v_st_id, v_st_adm, v_st_bed, v_st_started, v_st_ended, v_st_rec FROM effective_room_stays WHERE id = NEW.stay_id;
  SET v_moment = NEW.vacated_at;
  IF v_e_wv <> 2 OR NEW.nursing_seal_id IS NOT NULL OR NEW.mvp_readiness_id IS NOT NULL OR NOT (v_w_action <=> 'VACANCY') OR NOT (v_w_adm <=> v_e_id) OR NOT (v_w_by <=> NEW.signed_by)
     OR NOT ((LOWER(JSON_VALUE(v_w_payload, '$.stayId')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_st_id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT ((LOWER(JSON_VALUE(v_w_payload, '$.shiftId')) COLLATE utf8mb4_nopad_bin) <=> (CAST(NEW.shift_id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT ((CASE WHEN JSON_VALUE(v_w_payload, '$.vacatedAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(v_w_payload, '$.vacatedAt'), CHAR_LENGTH(JSON_VALUE(v_w_payload, '$.vacatedAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(v_w_payload, '$.vacatedAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(v_w_payload, '$.vacatedAt')) AS DATETIME(6)) END) <=> v_moment)
     OR NOT (v_st_adm <=> v_e_id) OR NOT (v_st_ended <=> v_moment) OR NOT (v_st_rec <=> v_moment)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact exceptional physical vacancy source required'; END IF;
  IF NOT mvp_assigned(v_e_id, NEW.signed_by) OR NOT EXISTS(SELECT 1 FROM nursing_shifts s WHERE s.id = NEW.shift_id AND s.admission_id = v_e_id AND s.nurse_id = NEW.signed_by AND s.started_at <= v_moment AND NOT EXISTS(SELECT 1 FROM effective_shift_ends x WHERE x.shift_id = s.id AND x.ended_at < v_moment))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual assigned-Nurse vacancy attendance required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_return table=mvp_room_returns timing=BEFORE event=INSERT pg_name=mvp_exception_return
DROP TRIGGER IF EXISTS `mvp_exception_return`;
CREATE TRIGGER `mvp_exception_return` BEFORE INSERT ON `mvp_room_returns` FOR EACH ROW
trg: BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_x_id UUID DEFAULT NULL;
  DECLARE v_x_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_source UUID DEFAULT NULL;
  DECLARE v_x_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_bill INT DEFAULT NULL;
  DECLARE v_x_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_adm UUID DEFAULT NULL;
  DECLARE v_c_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_c_source UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_started DATETIME(6) DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_v_id UUID DEFAULT NULL;
  DECLARE v_v_adm UUID DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  DECLARE v_moment DATETIME(6) DEFAULT NULL;
  DECLARE v_dummy UUID DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SELECT id, action, admission_id, source_id, `type`, bill_version, recorded_at INTO v_x_id, v_x_action, v_x_adm, v_x_source, v_x_type, v_x_bill, v_x_recorded FROM mvp_exception_events WHERE id = NEW.authority_id;
  SELECT id, action, admission_id, payload, source_id INTO v_c_id, v_c_action, v_c_adm, v_c_payload, v_c_source FROM mvp_exception_events WHERE id = NEW.clinical_id;
  SELECT id, admission_id, bed_id, started_at, ended_at, last_reconciled_at INTO v_st_id, v_st_adm, v_st_bed, v_st_started, v_st_ended, v_st_rec FROM effective_room_stays WHERE id = NEW.stay_id;
  SET v_moment = NEW.returned_at;
  IF v_e_wv <> 2 OR v_e_status <> 'ADMITTED' OR NOT mvp_assigned(v_e_id, NEW.recorded_by) OR NOT (v_x_action <=> 'AUTHORITY') OR NOT (v_c_action <=> 'CLINICAL') OR NOT (v_x_source <=> v_c_id) OR NOT (v_x_adm <=> v_e_id) OR NOT (v_c_adm <=> v_e_id)
     OR NOT (v_c_id <=> (SELECT id FROM mvp_exception_events WHERE admission_id = v_e_id AND action = 'CLINICAL' ORDER BY recorded_at DESC, id DESC LIMIT 1))
     OR NOT (v_st_adm <=> v_e_id) OR v_moment < (CASE WHEN JSON_VALUE(v_c_payload, '$.sourceTime') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(v_c_payload, '$.sourceTime'), CHAR_LENGTH(JSON_VALUE(v_c_payload, '$.sourceTime')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(v_c_payload, '$.sourceTime'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(v_c_payload, '$.sourceTime')) AS DATETIME(6)) END) OR v_moment > UTC_TIMESTAMP(6)
     OR NOT EXISTS(SELECT 1 FROM nursing_shifts n WHERE n.id = NEW.shift_id AND n.admission_id = v_e_id AND n.nurse_id = NEW.recorded_by AND n.started_at <= v_moment AND NOT EXISTS(SELECT 1 FROM effective_shift_ends x WHERE x.shift_id = n.id AND x.ended_at < v_moment))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse actual movement needs exact external clinical and Admin authority'; END IF;
  SELECT id INTO v_dummy FROM beds WHERE id = v_st_bed FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM bed_holds WHERE admission_id = v_e_id AND bed_id = v_st_bed) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Original bed hold required'; END IF;
  SELECT id, admission_id INTO v_v_id, v_v_adm FROM effective_room_vacations WHERE id = NEW.vacation_id;
  IF v_x_type <> 'RETURN_TO_BED' OR NOT (v_c_source <=> v_v_id) OR NOT (v_v_adm <=> v_e_id) OR NOT (v_st_started <=> v_moment) OR v_st_ended IS NOT NULL OR v_moment < v_x_recorded
     OR EXISTS(SELECT 1 FROM mvp_exception_events WHERE action = 'CLINICAL' AND `type` = 'RETURN_CANCELLED' AND source_id = v_c_id)
     OR EXISTS(SELECT 1 FROM effective_bed_turnovers t LEFT JOIN bed_turnover_completions c ON c.turnover_id = t.id WHERE t.bed_id = v_st_bed AND (c.id IS NULL OR c.completed_at > v_moment))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fresh returned stay requires current original instruction and completed turnover'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_departure table=mvp_exceptional_departures timing=BEFORE event=INSERT pg_name=mvp_exception_departure
DROP TRIGGER IF EXISTS `mvp_exception_departure`;
CREATE TRIGGER `mvp_exception_departure` BEFORE INSERT ON `mvp_exceptional_departures` FOR EACH ROW
trg: BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_x_id UUID DEFAULT NULL;
  DECLARE v_x_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_source UUID DEFAULT NULL;
  DECLARE v_x_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_bill INT DEFAULT NULL;
  DECLARE v_x_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_adm UUID DEFAULT NULL;
  DECLARE v_c_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_c_source UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_started DATETIME(6) DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_v_id UUID DEFAULT NULL;
  DECLARE v_v_adm UUID DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  DECLARE v_moment DATETIME(6) DEFAULT NULL;
  DECLARE v_dummy UUID DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SELECT id, action, admission_id, source_id, `type`, bill_version, recorded_at INTO v_x_id, v_x_action, v_x_adm, v_x_source, v_x_type, v_x_bill, v_x_recorded FROM mvp_exception_events WHERE id = NEW.authority_id;
  SELECT id, action, admission_id, payload, source_id INTO v_c_id, v_c_action, v_c_adm, v_c_payload, v_c_source FROM mvp_exception_events WHERE id = NEW.clinical_id;
  SELECT id, admission_id, bed_id, started_at, ended_at, last_reconciled_at INTO v_st_id, v_st_adm, v_st_bed, v_st_started, v_st_ended, v_st_rec FROM effective_room_stays WHERE id = NEW.stay_id;
  SET v_moment = NEW.departed_at;
  IF v_e_wv <> 2 OR v_e_status <> 'ADMITTED' OR NOT mvp_assigned(v_e_id, NEW.recorded_by) OR NOT (v_x_action <=> 'AUTHORITY') OR NOT (v_c_action <=> 'CLINICAL') OR NOT (v_x_source <=> v_c_id) OR NOT (v_x_adm <=> v_e_id) OR NOT (v_c_adm <=> v_e_id)
     OR NOT (v_c_id <=> (SELECT id FROM mvp_exception_events WHERE admission_id = v_e_id AND action = 'CLINICAL' ORDER BY recorded_at DESC, id DESC LIMIT 1))
     OR NOT (v_st_adm <=> v_e_id) OR v_moment < (CASE WHEN JSON_VALUE(v_c_payload, '$.sourceTime') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(v_c_payload, '$.sourceTime'), CHAR_LENGTH(JSON_VALUE(v_c_payload, '$.sourceTime')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(v_c_payload, '$.sourceTime'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(v_c_payload, '$.sourceTime')) AS DATETIME(6)) END) OR v_moment > UTC_TIMESTAMP(6)
     OR NOT EXISTS(SELECT 1 FROM nursing_shifts n WHERE n.id = NEW.shift_id AND n.admission_id = v_e_id AND n.nurse_id = NEW.recorded_by AND n.started_at <= v_moment AND NOT EXISTS(SELECT 1 FROM effective_shift_ends x WHERE x.shift_id = n.id AND x.ended_at < v_moment))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse actual movement needs exact external clinical and Admin authority'; END IF;
  SELECT id INTO v_dummy FROM beds WHERE id = v_st_bed FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM bed_holds WHERE admission_id = v_e_id AND bed_id = v_st_bed) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Original bed hold required'; END IF;
  SELECT stay_id, vacated_at INTO v_v_stay, v_v_vacated FROM effective_room_vacations WHERE admission_id = v_e_id LIMIT 1;
  IF v_x_type = 'RETURN_TO_BED' OR NOT (v_x_bill <=> v_e_bill) OR NOT (v_v_stay <=> v_st_id) OR v_moment < v_v_vacated OR EXISTS(SELECT 1 FROM departures WHERE admission_id = v_e_id)
     OR NOT ((LOWER(JSON_VALUE(NEW.snapshot, '$.authority.id')) COLLATE utf8mb4_nopad_bin) <=> (CAST(v_x_id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (CAST(JSON_VALUE(NEW.snapshot, '$.bill.revision') AS SIGNED) <=> v_e_bill)
     OR (v_x_type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NOT EXISTS(SELECT 1 FROM mvp_exception_events d WHERE d.action = 'DELIVERY' AND d.source_id = v_x_id AND (CASE WHEN JSON_VALUE(d.payload, '$.deliveredAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(d.payload, '$.deliveredAt'), CHAR_LENGTH(JSON_VALUE(d.payload, '$.deliveredAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(d.payload, '$.deliveredAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(d.payload, '$.deliveredAt')) AS DATETIME(6)) END) <= v_moment))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact exceptional obligations, actual vacancy and planned paper delivery required'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_external_source table=mvp_external_services timing=BEFORE event=INSERT pg_name=mvp_external_source
DROP TRIGGER IF EXISTS `mvp_external_source`;
CREATE TRIGGER `mvp_external_source` BEFORE INSERT ON `mvp_external_services` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_banned TINYINT DEFAULT NULL;
  DECLARE v_a_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_rate_id UUID DEFAULT NULL;
  DECLARE v_policy LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_dept TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_fraction TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_adm UUID DEFAULT NULL;
  DECLARE v_c_source TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_cat TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_item TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_qty TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_unit TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_tariff UUID DEFAULT NULL;
  DECLARE v_c_atype TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_actor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_init TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_corr UUID DEFAULT NULL;
  DECLARE v_c_desc TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_rate BIGINT DEFAULT NULL;
  DECLARE v_c_amount BIGINT DEFAULT NULL;
  SELECT id, role, banned, name INTO v_a_id, v_a_role, v_a_banned, v_a_name FROM staff_user WHERE id = NEW.recorded_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SELECT admission_id, source_event_id, category, item_id, quantity, unit, tariff_version_id, actor_type, actor_id, initial_status, correction_exception_id, description, rate_paise, amount_paise
    INTO v_c_adm, v_c_source, v_c_cat, v_c_item, v_c_qty, v_c_unit, v_c_tariff, v_c_atype, v_c_actor, v_c_init, v_c_corr, v_c_desc, v_c_rate, v_c_amount
    FROM charges WHERE id = NEW.charge_id;
  IF NOT (v_e_wv <=> 2) OR NOT (v_e_status <=> 'ADMITTED') OR v_a_id IS NULL OR COALESCE(v_a_banned, 0) <> 0 OR v_a_role NOT IN ('ADMIN','BILLING') OR NOT (NEW.recorder_name <=> v_a_name)
     OR NEW.performed_at < v_e_admitted OR NEW.performed_at > UTC_TIMESTAMP(6) OR NEW.recorded_at < NEW.performed_at OR NEW.recorded_at > UTC_TIMESTAMP(6)
     OR CHAR_LENGTH(TRIM(NEW.department_issuer)) NOT BETWEEN 3 AND 2000 OR CHAR_LENGTH(TRIM(NEW.evidence)) NOT BETWEEN 3 AND 2000
     OR CHAR_LENGTH(TRIM(NEW.external_bill_reference)) NOT BETWEEN 1 AND 200 OR CHAR_LENGTH(TRIM(NEW.external_line_reference)) NOT BETWEEN 1 AND 200
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current Admin/Billing recorder, actual performed-service time and external issuer bill-line evidence required'; END IF;
  SELECT v.id, v.payload INTO v_rate_id, v_policy FROM setting_versions v
    WHERE v.hospital_id = v_e_hosp AND v.kind = 'tariff' AND (JSON_VALUE(v.payload, '$.type') COLLATE utf8mb4_nopad_bin) = 'billable-item' AND (JSON_VALUE(v.payload, '$.code') COLLATE utf8mb4_nopad_bin) = NEW.item_id ORDER BY v.`version` DESC LIMIT 1;
  SET v_dept = CASE WHEN NEW.category IN ('consultation','procedure') THEN 'DOCTOR' WHEN NEW.category = 'consumable' THEN 'NURSE' ELSE 'LAB' END;
  IF NOT (v_rate_id <=> NEW.tariff_version_id) OR NOT COALESCE(JSON_VALUE(v_policy, '$.active') IN ('true','1'), 0) OR NOT ((JSON_VALUE(v_policy, '$.category') COLLATE utf8mb4_nopad_bin) <=> NEW.category) OR NOT ((JSON_VALUE(v_policy, '$.department') COLLATE utf8mb4_nopad_bin) <=> v_dept) OR NOT ((JSON_VALUE(v_policy, '$.unit') COLLATE utf8mb4_nopad_bin) <=> NEW.unit)
     OR NOT (NEW.quantity REGEXP '^[0-9]{1,12}([.][0-9]{1,6})?$' AND INSTR(NEW.quantity, CHAR(10)) = 0)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External billing source must pin the current active configured department item and quantity unit'; END IF;
  SET v_fraction = SUBSTRING_INDEX(SUBSTRING_INDEX(CONCAT(NEW.quantity, '.'), '.', 2), '.', -1);
  IF CAST(NEW.quantity AS DECIMAL(30,6)) <= 0 OR CHAR_LENGTH(v_fraction) > CAST(JSON_VALUE(v_policy, '$.quantityScale') AS SIGNED) OR NOT (v_c_adm <=> v_e_id) OR NOT (v_c_source <=> (CAST(NEW.id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (v_c_cat <=> NEW.category) OR NOT (v_c_item <=> NEW.item_id) OR NOT (v_c_qty <=> NEW.quantity) OR NOT (v_c_unit <=> NEW.unit) OR NOT (v_c_tariff <=> v_rate_id)
     OR NOT (v_c_atype <=> 'staff') OR NOT (v_c_actor <=> v_a_id) OR NOT (v_c_init <=> 'FINAL') OR v_c_corr IS NOT NULL OR NOT (v_c_desc <=> (JSON_VALUE(v_policy, '$.name') COLLATE utf8mb4_nopad_bin)) OR NOT (v_c_rate <=> CAST(JSON_VALUE(v_policy, '$.amount') AS DECIMAL(30,6))) OR NOT (v_c_amount <=> FLOOR(CAST(JSON_VALUE(v_policy, '$.amount') AS DECIMAL(30,6)) * CAST(NEW.quantity AS DECIMAL(30,6)) + 0.5))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External performed-service charge must match its exact immutable source and deterministic configured rate'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_medicine_source table=mvp_medicine_sources timing=BEFORE event=INSERT pg_name=mvp_medicine_source
DROP TRIGGER IF EXISTS `mvp_medicine_source`;
CREATE TRIGGER `mvp_medicine_source` BEFORE INSERT ON `mvp_medicine_sources` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_c_id UUID DEFAULT NULL;
  DECLARE v_c_adm UUID DEFAULT NULL;
  DECLARE v_c_cat TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_source TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_qty TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_actor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_c_amount BIGINT DEFAULT NULL;
  DECLARE v_c_rate BIGINT DEFAULT NULL;
  DECLARE v_o_id UUID DEFAULT NULL;
  DECLARE v_o_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_adm UUID DEFAULT NULL;
  DECLARE v_o_charge UUID DEFAULT NULL;
  DECLARE v_o_qty TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_scale INT DEFAULT NULL;
  DECLARE v_prior DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_credited DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_expected DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_actual DECIMAL(30,6) DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF v_e_wv <> 2 OR v_e_status <> 'ADMITTED' OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.recorded_by AND role = 'PHARMACY' AND banned = 0)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current Pharmacy actor and active MVP admission required'; END IF;
  SELECT id, admission_id, category, source_event_id, quantity, actor_id, amount_paise, rate_paise INTO v_c_id, v_c_adm, v_c_cat, v_c_source, v_c_qty, v_c_actor, v_c_amount, v_c_rate FROM charges WHERE id = NEW.charge_id;
  IF NOT (v_c_adm <=> v_e_id) OR v_c_cat <> 'medicine' OR CHAR_LENGTH(SUBSTRING_INDEX(SUBSTRING_INDEX(CONCAT(NEW.quantity, '.'), '.', 2), '.', -1)) > NEW.quantity_scale
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exact original patient medicine charge required'; END IF;
  IF NEW.kind = 'CHARGE' THEN
    IF NEW.original_id IS NOT NULL OR NEW.reversal_id IS NOT NULL OR NOT (v_c_source <=> (CAST(NEW.id AS CHAR) COLLATE utf8mb4_nopad_bin)) OR NOT (v_c_qty <=> NEW.quantity) OR NOT (v_c_actor <=> NEW.recorded_by)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Medicine charge must bind its unique source'; END IF;
  ELSE
    SELECT id, kind, admission_id, charge_id, quantity, quantity_scale INTO v_o_id, v_o_kind, v_o_adm, v_o_charge, v_o_qty, v_o_scale FROM mvp_medicine_sources WHERE id = NEW.original_id;
    SET v_prior = (SELECT COALESCE(SUM(CAST(quantity AS DECIMAL(30,6))), 0) FROM mvp_medicine_sources WHERE original_id = v_o_id);
    SET v_credited = (SELECT COALESCE(SUM(r.amount_paise), 0) FROM mvp_medicine_sources m JOIN charge_reversals r ON r.id = m.reversal_id WHERE m.original_id = v_o_id);
    SET v_expected = LEAST(v_c_amount, ROUND(v_c_rate * (v_prior + CAST(NEW.quantity AS DECIMAL(30,6))))) - v_credited;
    SET v_actual = (SELECT amount_paise FROM charge_reversals WHERE id = NEW.reversal_id AND charge_id = v_c_id);
    IF NOT (v_o_kind <=> 'CHARGE') OR NOT (v_o_adm <=> v_e_id) OR NOT (v_o_charge <=> v_c_id) OR v_prior + CAST(NEW.quantity AS DECIMAL(30,6)) > CAST(v_o_qty AS DECIMAL(30,6)) OR NOT (NEW.quantity_scale <=> v_o_scale)
       OR v_expected < 0 OR (v_expected > 0 AND NOT (v_actual <=> v_expected)) OR (v_expected = 0 AND NEW.reversal_id IS NOT NULL)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Accepted return exceeds original quantity or exact original-price credit'; END IF;
  END IF;
  SET @ignored = invalidate_clearances(v_e_id, 'PHARMACY', 'mvp_medicine', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=mvp_pending_return table=mvp_events timing=BEFORE event=INSERT pg_name=mvp_pending_return
DROP TRIGGER IF EXISTS `mvp_pending_return`;
CREATE TRIGGER `mvp_pending_return` BEFORE INSERT ON `mvp_events` FOR EACH ROW
trg: BEGIN

  IF NEW.action IN ('doctor-approval','finance') AND EXISTS(SELECT 1 FROM mvp_exception_events p WHERE p.admission_id = NEW.admission_id AND p.action = 'CLINICAL' AND p.type = 'RETURN_TO_BED'
       AND NOT EXISTS(SELECT 1 FROM mvp_exception_events c WHERE c.action = 'CLINICAL' AND c.type = 'RETURN_CANCELLED' AND c.source_id = p.id)
       AND NOT EXISTS(SELECT 1 FROM mvp_room_returns r WHERE r.clinical_id = p.id))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External return instruction needs actual return or explicit source-bound reconsideration'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_pending_transfer_approval table=mvp_events timing=BEFORE event=INSERT pg_name=mvp_pending_transfer_approval
DROP TRIGGER IF EXISTS `mvp_pending_transfer_approval`;
CREATE TRIGGER `mvp_pending_transfer_approval` BEFORE INSERT ON `mvp_events` FOR EACH ROW
trg: BEGIN

  IF NEW.action = 'doctor-approval' AND EXISTS(
       SELECT 1 FROM mvp_transfer_authorities a WHERE a.admission_id = NEW.admission_id
         AND a.id = (SELECT id FROM mvp_transfer_authorities WHERE admission_id = NEW.admission_id ORDER BY `version` DESC LIMIT 1)
         AND NOT EXISTS(SELECT 1 FROM mvp_transfer_cancellations c WHERE c.authority_id = a.id)
         AND NOT EXISTS(SELECT 1 FROM admission_transfers t WHERE t.mvp_authority_id = a.id))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Resolve the current external transfer instruction before recording discharge approval'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_legacy_seal table=clearance_seals timing=BEFORE event=INSERT pg_name=mvp_legacy_seal
DROP TRIGGER IF EXISTS `mvp_legacy_seal`;
CREATE TRIGGER `mvp_legacy_seal` BEFORE INSERT ON `clearance_seals` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_approval UUID DEFAULT NULL;
  DECLARE v_ev_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_ev_bill INT DEFAULT NULL;
  DECLARE v_ev_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF v_e_wv <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy professional seals cannot impersonate external MVP authority'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_physical_vacancy table=room_vacations timing=BEFORE event=INSERT pg_name=mvp_physical_vacancy
DROP TRIGGER IF EXISTS `mvp_physical_vacancy`;
CREATE TRIGGER `mvp_physical_vacancy` BEFORE INSERT ON `room_vacations` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_approval UUID DEFAULT NULL;
  DECLARE v_ev_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_ev_bill INT DEFAULT NULL;
  DECLARE v_ev_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  -- WHEN ((new.mvp_exception_id IS NULL))
  IF NEW.mvp_exception_id IS NOT NULL THEN LEAVE trg; END IF;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF v_e_wv = 1 THEN
    IF NEW.nursing_seal_id IS NULL OR NEW.mvp_readiness_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy Nursing source required'; END IF;
    LEAVE trg;
  END IF;
  SELECT id, admission_id, bed_id, ended_at, last_reconciled_at INTO v_st_id, v_st_adm, v_st_bed, v_st_ended, v_st_rec FROM effective_room_stays WHERE id = NEW.stay_id;
  IF v_e_status <> 'ADMITTED' OR NOT (v_st_adm <=> v_e_id) OR v_st_ended IS NULL OR NOT mvp_assigned(v_e_id, NEW.signed_by) OR NOT EXISTS(SELECT 1 FROM bed_holds WHERE admission_id = v_e_id AND bed_id = v_st_bed)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse and held closed actual stay required'; END IF;
  SET v_approval = mvp_current(v_e_id, 'NURSING');
  SET v_ev_recorded = (SELECT recorded_at FROM mvp_events WHERE id = v_approval);
  IF NEW.nursing_seal_id IS NOT NULL OR NOT (NEW.mvp_readiness_id <=> v_approval) OR v_approval IS NULL OR NOT (NEW.vacated_at <=> v_st_ended) OR NOT (NEW.vacated_at <=> v_st_rec) OR NEW.vacated_at < v_ev_recorded OR NEW.vacated_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.vacated_at
     OR NOT EXISTS(SELECT 1 FROM nursing_shifts n WHERE n.id = NEW.shift_id AND n.admission_id = v_e_id AND n.nurse_id = NEW.signed_by AND n.started_at <= NEW.vacated_at AND NOT EXISTS(SELECT 1 FROM effective_shift_ends x WHERE x.shift_id = n.id AND x.ended_at < NEW.vacated_at))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual vacancy must retain current Nursing readiness and same-nurse attendance'; END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_physical_departure table=departures timing=BEFORE event=INSERT pg_name=mvp_physical_departure
DROP TRIGGER IF EXISTS `mvp_physical_departure`;
CREATE TRIGGER `mvp_physical_departure` BEFORE INSERT ON `departures` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_bed UUID DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_approval UUID DEFAULT NULL;
  DECLARE v_ev_recorded DATETIME(6) DEFAULT NULL;
  DECLARE v_ev_bill INT DEFAULT NULL;
  DECLARE v_ev_payload LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF v_e_wv = 1 THEN
    IF NEW.bill_seal_id IS NULL OR NEW.mvp_finance_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy Billing source required'; END IF;
    LEAVE trg;
  END IF;
  SELECT id, admission_id, bed_id, ended_at, last_reconciled_at INTO v_st_id, v_st_adm, v_st_bed, v_st_ended, v_st_rec FROM effective_room_stays WHERE id = NEW.stay_id;
  IF v_e_status <> 'ADMITTED' OR NOT (v_st_adm <=> v_e_id) OR v_st_ended IS NULL OR NOT mvp_assigned(v_e_id, NEW.signed_by) OR NOT EXISTS(SELECT 1 FROM bed_holds WHERE admission_id = v_e_id AND bed_id = v_st_bed)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned Nurse and held closed actual stay required'; END IF;
  SET v_approval = mvp_current(v_e_id, 'finance');
  SELECT bill_version, recorded_at, payload INTO v_ev_bill, v_ev_recorded, v_ev_payload FROM mvp_events WHERE id = v_approval;
  SELECT stay_id, vacated_at INTO v_v_stay, v_v_vacated FROM effective_room_vacations WHERE admission_id = v_e_id LIMIT 1;
  IF NEW.bill_seal_id IS NOT NULL OR v_approval IS NULL OR NOT (NEW.mvp_finance_id <=> v_approval) OR NOT (NEW.bill_version <=> v_e_bill) OR NOT (v_ev_bill <=> v_e_bill) OR NEW.departed_at < v_ev_recorded OR NEW.departed_at < v_v_vacated OR NOT (v_v_stay <=> v_st_id) OR NEW.departed_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.departed_at
     OR NOT EXISTS(SELECT 1 FROM mvp_events d WHERE d.admission_id = v_e_id AND d.action = 'deliver' AND (JSON_VALUE(d.payload, '$.kind') COLLATE utf8mb4_nopad_bin) = 'FINAL' AND (LOWER(JSON_VALUE(d.payload, '$.financeId')) COLLATE utf8mb4_nopad_bin) = (CAST(v_approval AS CHAR) COLLATE utf8mb4_nopad_bin) AND (CASE WHEN JSON_VALUE(d.payload, '$.deliveredAt') REGEXP '[+-][0-9][0-9]:[0-9][0-9]$' THEN CONVERT_TZ(CAST(LEFT(JSON_VALUE(d.payload, '$.deliveredAt'), CHAR_LENGTH(JSON_VALUE(d.payload, '$.deliveredAt')) - 6) AS DATETIME(6)), RIGHT(JSON_VALUE(d.payload, '$.deliveredAt'), 6), '+00:00') ELSE CAST(TRIM(TRAILING 'Z' FROM JSON_VALUE(d.payload, '$.deliveredAt')) AS DATETIME(6)) END) <= NEW.departed_at)
     OR NOT EXISTS(SELECT 1 FROM nursing_shifts n WHERE n.admission_id = v_e_id AND n.nurse_id = NEW.signed_by AND n.started_at <= NEW.departed_at AND NOT EXISTS(SELECT 1 FROM effective_shift_ends x WHERE x.shift_id = n.id AND x.ended_at < NEW.departed_at))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual assigned-Nurse exit requires current finance and prior exact paper delivery'; END IF;
  SET @ignored = mvp_finance_guard(v_e_id, v_ev_payload);
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_authority_source table=mvp_transfer_authorities timing=BEFORE event=INSERT pg_name=mvp_transfer_authority_source
DROP TRIGGER IF EXISTS `mvp_transfer_authority_source`;
CREATE TRIGGER `mvp_transfer_authority_source` BEFORE INSERT ON `mvp_transfer_authorities` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_dummy VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_dd_id UUID DEFAULT NULL;
  DECLARE v_dd_active TINYINT DEFAULT NULL;
  DECLARE v_dd_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_bed UUID DEFAULT NULL;
  DECLARE v_s_started DATETIME(6) DEFAULT NULL;
  DECLARE v_a_id UUID DEFAULT NULL;
  DECLARE v_a_version INT DEFAULT NULL;
  DECLARE v_a_stay UUID DEFAULT NULL;
  DECLARE v_a_time DATETIME(6) DEFAULT NULL;
  DECLARE v_latest INT DEFAULT NULL;
  DECLARE v_category LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  SELECT id INTO v_dummy FROM staff_user WHERE id = NEW.recorded_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NOT (v_e_wv <=> 2) OR NOT (v_e_status <=> 'ADMITTED') OR NOT mvp_assigned(v_e_id, NEW.recorded_by) OR NEW.recorded_at > UTC_TIMESTAMP(6) OR NEW.source_time > NEW.recorded_at OR NEW.source_time < v_e_admitted
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned active Nurse must record external authority for the active MVP episode'; END IF;
  SET v_key = CONCAT('doctor-directory:', NEW.external_doctor_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SELECT id, active, name INTO v_dd_id, v_dd_active, v_dd_name FROM doctor_directory_versions WHERE doctor_id = NEW.external_doctor_id ORDER BY `version` DESC LIMIT 1;
  IF v_dd_id IS NULL OR NOT v_dd_active OR NOT (v_dd_name <=> NEW.authorizer_name) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Named current external Doctor directory source required'; END IF;
  SELECT id, bed_id, started_at INTO v_s_id, v_s_bed, v_s_started FROM effective_room_stays WHERE admission_id = v_e_id AND ended_at IS NULL LIMIT 1;
  IF v_s_id IS NULL OR NOT (v_s_bed <=> v_e_bed) OR NEW.source_time < v_s_started THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer instruction must bind the current occupied physical stay'; END IF;
  SELECT id, `version`, source_stay_id, source_time INTO v_a_id, v_a_version, v_a_stay, v_a_time FROM mvp_transfer_authorities WHERE admission_id = v_e_id ORDER BY `version` DESC LIMIT 1;
  SET v_latest = COALESCE(v_a_version, 0);
  SET v_category = (SELECT payload FROM setting_versions WHERE hospital_id = v_e_hosp AND (JSON_VALUE(payload, '$.type') COLLATE utf8mb4_nopad_bin) = 'bed-category' AND (JSON_VALUE(payload, '$.code') COLLATE utf8mb4_nopad_bin) = NEW.destination_category ORDER BY `version` DESC LIMIT 1);
  IF NOT (NEW.source_stay_id <=> v_s_id) OR NEW.`version` <> v_latest + 1 OR NEW.admission_version <> v_e_ver
     OR NOT COALESCE(COALESCE(JSON_VALUE(v_category, '$.active') IN ('true','1'), 0), 0) OR (v_a_id IS NOT NULL AND NEW.source_time < v_a_time)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current admission version, source stay, configured category and latest external instruction required'; END IF;
  UPDATE admissions SET `version` = `version` + 1 WHERE id = v_e_id;
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_cancellation_source table=mvp_transfer_cancellations timing=BEFORE event=INSERT pg_name=mvp_transfer_cancellation_source
DROP TRIGGER IF EXISTS `mvp_transfer_cancellation_source`;
CREATE TRIGGER `mvp_transfer_cancellation_source` BEFORE INSERT ON `mvp_transfer_cancellations` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_dummy VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_dd_id UUID DEFAULT NULL;
  DECLARE v_dd_active TINYINT DEFAULT NULL;
  DECLARE v_dd_name TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_bed UUID DEFAULT NULL;
  DECLARE v_s_started DATETIME(6) DEFAULT NULL;
  DECLARE v_a_id UUID DEFAULT NULL;
  DECLARE v_a_version INT DEFAULT NULL;
  DECLARE v_a_stay UUID DEFAULT NULL;
  DECLARE v_a_time DATETIME(6) DEFAULT NULL;
  DECLARE v_latest INT DEFAULT NULL;
  DECLARE v_category LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  SELECT id INTO v_dummy FROM staff_user WHERE id = NEW.recorded_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF NOT (v_e_wv <=> 2) OR NOT (v_e_status <=> 'ADMITTED') OR NOT mvp_assigned(v_e_id, NEW.recorded_by) OR NEW.recorded_at > UTC_TIMESTAMP(6) OR NEW.source_time > NEW.recorded_at OR NEW.source_time < v_e_admitted
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Assigned active Nurse must record external authority for the active MVP episode'; END IF;
  SET v_key = CONCAT('doctor-directory:', NEW.external_doctor_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SELECT id, active, name INTO v_dd_id, v_dd_active, v_dd_name FROM doctor_directory_versions WHERE doctor_id = NEW.external_doctor_id ORDER BY `version` DESC LIMIT 1;
  IF v_dd_id IS NULL OR NOT v_dd_active OR NOT (v_dd_name <=> NEW.authorizer_name) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Named current external Doctor directory source required'; END IF;
  SELECT id, bed_id, started_at INTO v_s_id, v_s_bed, v_s_started FROM effective_room_stays WHERE admission_id = v_e_id AND ended_at IS NULL LIMIT 1;
  IF v_s_id IS NULL OR NOT (v_s_bed <=> v_e_bed) OR NEW.source_time < v_s_started THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer instruction must bind the current occupied physical stay'; END IF;
  SELECT id, `version`, source_stay_id, source_time INTO v_a_id, v_a_version, v_a_stay, v_a_time FROM mvp_transfer_authorities WHERE admission_id = v_e_id ORDER BY `version` DESC LIMIT 1;
  IF v_a_id IS NULL OR NOT (v_a_id <=> NEW.authority_id) OR NOT (v_a_stay <=> v_s_id) OR NEW.source_time < v_a_time
     OR EXISTS(SELECT 1 FROM admission_transfers WHERE mvp_authority_id = v_a_id)
     OR EXISTS(SELECT 1 FROM mvp_transfer_cancellations WHERE authority_id = v_a_id)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the current truly unperformed transfer may be withdrawn by recorded external instruction'; END IF;
  UPDATE admissions SET `version` = `version` + 1 WHERE id = v_e_id;
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_movement_source table=admission_transfers timing=BEFORE event=INSERT pg_name=mvp_transfer_movement_source
DROP TRIGGER IF EXISTS `mvp_transfer_movement_source`;
CREATE TRIGGER `mvp_transfer_movement_source` BEFORE INSERT ON `admission_transfers` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_wv INT DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bill INT DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_e_route TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_bed UUID DEFAULT NULL;
  DECLARE v_e_hosp UUID DEFAULT NULL;
  DECLARE v_e_ver INT DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_dummy VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_dummy_bed UUID DEFAULT NULL;
  DECLARE v_a_id UUID DEFAULT NULL;
  DECLARE v_a_adm UUID DEFAULT NULL;
  DECLARE v_a_stay UUID DEFAULT NULL;
  DECLARE v_a_time DATETIME(6) DEFAULT NULL;
  DECLARE v_a_dest TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_p_id UUID DEFAULT NULL;
  DECLARE v_p_adm UUID DEFAULT NULL;
  DECLARE v_p_bed UUID DEFAULT NULL;
  DECLARE v_p_started DATETIME(6) DEFAULT NULL;
  DECLARE v_p_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_p_rec DATETIME(6) DEFAULT NULL;
  DECLARE v_p_tariff UUID DEFAULT NULL;
  DECLARE v_f_id UUID DEFAULT NULL;
  DECLARE v_f_adm UUID DEFAULT NULL;
  DECLARE v_f_bed UUID DEFAULT NULL;
  DECLARE v_f_started DATETIME(6) DEFAULT NULL;
  DECLARE v_f_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_f_tariff UUID DEFAULT NULL;
  DECLARE v_sh_id UUID DEFAULT NULL;
  DECLARE v_sh_adm UUID DEFAULT NULL;
  DECLARE v_sh_nurse VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_sh_started DATETIME(6) DEFAULT NULL;
  DECLARE v_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_policy LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_elapsed DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_unit_ms DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_rate DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_due DECIMAL(30,6) DEFAULT NULL;
  DECLARE v_net DECIMAL(30,6) DEFAULT NULL;
  SELECT id INTO v_dummy FROM staff_user WHERE id = NEW.signed_by LOCK IN SHARE MODE;
  SELECT id, workflow_version, status, bill_revision, admitted_at, payment_route, bed_id, hospital_id, `version`, patient_id
    INTO v_e_id, v_e_wv, v_e_status, v_e_bill, v_e_admitted, v_e_route, v_e_bed, v_e_hosp, v_e_ver, v_e_patient
    FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  IF v_e_wv = 1 THEN
    IF NEW.transfer_order_id IS NULL OR NEW.mvp_authority_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy transfer retains its original Doctor order'; END IF;
    LEAVE trg;
  END IF;
  IF NOT (v_e_wv <=> 2) OR NOT (v_e_status <=> 'ADMITTED') OR NEW.transfer_order_id IS NOT NULL OR NEW.mvp_authority_id IS NULL OR NOT mvp_assigned(v_e_id, NEW.signed_by)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MVP transfer requires current assigned Nurse and separate external authority'; END IF;
  SELECT id, admission_id, source_stay_id, source_time, destination_category INTO v_a_id, v_a_adm, v_a_stay, v_a_time, v_a_dest FROM mvp_transfer_authorities WHERE id = NEW.mvp_authority_id;
  SELECT id, admission_id, bed_id, started_at, ended_at, last_reconciled_at, tariff_version_id INTO v_p_id, v_p_adm, v_p_bed, v_p_started, v_p_ended, v_p_rec, v_p_tariff FROM effective_room_stays WHERE id = NEW.old_stay_id;
  SELECT id, admission_id, bed_id, started_at, ended_at, tariff_version_id INTO v_f_id, v_f_adm, v_f_bed, v_f_started, v_f_ended, v_f_tariff FROM effective_room_stays WHERE id = NEW.new_stay_id;
  SELECT id, admission_id, nurse_id, started_at INTO v_sh_id, v_sh_adm, v_sh_nurse, v_sh_started FROM nursing_shifts WHERE id = NEW.shift_id;
  SET v_ended = (SELECT ended_at FROM effective_shift_ends WHERE shift_id = NEW.shift_id LIMIT 1);
  -- both physical beds are locked in sorted order
  IF CAST(NEW.old_bed_id AS CHAR) <= CAST(NEW.target_bed_id AS CHAR) THEN
    SELECT id INTO v_dummy_bed FROM beds WHERE id = NEW.old_bed_id FOR UPDATE;
    SELECT id INTO v_dummy_bed FROM beds WHERE id = NEW.target_bed_id FOR UPDATE;
  ELSE
    SELECT id INTO v_dummy_bed FROM beds WHERE id = NEW.target_bed_id FOR UPDATE;
    SELECT id INTO v_dummy_bed FROM beds WHERE id = NEW.old_bed_id FOR UPDATE;
  END IF;
  IF v_a_id IS NULL OR NOT (v_a_adm <=> v_e_id) OR NOT (v_a_stay <=> v_p_id)
     OR NOT (v_a_id <=> (SELECT id FROM mvp_transfer_authorities WHERE admission_id = v_e_id ORDER BY `version` DESC LIMIT 1))
     OR EXISTS(SELECT 1 FROM mvp_transfer_cancellations WHERE authority_id = v_a_id)
     OR EXISTS(SELECT 1 FROM admission_transfers WHERE mvp_authority_id = v_a_id)
     OR v_p_id IS NULL OR v_f_id IS NULL OR NOT (v_p_adm <=> v_e_id) OR NOT (v_f_adm <=> v_e_id)
     OR NOT (v_p_bed <=> NEW.old_bed_id) OR NOT (v_f_bed <=> NEW.target_bed_id) OR NEW.old_bed_id = NEW.target_bed_id
     OR NOT (v_p_ended <=> NEW.transferred_at) OR NOT (v_f_started <=> NEW.transferred_at) OR v_f_ended IS NOT NULL
     OR v_p_started >= NEW.transferred_at OR NOT (v_p_rec <=> NEW.transferred_at)
     OR NEW.transferred_at < v_a_time OR NEW.transferred_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.transferred_at OR NEW.signed_at > UTC_TIMESTAMP(6)
     OR v_sh_id IS NULL OR NOT (v_sh_adm <=> v_e_id) OR NOT (v_sh_nurse <=> NEW.signed_by) OR NEW.transferred_at < v_sh_started OR (v_ended IS NOT NULL AND NEW.transferred_at > v_ended)
     OR NOT (v_e_bed <=> NEW.target_bed_id) OR CHAR_LENGTH(TRIM(NEW.handover)) < 3
     OR NOT EXISTS(SELECT 1 FROM beds WHERE id = NEW.old_bed_id AND active = 1)
     OR NOT EXISTS(SELECT 1 FROM beds WHERE id = NEW.target_bed_id AND active = 1 AND category = v_a_dest)
     OR NOT (v_f_tariff <=> (SELECT id FROM setting_versions WHERE hospital_id = v_e_hosp AND (JSON_VALUE(payload, '$.type') COLLATE utf8mb4_nopad_bin) = 'tariff' AND (JSON_VALUE(payload, '$.category') COLLATE utf8mb4_nopad_bin) = v_a_dest ORDER BY `version` DESC LIMIT 1))
     OR NOT COALESCE((SELECT COALESCE(JSON_VALUE(payload, '$.active') IN ('true','1'), 0) FROM setting_versions WHERE hospital_id = v_e_hosp AND (JSON_VALUE(payload, '$.type') COLLATE utf8mb4_nopad_bin) = 'bed-category' AND (JSON_VALUE(payload, '$.code') COLLATE utf8mb4_nopad_bin) = v_a_dest ORDER BY `version` DESC LIMIT 1), 0)
     OR NOT EXISTS(SELECT 1 FROM bed_holds WHERE bed_id = NEW.target_bed_id AND admission_id = v_e_id AND held_at = NEW.transferred_at)
     OR EXISTS(SELECT 1 FROM effective_bed_turnovers t LEFT JOIN bed_turnover_completions c ON c.turnover_id = t.id WHERE t.bed_id = NEW.target_bed_id AND (c.id IS NULL OR c.completed_at > NEW.transferred_at))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold'; END IF;
  IF EXISTS(SELECT 1 FROM (
       SELECT signed_at AS ts FROM clinical_rounds WHERE admission_id = v_e_id
       UNION ALL SELECT signed_at FROM clinical_orders WHERE admission_id = v_e_id
       UNION ALL SELECT signed_at FROM clinical_summaries WHERE admission_id = v_e_id
       UNION ALL SELECT ev.signed_at FROM clinical_task_events ev JOIN clinical_orders o ON o.id = ev.order_id WHERE o.admission_id = v_e_id
       UNION ALL SELECT ad.signed_at FROM clinical_addenda ad JOIN clinical_rounds r ON r.id = ad.note_id WHERE r.admission_id = v_e_id
       UNION ALL SELECT actual_at FROM medication_administrations WHERE admission_id = v_e_id
       UNION ALL SELECT observed_at FROM nursing_observations WHERE admission_id = v_e_id
       UNION ALL SELECT started_at FROM nursing_shifts WHERE admission_id = v_e_id
       UNION ALL SELECT x.ended_at FROM effective_shift_ends x JOIN nursing_shifts n ON n.id = x.shift_id WHERE n.admission_id = v_e_id
     ) history WHERE history.ts > NEW.transferred_at)
     OR EXISTS(SELECT 1 FROM nursing_consumables WHERE stay_id = v_p_id AND used_at >= NEW.transferred_at)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer cannot predate recorded actual care or source-stay use'; END IF;
  -- Reuse the original pinned tariff's integer-paise cumulative formula at this exact cutoff.
  SET v_policy = (SELECT payload FROM setting_versions WHERE id = v_p_tariff);
  SET v_elapsed = GREATEST(0, FLOOR(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', NEW.transferred_at) / 1000) - FLOOR(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', v_p_started) / 1000) - COALESCE(CAST(JSON_VALUE(v_policy, '$.graceMinutes') AS DECIMAL(30,6)), 0) * 60000);
  SET v_unit_ms = CASE WHEN (JSON_VALUE(v_policy, '$.basis') COLLATE utf8mb4_nopad_bin) = 'hour' THEN 3600000 ELSE 86400000 END;
  SET v_rate = CAST(JSON_VALUE(v_policy, '$.amount') AS DECIMAL(30,6));
  SET v_due = CASE WHEN (JSON_VALUE(v_policy, '$.rounding') COLLATE utf8mb4_nopad_bin) = 'started-unit' THEN ((v_elapsed + v_unit_ms - 1) DIV v_unit_ms) * v_rate ELSE (v_elapsed * v_rate + v_unit_ms / 2) DIV v_unit_ms END;
  SELECT COALESCE(SUM(ch.amount_paise - COALESCE((SELECT SUM(amount_paise) FROM charge_reversals WHERE charge_id = ch.id), 0)), 0) INTO v_net
    FROM charges ch WHERE ch.admission_id = v_e_id AND ch.source_event_id LIKE CONCAT('room:', (CAST(v_p_id AS CHAR) COLLATE utf8mb4_nopad_bin), ':%');
  IF NOT (v_net <=> v_due) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Original room-use charges must reconcile through the exact transfer cutoff'; END IF;
END
-- END TRIGGER

-- TRIGGER name=paperwork_followup_guard table=paperwork_followups timing=BEFORE event=INSERT pg_name=paperwork_followup_guard
DROP TRIGGER IF EXISTS `paperwork_followup_guard`;
CREATE TRIGGER `paperwork_followup_guard` BEFORE INSERT ON `paperwork_followups` FOR EACH ROW
trg: BEGIN
  DECLARE v_p_run UUID DEFAULT NULL;
  DECLARE v_p_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_p_action TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  SELECT run_id, recorded_by, (JSON_VALUE(packet, '$.staffNextAction') COLLATE utf8mb4_nopad_bin) INTO v_p_run, v_p_by, v_p_action FROM paperwork_packets WHERE id = NEW.packet_id;
  IF NOT (v_p_run <=> NEW.run_id) OR NOT (v_p_by <=> NEW.owner_id) OR NOT (NEW.recorded_by <=> v_p_by) OR NOT (NEW.action <=> v_p_action) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Follow-up requires its reviewed packet and accountable staff owner';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=paperwork_packet_guard table=paperwork_packets timing=BEFORE event=INSERT pg_name=paperwork_packet_guard
DROP TRIGGER IF EXISTS `paperwork_packet_guard`;
CREATE TRIGGER `paperwork_packet_guard` BEFORE INSERT ON `paperwork_packets` FOR EACH ROW
trg: BEGIN
  DECLARE v_pr_run UUID DEFAULT NULL;
  DECLARE v_pr_rev INT DEFAULT NULL;
  DECLARE v_pr_packet LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_rv_id UUID DEFAULT NULL;
  DECLARE v_rv_run UUID DEFAULT NULL;
  DECLARE v_rv_rev INT DEFAULT NULL;
  DECLARE v_rv_decision TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_rv_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_ru_pending UUID DEFAULT NULL;
  DECLARE v_ru_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  SELECT run_id, revision, packet INTO v_pr_run, v_pr_rev, v_pr_packet FROM paperwork_proposals WHERE id = NEW.proposal_id;
  SELECT id, run_id, revision, decision, recorded_by INTO v_rv_id, v_rv_run, v_rv_rev, v_rv_decision, v_rv_by FROM paperwork_reviews WHERE id = NEW.review_id;
  SELECT pending_review_id, status INTO v_ru_pending, v_ru_status FROM paperwork_runs WHERE id = NEW.run_id;
  IF NOT (v_pr_run <=> NEW.run_id) OR NOT (v_rv_run <=> NEW.run_id)
     OR NOT (v_pr_rev <=> v_rv_rev) OR NOT (v_rv_decision <=> 'ACCEPT')
     OR NOT COALESCE(JSON_EQUALS(NEW.packet, v_pr_packet), 0) OR NOT (NEW.recorded_by <=> v_rv_by)
     OR NOT (v_ru_pending <=> v_rv_id) OR NOT (v_ru_status <=> 'PROCESSING') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Packet requires its exact pending human acceptance';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=patient_identification_source table=patient_identifications timing=BEFORE event=INSERT pg_name=patient_identification_source
DROP TRIGGER IF EXISTS `patient_identification_source`;
CREATE TRIGGER `patient_identification_source` BEFORE INSERT ON `patient_identifications` FOR EACH ROW
trg: BEGIN
  DECLARE v_lock VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_patient UUID DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_disp TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  -- row lock on the admission (PostgreSQL: UPDATE .. SET version=version RETURNING *)
  SELECT id, patient_id INTO v_e_id, v_e_patient FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SET v_key = CONCAT('patient-identification:', NEW.patient_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_lock FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
  SELECT admission_id, `type`, disposition INTO v_x_adm, v_x_type, v_x_disp FROM admin_exceptions WHERE id = NEW.exception_id;
  IF NOT (v_e_patient <=> NEW.patient_id) OR NOT (v_x_adm <=> v_e_id) OR v_x_type <> 'URGENT_ADMISSION' OR v_x_disp <> 'ACTIVATE'
     OR NOT EXISTS(SELECT 1 FROM patients WHERE id = NEW.patient_id AND identity_status = 'TEMPORARY')
     OR NOT EXISTS(SELECT 1 FROM staff_user WHERE id = NEW.signed_by AND role = 'ADMISSION' AND banned = 0)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attributable admission-desk identification requires original urgent authority'; END IF;
  IF NEW.`version` <> COALESCE((SELECT MAX(`version`) FROM patient_identifications WHERE patient_id = NEW.patient_id), 0) + 1 OR NEW.date_of_birth > UTC_DATE()
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Identity version or date is invalid'; END IF;
END
-- END TRIGGER

-- TRIGGER name=pharmacy_batch_identity_immutable table=pharmacy_batches timing=BEFORE event=UPDATE pg_name=pharmacy_batch_identity_immutable
DROP TRIGGER IF EXISTS `pharmacy_batch_identity_immutable`;
CREATE TRIGGER `pharmacy_batch_identity_immutable` BEFORE UPDATE ON `pharmacy_batches` FOR EACH ROW
trg: BEGIN

  -- every column except available_quantity is immutable
  IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.hospital_id <=> OLD.hospital_id) OR NOT (NEW.medicine_id <=> OLD.medicine_id) OR NOT (NEW.catalog_version_id <=> OLD.catalog_version_id)
     OR NOT (NEW.batch_no <=> OLD.batch_no) OR NOT (NEW.expires_on <=> OLD.expires_on) OR NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.quantity_scale <=> OLD.quantity_scale)
     OR NOT (NEW.barcode <=> OLD.barcode) OR NOT (NEW.reorder_threshold <=> OLD.reorder_threshold) OR NOT (NEW.signed_by <=> OLD.signed_by) OR NOT (NEW.signed_at <=> OLD.signed_at)
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Medicine batch identity is immutable; append a new batch or audited movement'; END IF;
END
-- END TRIGGER
