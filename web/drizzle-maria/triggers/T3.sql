-- T3.sql: MariaDB 11.8 port of PostgreSQL trigger group T3 (generated blocks; one MariaDB trigger per event).
-- Source: tmp/port/pg-final-schema.sql functions guard_physical_bed_timeline .. validate_transfer_boundary (non-helper RETURNS trigger ones)
-- and the 120 CREATE TRIGGER statements that execute them. No CONSTRAINT TRIGGERs belong to this group.
-- Helper calls use SET v_ignored = fn(..) (DO would swallow the SIGNAL). Requires 0001_tables.sql, 0002_helpers.sql (invalidate_clearances) and 0003_views.sql (effective_* views).
-- Block format: header line, DROP TRIGGER IF EXISTS, one CREATE TRIGGER (no DELIMITER), '-- END TRIGGER'.
--
-- Translation rules used in every block
--  * RAISE EXCEPTION -> SIGNAL SQLSTATE '45000' with the identical message text (original ERRCODE 23514/23P01 is not carried).
--  * UPDATE x SET c=c (row-lock idiom) and PERFORM .. FOR UPDATE -> SELECT .. INTO .. FOR UPDATE (locks without writing or firing triggers).
--  * ON CONFLICT DO NOTHING -> INSERT IGNORE (ON DUPLICATE KEY UPDATE would fire the BEFORE UPDATE immutability triggers).
--  * pg_advisory_xact_lock -> hims_locks row lock (INSERT IGNORE + SELECT .. FOR UPDATE).
--  * tstzrange(..) && tstzrange(..) -> explicit half-open comparison, NULL end = unbounded, empty range overlaps nothing.
--  * UPDATE OF <cols> triggers become AFTER/BEFORE UPDATE triggers that run only when one of the listed columns CHANGED value
--    (PostgreSQL fired when the column was merely named in SET; an update that rewrites the same value no longer fires).
--  * WHEN (..) clauses become an IF around the body. TG_TABLE_NAME / TG_ARGV are resolved statically per table.
--  * Local variables are prefixed v_ and declared with the table collation so they never shadow columns or mix collations.
--  * invalidate_clearance_source reads the key columns present in each table (to_jsonb(NEW) ? 'key' in PostgreSQL), decided at generation time.

-- TRIGGER name=admin_exception_immutable_del table=admin_exceptions timing=BEFORE event=DELETE pg_name=admin_exception_immutable
DROP TRIGGER IF EXISTS `admin_exception_immutable_del`;
CREATE TRIGGER `admin_exception_immutable_del` BEFORE DELETE ON `admin_exceptions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=admin_exception_immutable_upd table=admin_exceptions timing=BEFORE event=UPDATE pg_name=admin_exception_immutable
DROP TRIGGER IF EXISTS `admin_exception_immutable_upd`;
CREATE TRIGGER `admin_exception_immutable_upd` BEFORE UPDATE ON `admin_exceptions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=administrative_shift_end_clearance table=administrative_shift_ends timing=AFTER event=INSERT pg_name=administrative_shift_end_clearance
DROP TRIGGER IF EXISTS `administrative_shift_end_clearance`;
CREATE TRIGGER `administrative_shift_end_clearance` AFTER INSERT ON `administrative_shift_ends` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'administrative_shift_ends', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=administrative_shift_end_immutable_del table=administrative_shift_ends timing=BEFORE event=DELETE pg_name=administrative_shift_end_immutable
DROP TRIGGER IF EXISTS `administrative_shift_end_immutable_del`;
CREATE TRIGGER `administrative_shift_end_immutable_del` BEFORE DELETE ON `administrative_shift_ends` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=administrative_shift_end_immutable_upd table=administrative_shift_ends timing=BEFORE event=UPDATE pg_name=administrative_shift_end_immutable
DROP TRIGGER IF EXISTS `administrative_shift_end_immutable_upd`;
CREATE TRIGGER `administrative_shift_end_immutable_upd` BEFORE UPDATE ON `administrative_shift_ends` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=admission_transfers_clearance table=admission_transfers timing=AFTER event=INSERT pg_name=admission_transfers_clearance
DROP TRIGGER IF EXISTS `admission_transfers_clearance`;
CREATE TRIGGER `admission_transfers_clearance` AFTER INSERT ON `admission_transfers` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'admission_transfers', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_movement_invalidates table=admission_transfers timing=AFTER event=INSERT pg_name=mvp_transfer_movement_invalidates
DROP TRIGGER IF EXISTS `mvp_transfer_movement_invalidates`;
CREATE TRIGGER `mvp_transfer_movement_invalidates` AFTER INSERT ON `admission_transfers` FOR EACH ROW
BEGIN
  IF NEW.mvp_authority_id IS NOT NULL THEN
    INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT m.id, 'admission_transfers', CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.action IN ('doctor-approval','checklist','check','n-a','finance');
  END IF;
END
-- END TRIGGER

-- TRIGGER name=admission_transfers_immutable_del table=admission_transfers timing=BEFORE event=DELETE pg_name=admission_transfers_immutable
DROP TRIGGER IF EXISTS `admission_transfers_immutable_del`;
CREATE TRIGGER `admission_transfers_immutable_del` BEFORE DELETE ON `admission_transfers` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=exact_transfer_boundary table=admission_transfers timing=BEFORE event=INSERT pg_name=exact_transfer_boundary
DROP TRIGGER IF EXISTS `exact_transfer_boundary`;
CREATE TRIGGER `exact_transfer_boundary` BEFORE INSERT ON `admission_transfers` FOR EACH ROW
BEGIN
  IF NEW.transfer_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM effective_room_stays previous_stay JOIN effective_room_stays next_stay ON next_stay.id = NEW.new_stay_id
      JOIN transfer_orders o ON o.id = NEW.transfer_order_id
      JOIN nursing_shifts s ON s.id = NEW.shift_id
      WHERE previous_stay.id = NEW.old_stay_id AND previous_stay.admission_id = NEW.admission_id AND next_stay.admission_id = NEW.admission_id
      AND o.admission_id = NEW.admission_id AND o.source_stay_id = previous_stay.id AND s.admission_id = NEW.admission_id AND s.nurse_id = NEW.signed_by
      AND previous_stay.bed_id = NEW.old_bed_id AND next_stay.bed_id = NEW.target_bed_id AND previous_stay.bed_id <> next_stay.bed_id
      AND previous_stay.ended_at = NEW.transferred_at AND next_stay.started_at = NEW.transferred_at
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer must retain exact adjacent stays and episode/signature provenance';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=transfer_current_authority table=admission_transfers timing=BEFORE event=INSERT pg_name=transfer_current_authority
DROP TRIGGER IF EXISTS `transfer_current_authority`;
CREATE TRIGGER `transfer_current_authority` BEFORE INSERT ON `admission_transfers` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_doctor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_id UUID DEFAULT NULL;
  DECLARE v_o_adm UUID DEFAULT NULL;
  DECLARE v_o_source UUID DEFAULT NULL;
  DECLARE v_o_signed DATETIME(6) DEFAULT NULL;
  IF NEW.transfer_order_id IS NOT NULL THEN
    SELECT a.id, a.status, a.admitting_doctor_id INTO v_e_id, v_e_status, v_e_doctor FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
    SELECT o.id, o.admission_id, o.source_stay_id, o.signed_at INTO v_o_id, v_o_adm, v_o_source, v_o_signed FROM transfer_orders o WHERE o.id = NEW.transfer_order_id;
    IF NOT (v_e_status <=> 'ADMITTED') OR NOT (v_o_adm <=> v_e_id) OR NOT (v_o_source <=> NEW.old_stay_id)
       OR NOT (v_o_id <=> (SELECT t.id FROM transfer_orders t WHERE t.admission_id = v_e_id ORDER BY t.version DESC LIMIT 1))
       OR EXISTS(SELECT 1 FROM transfer_order_cancellations c WHERE c.transfer_order_id = v_o_id AND NOT (NEW.transferred_at < c.signed_at AND EXISTS(
        SELECT 1 FROM effective_room_stays st JOIN stay_boundary_amendments m ON m.id = st.amendment_id JOIN admin_exceptions x ON x.id = m.exception_id JOIN exception_evidence p ON p.id = m.evidence_id
        WHERE st.id = NEW.old_stay_id AND m.admission_id = v_e_id AND x.type = 'DELAYED_TRANSFER' AND x.disposition = 'TRANSFER' AND x.admission_id = v_e_id AND JSON_CONTAINS(x.evidence_ids, JSON_QUOTE(CAST(p.id AS CHAR))) AND p.kind = 'TRANSFER_HANDOVER' AND p.source_id = v_o_id AND p.actual_at = NEW.transferred_at AND p.signed_by = NEW.signed_by)))
    THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual transfer cannot consume cancelled or superseded authority';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=admission_transfers_immutable_upd table=admission_transfers timing=BEFORE event=UPDATE pg_name=admission_transfers_immutable
DROP TRIGGER IF EXISTS `admission_transfers_immutable_upd`;
CREATE TRIGGER `admission_transfers_immutable_upd` BEFORE UPDATE ON `admission_transfers` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=allocation_cancellations_clearance table=allocation_cancellations timing=AFTER event=INSERT pg_name=allocation_cancellations_clearance
DROP TRIGGER IF EXISTS `allocation_cancellations_clearance`;
CREATE TRIGGER `allocation_cancellations_clearance` AFTER INSERT ON `allocation_cancellations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT c.admission_id INTO v_episode FROM receipt_allocations a JOIN receipts c ON c.id = a.receipt_id WHERE a.id = NEW.allocation_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'allocation_cancellations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=allocation_cancellations_immutable_del table=allocation_cancellations timing=BEFORE event=DELETE pg_name=allocation_cancellations_immutable
DROP TRIGGER IF EXISTS `allocation_cancellations_immutable_del`;
CREATE TRIGGER `allocation_cancellations_immutable_del` BEFORE DELETE ON `allocation_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=allocation_cancellations_immutable_upd table=allocation_cancellations timing=BEFORE event=UPDATE pg_name=allocation_cancellations_immutable
DROP TRIGGER IF EXISTS `allocation_cancellations_immutable_upd`;
CREATE TRIGGER `allocation_cancellations_immutable_upd` BEFORE UPDATE ON `allocation_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=availability_coordinator_immutable_del table=availability_coordinators timing=BEFORE event=DELETE pg_name=availability_coordinator_immutable
DROP TRIGGER IF EXISTS `availability_coordinator_immutable_del`;
CREATE TRIGGER `availability_coordinator_immutable_del` BEFORE DELETE ON `availability_coordinators` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=availability_coordinator_immutable_upd table=availability_coordinators timing=BEFORE event=UPDATE pg_name=availability_coordinator_immutable
DROP TRIGGER IF EXISTS `availability_coordinator_immutable_upd`;
CREATE TRIGGER `availability_coordinator_immutable_upd` BEFORE UPDATE ON `availability_coordinators` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=bed_turnover_completions_immutable_del table=bed_turnover_completions timing=BEFORE event=DELETE pg_name=bed_turnover_completions_immutable
DROP TRIGGER IF EXISTS `bed_turnover_completions_immutable_del`;
CREATE TRIGGER `bed_turnover_completions_immutable_del` BEFORE DELETE ON `bed_turnover_completions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=bed_turnover_completions_immutable_upd table=bed_turnover_completions timing=BEFORE event=UPDATE pg_name=bed_turnover_completions_immutable
DROP TRIGGER IF EXISTS `bed_turnover_completions_immutable_upd`;
CREATE TRIGGER `bed_turnover_completions_immutable_upd` BEFORE UPDATE ON `bed_turnover_completions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=bed_turnovers_immutable_del table=bed_turnovers timing=BEFORE event=DELETE pg_name=bed_turnovers_immutable
DROP TRIGGER IF EXISTS `bed_turnovers_immutable_del`;
CREATE TRIGGER `bed_turnovers_immutable_del` BEFORE DELETE ON `bed_turnovers` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=bed_turnovers_immutable_upd table=bed_turnovers timing=BEFORE event=UPDATE pg_name=bed_turnovers_immutable
DROP TRIGGER IF EXISTS `bed_turnovers_immutable_upd`;
CREATE TRIGGER `bed_turnovers_immutable_upd` BEFORE UPDATE ON `bed_turnovers` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=billing_requests_immutable_del table=billing_requests timing=BEFORE event=DELETE pg_name=billing_requests_immutable
DROP TRIGGER IF EXISTS `billing_requests_immutable_del`;
CREATE TRIGGER `billing_requests_immutable_del` BEFORE DELETE ON `billing_requests` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=billing_requests_immutable_upd table=billing_requests timing=BEFORE event=UPDATE pg_name=billing_requests_immutable
DROP TRIGGER IF EXISTS `billing_requests_immutable_upd`;
CREATE TRIGGER `billing_requests_immutable_upd` BEFORE UPDATE ON `billing_requests` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=care_source_clearance_ins table=care_billing_events timing=AFTER event=INSERT pg_name=care_source_clearance
DROP TRIGGER IF EXISTS `care_source_clearance_ins`;
CREATE TRIGGER `care_source_clearance_ins` AFTER INSERT ON `care_billing_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_category = NEW.category;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'care_billing_events', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=care_source_clearance_upd table=care_billing_events timing=AFTER event=UPDATE pg_name=care_source_clearance
DROP TRIGGER IF EXISTS `care_source_clearance_upd`;
CREATE TRIGGER `care_source_clearance_upd` AFTER UPDATE ON `care_billing_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_category = NEW.category;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'care_billing_events', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=charge_finalizations_clearance table=charge_finalizations timing=AFTER event=INSERT pg_name=charge_finalizations_clearance
DROP TRIGGER IF EXISTS `charge_finalizations_clearance`;
CREATE TRIGGER `charge_finalizations_clearance` AFTER INSERT ON `charge_finalizations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT c.admission_id, c.category INTO v_episode, v_category FROM charges c WHERE c.id = NEW.charge_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'charge_finalizations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=charge_finalizations_immutable_del table=charge_finalizations timing=BEFORE event=DELETE pg_name=charge_finalizations_immutable
DROP TRIGGER IF EXISTS `charge_finalizations_immutable_del`;
CREATE TRIGGER `charge_finalizations_immutable_del` BEFORE DELETE ON `charge_finalizations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=charge_finalizations_immutable_upd table=charge_finalizations timing=BEFORE event=UPDATE pg_name=charge_finalizations_immutable
DROP TRIGGER IF EXISTS `charge_finalizations_immutable_upd`;
CREATE TRIGGER `charge_finalizations_immutable_upd` BEFORE UPDATE ON `charge_finalizations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=charge_reversals_clearance table=charge_reversals timing=AFTER event=INSERT pg_name=charge_reversals_clearance
DROP TRIGGER IF EXISTS `charge_reversals_clearance`;
CREATE TRIGGER `charge_reversals_clearance` AFTER INSERT ON `charge_reversals` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT c.admission_id, c.category INTO v_episode, v_category FROM charges c WHERE c.id = NEW.charge_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'charge_reversals', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=mvp_external_reversal_invalidation table=charge_reversals timing=AFTER event=INSERT pg_name=mvp_external_reversal_invalidation
DROP TRIGGER IF EXISTS `mvp_external_reversal_invalidation`;
CREATE TRIGGER `mvp_external_reversal_invalidation` AFTER INSERT ON `charge_reversals` FOR EACH ROW
trg: BEGIN
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  SELECT c.admission_id, c.category INTO v_episode, v_category FROM charges c WHERE c.id = NEW.charge_id;
  IF v_category NOT IN ('consultation','procedure','consumable','lab','radiology') OR NOT EXISTS(SELECT 1 FROM admissions a WHERE a.id = v_episode AND a.workflow_version = 2) THEN
    LEAVE trg;
  END IF;
  INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT ev.id, CONCAT('external-service-', 'charge_reversals'), CAST(NEW.id AS CHAR) FROM mvp_events ev WHERE ev.admission_id = v_episode AND (ev.action = 'finance' OR (ev.action IN ('check','n-a') AND ((v_category IN ('lab','radiology') AND ev.check_key = 'DIAGNOSTICS') OR (v_category = 'consumable' AND ev.check_key = 'NURSING'))));
END
-- END TRIGGER

-- TRIGGER name=charge_reversals_immutable_del table=charge_reversals timing=BEFORE event=DELETE pg_name=charge_reversals_immutable
DROP TRIGGER IF EXISTS `charge_reversals_immutable_del`;
CREATE TRIGGER `charge_reversals_immutable_del` BEFORE DELETE ON `charge_reversals` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=charge_reversals_immutable_upd table=charge_reversals timing=BEFORE event=UPDATE pg_name=charge_reversals_immutable
DROP TRIGGER IF EXISTS `charge_reversals_immutable_upd`;
CREATE TRIGGER `charge_reversals_immutable_upd` BEFORE UPDATE ON `charge_reversals` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=charges_clearance table=charges timing=AFTER event=INSERT pg_name=charges_clearance
DROP TRIGGER IF EXISTS `charges_clearance`;
CREATE TRIGGER `charges_clearance` AFTER INSERT ON `charges` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_category = NEW.category;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'charges', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=mvp_external_charge_invalidation table=charges timing=AFTER event=INSERT pg_name=mvp_external_charge_invalidation
DROP TRIGGER IF EXISTS `mvp_external_charge_invalidation`;
CREATE TRIGGER `mvp_external_charge_invalidation` AFTER INSERT ON `charges` FOR EACH ROW
trg: BEGIN
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  SET v_episode = NEW.admission_id;
  SET v_category = NEW.category;
  IF v_category NOT IN ('consultation','procedure','consumable','lab','radiology') OR NOT EXISTS(SELECT 1 FROM admissions a WHERE a.id = v_episode AND a.workflow_version = 2) THEN
    LEAVE trg;
  END IF;
  INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT ev.id, CONCAT('external-service-', 'charges'), CAST(NEW.id AS CHAR) FROM mvp_events ev WHERE ev.admission_id = v_episode AND (ev.action = 'finance' OR (ev.action IN ('check','n-a') AND ((v_category IN ('lab','radiology') AND ev.check_key = 'DIAGNOSTICS') OR (v_category = 'consumable' AND ev.check_key = 'NURSING'))));
END
-- END TRIGGER

-- TRIGGER name=charges_immutable_del table=charges timing=BEFORE event=DELETE pg_name=charges_immutable
DROP TRIGGER IF EXISTS `charges_immutable_del`;
CREATE TRIGGER `charges_immutable_del` BEFORE DELETE ON `charges` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=charges_immutable_upd table=charges timing=BEFORE event=UPDATE pg_name=charges_immutable
DROP TRIGGER IF EXISTS `charges_immutable_upd`;
CREATE TRIGGER `charges_immutable_upd` BEFORE UPDATE ON `charges` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=clearance_invalidations_immutable_del table=clearance_invalidations timing=BEFORE event=DELETE pg_name=clearance_invalidations_immutable
DROP TRIGGER IF EXISTS `clearance_invalidations_immutable_del`;
CREATE TRIGGER `clearance_invalidations_immutable_del` BEFORE DELETE ON `clearance_invalidations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=clearance_invalidations_immutable_upd table=clearance_invalidations timing=BEFORE event=UPDATE pg_name=clearance_invalidations_immutable
DROP TRIGGER IF EXISTS `clearance_invalidations_immutable_upd`;
CREATE TRIGGER `clearance_invalidations_immutable_upd` BEFORE UPDATE ON `clearance_invalidations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=clearance_seals_immutable_del table=clearance_seals timing=BEFORE event=DELETE pg_name=clearance_seals_immutable
DROP TRIGGER IF EXISTS `clearance_seals_immutable_del`;
CREATE TRIGGER `clearance_seals_immutable_del` BEFORE DELETE ON `clearance_seals` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=clearance_seals_immutable_upd table=clearance_seals timing=BEFORE event=UPDATE pg_name=clearance_seals_immutable
DROP TRIGGER IF EXISTS `clearance_seals_immutable_upd`;
CREATE TRIGGER `clearance_seals_immutable_upd` BEFORE UPDATE ON `clearance_seals` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=clinical_addenda_clearance table=clinical_addenda timing=AFTER event=INSERT pg_name=clinical_addenda_clearance
DROP TRIGGER IF EXISTS `clinical_addenda_clearance`;
CREATE TRIGGER `clinical_addenda_clearance` AFTER INSERT ON `clinical_addenda` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SELECT x.admission_id INTO v_episode FROM clinical_rounds x WHERE x.id = NEW.note_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'clinical_addenda', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=clinical_orders_clearance table=clinical_orders timing=AFTER event=INSERT pg_name=clinical_orders_clearance
DROP TRIGGER IF EXISTS `clinical_orders_clearance`;
CREATE TRIGGER `clinical_orders_clearance` AFTER INSERT ON `clinical_orders` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'clinical_orders', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=clinical_rounds_clearance table=clinical_rounds timing=AFTER event=INSERT pg_name=clinical_rounds_clearance
DROP TRIGGER IF EXISTS `clinical_rounds_clearance`;
CREATE TRIGGER `clinical_rounds_clearance` AFTER INSERT ON `clinical_rounds` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'clinical_rounds', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=clinical_summaries_clearance table=clinical_summaries timing=AFTER event=INSERT pg_name=clinical_summaries_clearance
DROP TRIGGER IF EXISTS `clinical_summaries_clearance`;
CREATE TRIGGER `clinical_summaries_clearance` AFTER INSERT ON `clinical_summaries` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'clinical_summaries', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=clinical_task_events_clearance table=clinical_task_events timing=AFTER event=INSERT pg_name=clinical_task_events_clearance
DROP TRIGGER IF EXISTS `clinical_task_events_clearance`;
CREATE TRIGGER `clinical_task_events_clearance` AFTER INSERT ON `clinical_task_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SELECT x.admission_id INTO v_episode FROM clinical_orders x WHERE x.id = NEW.order_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'clinical_task_events', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=departures_immutable_del table=departures timing=BEFORE event=DELETE pg_name=departures_immutable
DROP TRIGGER IF EXISTS `departures_immutable_del`;
CREATE TRIGGER `departures_immutable_del` BEFORE DELETE ON `departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=departure_physical_guard table=departures timing=BEFORE event=INSERT pg_name=departure_physical_guard
DROP TRIGGER IF EXISTS `departure_physical_guard`;
CREATE TRIGGER `departure_physical_guard` BEFORE INSERT ON `departures` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_rev INT DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_recon DATETIME(6) DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_gate TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_adm UUID DEFAULT NULL;
  DECLARE v_s_signed DATETIME(6) DEFAULT NULL;
  DECLARE v_s_bill INT DEFAULT NULL;
  DECLARE v_n_id UUID DEFAULT NULL;
  DECLARE v_n_adm UUID DEFAULT NULL;
  DECLARE v_n_nurse TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_n_start DATETIME(6) DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  IF NEW.mvp_finance_id IS NULL THEN
    SELECT a.id, a.status, a.bill_revision INTO v_e_id, v_e_status, v_e_rev FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
    SELECT st.id, st.admission_id, st.ended_at, st.last_reconciled_at INTO v_st_id, v_st_adm, v_st_ended, v_st_recon FROM effective_room_stays st WHERE st.id = NEW.stay_id;
    IF NOT (v_e_status <=> 'ADMITTED') OR NOT (v_st_adm <=> v_e_id) OR v_st_ended IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Physical transition requires active episode and closed attributable stay';
    END IF;
    SELECT s.id, s.gate, s.admission_id, s.signed_at, s.bill_version INTO v_s_id, v_s_gate, v_s_adm, v_s_signed, v_s_bill FROM clearance_seals s WHERE s.id = NEW.bill_seal_id;
    SELECT v.stay_id, v.vacated_at INTO v_v_stay, v_v_vacated FROM effective_room_vacations v WHERE v.admission_id = v_e_id LIMIT 1;
    IF NOT (v_s_gate <=> 'BILLING') OR NOT (v_s_adm <=> v_e_id) OR NOT (v_s_bill <=> NEW.bill_version) OR NOT (v_e_rev <=> NEW.bill_version) OR EXISTS(SELECT 1 FROM clearance_invalidations i WHERE i.seal_id = v_s_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current same-episode Billing seal and bill required';
    END IF;
    IF NOT (v_v_stay <=> v_st_id) OR NEW.departed_at < v_v_vacated OR NEW.departed_at < v_s_signed OR NEW.departed_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.departed_at THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual hospital departure must follow room vacancy and human clearance';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.signed_by AND u.role IN ('BILLING','ADMIN') AND NOT u.banned) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing or Admin departure authority required';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=departures_immutable_upd table=departures timing=BEFORE event=UPDATE pg_name=departures_immutable
DROP TRIGGER IF EXISTS `departures_immutable_upd`;
CREATE TRIGGER `departures_immutable_upd` BEFORE UPDATE ON `departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=discharge_document_immutable_del table=discharge_documents timing=BEFORE event=DELETE pg_name=discharge_document_immutable
DROP TRIGGER IF EXISTS `discharge_document_immutable_del`;
CREATE TRIGGER `discharge_document_immutable_del` BEFORE DELETE ON `discharge_documents` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=discharge_document_immutable_upd table=discharge_documents timing=BEFORE event=UPDATE pg_name=discharge_document_immutable
DROP TRIGGER IF EXISTS `discharge_document_immutable_upd`;
CREATE TRIGGER `discharge_document_immutable_upd` BEFORE UPDATE ON `discharge_documents` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=doctor_availability_immutable_del table=doctor_availability timing=BEFORE event=DELETE pg_name=doctor_availability_immutable
DROP TRIGGER IF EXISTS `doctor_availability_immutable_del`;
CREATE TRIGGER `doctor_availability_immutable_del` BEFORE DELETE ON `doctor_availability` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=doctor_availability_immutable_upd table=doctor_availability timing=BEFORE event=UPDATE pg_name=doctor_availability_immutable
DROP TRIGGER IF EXISTS `doctor_availability_immutable_upd`;
CREATE TRIGGER `doctor_availability_immutable_upd` BEFORE UPDATE ON `doctor_availability` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=doctor_directory_version_immutable_del table=doctor_directory_versions timing=BEFORE event=DELETE pg_name=doctor_directory_version_immutable
DROP TRIGGER IF EXISTS `doctor_directory_version_immutable_del`;
CREATE TRIGGER `doctor_directory_version_immutable_del` BEFORE DELETE ON `doctor_directory_versions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=doctor_directory_version_immutable_upd table=doctor_directory_versions timing=BEFORE event=UPDATE pg_name=doctor_directory_version_immutable
DROP TRIGGER IF EXISTS `doctor_directory_version_immutable_upd`;
CREATE TRIGGER `doctor_directory_version_immutable_upd` BEFORE UPDATE ON `doctor_directory_versions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=doctor_directory_immutable_del table=doctor_directory timing=BEFORE event=DELETE pg_name=doctor_directory_immutable
DROP TRIGGER IF EXISTS `doctor_directory_immutable_del`;
CREATE TRIGGER `doctor_directory_immutable_del` BEFORE DELETE ON `doctor_directory` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=doctor_directory_immutable_upd table=doctor_directory timing=BEFORE event=UPDATE pg_name=doctor_directory_immutable
DROP TRIGGER IF EXISTS `doctor_directory_immutable_upd`;
CREATE TRIGGER `doctor_directory_immutable_upd` BEFORE UPDATE ON `doctor_directory` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff directory and availability history is append only';
END
-- END TRIGGER

-- TRIGGER name=exception_doctor_clearance table=exception_evidence timing=AFTER event=INSERT pg_name=exception_doctor_clearance
DROP TRIGGER IF EXISTS `exception_doctor_clearance`;
CREATE TRIGGER `exception_doctor_clearance` AFTER INSERT ON `exception_evidence` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  IF NEW.role = 'DOCTOR' THEN
    SET v_episode = NEW.admission_id;
    IF v_episode IS NULL THEN
      LEAVE trg;
    END IF;
    SET v_ignored = invalidate_clearances(v_episode, v_gate, 'exception_evidence', JSON_ARRAY(CAST(NEW.id AS CHAR)));
  END IF;
END
-- END TRIGGER

-- TRIGGER name=exception_nurse_clearance table=exception_evidence timing=AFTER event=INSERT pg_name=exception_nurse_clearance
DROP TRIGGER IF EXISTS `exception_nurse_clearance`;
CREATE TRIGGER `exception_nurse_clearance` AFTER INSERT ON `exception_evidence` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  IF NEW.role = 'NURSE' THEN
    SET v_episode = NEW.admission_id;
    IF v_episode IS NULL THEN
      LEAVE trg;
    END IF;
    SET v_ignored = invalidate_clearances(v_episode, v_gate, 'exception_evidence', JSON_ARRAY(CAST(NEW.id AS CHAR)));
  END IF;
END
-- END TRIGGER

-- TRIGGER name=exception_evidence_immutable_del table=exception_evidence timing=BEFORE event=DELETE pg_name=exception_evidence_immutable
DROP TRIGGER IF EXISTS `exception_evidence_immutable_del`;
CREATE TRIGGER `exception_evidence_immutable_del` BEFORE DELETE ON `exception_evidence` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_witness_authority table=exception_evidence timing=BEFORE event=INSERT pg_name=transfer_witness_authority
DROP TRIGGER IF EXISTS `transfer_witness_authority`;
CREATE TRIGGER `transfer_witness_authority` BEFORE INSERT ON `exception_evidence` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_doctor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_id UUID DEFAULT NULL;
  DECLARE v_o_adm UUID DEFAULT NULL;
  DECLARE v_o_source UUID DEFAULT NULL;
  DECLARE v_o_signed DATETIME(6) DEFAULT NULL;
  SELECT a.id, a.status, a.admitting_doctor_id INTO v_e_id, v_e_status, v_e_doctor FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
  IF NEW.kind = 'TRANSFER_HANDOVER' THEN
    SELECT o.id, o.admission_id, o.source_stay_id, o.signed_at INTO v_o_id, v_o_adm, v_o_source, v_o_signed FROM transfer_orders o WHERE o.id = NEW.source_id;
    IF NOT (v_e_status <=> 'ADMITTED') OR NOT (v_o_adm <=> v_e_id)
       OR NOT (v_o_id <=> (SELECT t.id FROM transfer_orders t WHERE t.admission_id = v_e_id ORDER BY t.version DESC LIMIT 1))
       OR NOT EXISTS(SELECT 1 FROM effective_room_stays s WHERE s.id = v_o_source AND s.admission_id = v_e_id AND s.ended_at IS NULL)
       OR EXISTS(SELECT 1 FROM transfer_order_cancellations c WHERE c.transfer_order_id = v_o_id AND NEW.actual_at >= c.signed_at)
       OR EXISTS(SELECT 1 FROM admission_transfers t WHERE t.transfer_order_id = v_o_id) OR NEW.actual_at < v_o_signed
    THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Witnessed transfer requires current uncancelled original authority';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=exception_evidence_immutable_upd table=exception_evidence timing=BEFORE event=UPDATE pg_name=exception_evidence_immutable
DROP TRIGGER IF EXISTS `exception_evidence_immutable_upd`;
CREATE TRIGGER `exception_evidence_immutable_upd` BEFORE UPDATE ON `exception_evidence` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=exception_followups_immutable_del table=exception_followups timing=BEFORE event=DELETE pg_name=exception_followups_immutable
DROP TRIGGER IF EXISTS `exception_followups_immutable_del`;
CREATE TRIGGER `exception_followups_immutable_del` BEFORE DELETE ON `exception_followups` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=exception_followups_immutable_upd table=exception_followups timing=BEFORE event=UPDATE pg_name=exception_followups_immutable
DROP TRIGGER IF EXISTS `exception_followups_immutable_upd`;
CREATE TRIGGER `exception_followups_immutable_upd` BEFORE UPDATE ON `exception_followups` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=exceptional_departures_immutable_del table=exceptional_departures timing=BEFORE event=DELETE pg_name=exceptional_departures_immutable
DROP TRIGGER IF EXISTS `exceptional_departures_immutable_del`;
CREATE TRIGGER `exceptional_departures_immutable_del` BEFORE DELETE ON `exceptional_departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=exceptional_departures_immutable_upd table=exceptional_departures timing=BEFORE event=UPDATE pg_name=exceptional_departures_immutable
DROP TRIGGER IF EXISTS `exceptional_departures_immutable_upd`;
CREATE TRIGGER `exceptional_departures_immutable_upd` BEFORE UPDATE ON `exceptional_departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=insurance_conversions_clearance table=insurance_conversions timing=AFTER event=INSERT pg_name=insurance_conversions_clearance
DROP TRIGGER IF EXISTS `insurance_conversions_clearance`;
CREATE TRIGGER `insurance_conversions_clearance` AFTER INSERT ON `insurance_conversions` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT x.admission_id INTO v_episode FROM insurance_cases x WHERE x.id = NEW.case_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'insurance_conversions', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=insurance_conversion_immutable_del table=insurance_conversions timing=BEFORE event=DELETE pg_name=insurance_conversion_immutable
DROP TRIGGER IF EXISTS `insurance_conversion_immutable_del`;
CREATE TRIGGER `insurance_conversion_immutable_del` BEFORE DELETE ON `insurance_conversions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_conversion_immutable_upd table=insurance_conversions timing=BEFORE event=UPDATE pg_name=insurance_conversion_immutable
DROP TRIGGER IF EXISTS `insurance_conversion_immutable_upd`;
CREATE TRIGGER `insurance_conversion_immutable_upd` BEFORE UPDATE ON `insurance_conversions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_decisions_clearance table=insurance_decisions timing=AFTER event=INSERT pg_name=insurance_decisions_clearance
DROP TRIGGER IF EXISTS `insurance_decisions_clearance`;
CREATE TRIGGER `insurance_decisions_clearance` AFTER INSERT ON `insurance_decisions` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT x.admission_id INTO v_episode FROM insurance_cases x WHERE x.id = NEW.case_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'insurance_decisions', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=insurance_decision_immutable_del table=insurance_decisions timing=BEFORE event=DELETE pg_name=insurance_decision_immutable
DROP TRIGGER IF EXISTS `insurance_decision_immutable_del`;
CREATE TRIGGER `insurance_decision_immutable_del` BEFORE DELETE ON `insurance_decisions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_decision_immutable_upd table=insurance_decisions timing=BEFORE event=UPDATE pg_name=insurance_decision_immutable
DROP TRIGGER IF EXISTS `insurance_decision_immutable_upd`;
CREATE TRIGGER `insurance_decision_immutable_upd` BEFORE UPDATE ON `insurance_decisions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_document_immutable_del table=insurance_documents timing=BEFORE event=DELETE pg_name=insurance_document_immutable
DROP TRIGGER IF EXISTS `insurance_document_immutable_del`;
CREATE TRIGGER `insurance_document_immutable_del` BEFORE DELETE ON `insurance_documents` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_document_immutable_upd table=insurance_documents timing=BEFORE event=UPDATE pg_name=insurance_document_immutable
DROP TRIGGER IF EXISTS `insurance_document_immutable_upd`;
CREATE TRIGGER `insurance_document_immutable_upd` BEFORE UPDATE ON `insurance_documents` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_events_clearance table=insurance_events timing=AFTER event=INSERT pg_name=insurance_events_clearance
DROP TRIGGER IF EXISTS `insurance_events_clearance`;
CREATE TRIGGER `insurance_events_clearance` AFTER INSERT ON `insurance_events` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT x.admission_id INTO v_episode FROM insurance_cases x WHERE x.id = NEW.case_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  IF NEW.kind <> 'POLICY' THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'insurance_events', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=insurance_event_immutable_del table=insurance_events timing=BEFORE event=DELETE pg_name=insurance_event_immutable
DROP TRIGGER IF EXISTS `insurance_event_immutable_del`;
CREATE TRIGGER `insurance_event_immutable_del` BEFORE DELETE ON `insurance_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_event_immutable_upd table=insurance_events timing=BEFORE event=UPDATE pg_name=insurance_event_immutable
DROP TRIGGER IF EXISTS `insurance_event_immutable_upd`;
CREATE TRIGGER `insurance_event_immutable_upd` BEFORE UPDATE ON `insurance_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_transfer_resolutions_clearance table=insurance_transfer_resolutions timing=AFTER event=INSERT pg_name=insurance_transfer_resolutions_clearance
DROP TRIGGER IF EXISTS `insurance_transfer_resolutions_clearance`;
CREATE TRIGGER `insurance_transfer_resolutions_clearance` AFTER INSERT ON `insurance_transfer_resolutions` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT x.admission_id INTO v_episode FROM insurance_cases x WHERE x.id = NEW.case_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'insurance_transfer_resolutions', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=insurance_transfer_resolution_immutable_del table=insurance_transfer_resolutions timing=BEFORE event=DELETE pg_name=insurance_transfer_resolution_immutable
DROP TRIGGER IF EXISTS `insurance_transfer_resolution_immutable_del`;
CREATE TRIGGER `insurance_transfer_resolution_immutable_del` BEFORE DELETE ON `insurance_transfer_resolutions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=insurance_transfer_resolution_immutable_upd table=insurance_transfer_resolutions timing=BEFORE event=UPDATE pg_name=insurance_transfer_resolution_immutable
DROP TRIGGER IF EXISTS `insurance_transfer_resolution_immutable_upd`;
CREATE TRIGGER `insurance_transfer_resolution_immutable_upd` BEFORE UPDATE ON `insurance_transfer_resolutions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_dispositions_clearance table=lab_dispositions timing=AFTER event=INSERT pg_name=lab_dispositions_clearance
DROP TRIGGER IF EXISTS `lab_dispositions_clearance`;
CREATE TRIGGER `lab_dispositions_clearance` AFTER INSERT ON `lab_dispositions` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'lab_dispositions', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=lab_dispositions_immutable_del table=lab_dispositions timing=BEFORE event=DELETE pg_name=lab_dispositions_immutable
DROP TRIGGER IF EXISTS `lab_dispositions_immutable_del`;
CREATE TRIGGER `lab_dispositions_immutable_del` BEFORE DELETE ON `lab_dispositions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_dispositions_immutable_upd table=lab_dispositions timing=BEFORE event=UPDATE pg_name=lab_dispositions_immutable
DROP TRIGGER IF EXISTS `lab_dispositions_immutable_upd`;
CREATE TRIGGER `lab_dispositions_immutable_upd` BEFORE UPDATE ON `lab_dispositions` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_processing_immutable_del table=lab_processing timing=BEFORE event=DELETE pg_name=lab_processing_immutable
DROP TRIGGER IF EXISTS `lab_processing_immutable_del`;
CREATE TRIGGER `lab_processing_immutable_del` BEFORE DELETE ON `lab_processing` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_processing_immutable_upd table=lab_processing timing=BEFORE event=UPDATE pg_name=lab_processing_immutable
DROP TRIGGER IF EXISTS `lab_processing_immutable_upd`;
CREATE TRIGGER `lab_processing_immutable_upd` BEFORE UPDATE ON `lab_processing` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_report_addenda_clearance table=lab_report_addenda timing=AFTER event=INSERT pg_name=lab_report_addenda_clearance
DROP TRIGGER IF EXISTS `lab_report_addenda_clearance`;
CREATE TRIGGER `lab_report_addenda_clearance` AFTER INSERT ON `lab_report_addenda` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SELECT x.admission_id INTO v_episode FROM lab_reports x WHERE x.id = NEW.report_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'lab_report_addenda', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=lab_addenda_immutable_del table=lab_report_addenda timing=BEFORE event=DELETE pg_name=lab_addenda_immutable
DROP TRIGGER IF EXISTS `lab_addenda_immutable_del`;
CREATE TRIGGER `lab_addenda_immutable_del` BEFORE DELETE ON `lab_report_addenda` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_addenda_immutable_upd table=lab_report_addenda timing=BEFORE event=UPDATE pg_name=lab_addenda_immutable
DROP TRIGGER IF EXISTS `lab_addenda_immutable_upd`;
CREATE TRIGGER `lab_addenda_immutable_upd` BEFORE UPDATE ON `lab_report_addenda` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_reports_clearance table=lab_reports timing=AFTER event=INSERT pg_name=lab_reports_clearance
DROP TRIGGER IF EXISTS `lab_reports_clearance`;
CREATE TRIGGER `lab_reports_clearance` AFTER INSERT ON `lab_reports` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'lab_reports', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=lab_reports_immutable_del table=lab_reports timing=BEFORE event=DELETE pg_name=lab_reports_immutable
DROP TRIGGER IF EXISTS `lab_reports_immutable_del`;
CREATE TRIGGER `lab_reports_immutable_del` BEFORE DELETE ON `lab_reports` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_reports_immutable_upd table=lab_reports timing=BEFORE event=UPDATE pg_name=lab_reports_immutable
DROP TRIGGER IF EXISTS `lab_reports_immutable_upd`;
CREATE TRIGGER `lab_reports_immutable_upd` BEFORE UPDATE ON `lab_reports` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_samples_immutable_del table=lab_samples timing=BEFORE event=DELETE pg_name=lab_samples_immutable
DROP TRIGGER IF EXISTS `lab_samples_immutable_del`;
CREATE TRIGGER `lab_samples_immutable_del` BEFORE DELETE ON `lab_samples` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=lab_samples_immutable_upd table=lab_samples timing=BEFORE event=UPDATE pg_name=lab_samples_immutable
DROP TRIGGER IF EXISTS `lab_samples_immutable_upd`;
CREATE TRIGGER `lab_samples_immutable_upd` BEFORE UPDATE ON `lab_samples` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=medication_administrations_clearance table=medication_administrations timing=AFTER event=INSERT pg_name=medication_administrations_clearance
DROP TRIGGER IF EXISTS `medication_administrations_clearance`;
CREATE TRIGGER `medication_administrations_clearance` AFTER INSERT ON `medication_administrations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'PHARMACY';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'medication_administrations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=mvp_event_invalidation table=mvp_events timing=AFTER event=INSERT pg_name=mvp_event_invalidation
DROP TRIGGER IF EXISTS `mvp_event_invalidation`;
CREATE TRIGGER `mvp_event_invalidation` AFTER INSERT ON `mvp_events` FOR EACH ROW
BEGIN
  IF NEW.action IN ('doctor-approval','checklist','check','n-a') THEN
    INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
    SELECT m.id, NEW.action, CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.id <> NEW.id AND
     (m.action = 'finance' OR (NEW.action = 'doctor-approval' AND m.action IN ('checklist','check','n-a')) OR (NEW.action = 'checklist' AND m.action IN ('check','n-a')) OR (NEW.action IN ('check','n-a') AND m.action IN ('check','n-a') AND m.check_key = NEW.check_key));
  END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_events_immutable_del table=mvp_events timing=BEFORE event=DELETE pg_name=mvp_events_immutable
DROP TRIGGER IF EXISTS `mvp_events_immutable_del`;
CREATE TRIGGER `mvp_events_immutable_del` BEFORE DELETE ON `mvp_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_events_immutable_upd table=mvp_events timing=BEFORE event=UPDATE pg_name=mvp_events_immutable
DROP TRIGGER IF EXISTS `mvp_events_immutable_upd`;
CREATE TRIGGER `mvp_events_immutable_upd` BEFORE UPDATE ON `mvp_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_invalidation table=mvp_exception_events timing=AFTER event=INSERT pg_name=mvp_exception_invalidation
DROP TRIGGER IF EXISTS `mvp_exception_invalidation`;
CREATE TRIGGER `mvp_exception_invalidation` AFTER INSERT ON `mvp_exception_events` FOR EACH ROW
BEGIN
  IF NEW.action = 'CLINICAL' THEN
    INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
    SELECT m.id, 'external-disposition', CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.action IN ('doctor-approval','checklist','check','n-a','finance');
  END IF;
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_events_immutable_del table=mvp_exception_events timing=BEFORE event=DELETE pg_name=mvp_exception_events_immutable
DROP TRIGGER IF EXISTS `mvp_exception_events_immutable_del`;
CREATE TRIGGER `mvp_exception_events_immutable_del` BEFORE DELETE ON `mvp_exception_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_exception_events_immutable_upd table=mvp_exception_events timing=BEFORE event=UPDATE pg_name=mvp_exception_events_immutable
DROP TRIGGER IF EXISTS `mvp_exception_events_immutable_upd`;
CREATE TRIGGER `mvp_exception_events_immutable_upd` BEFORE UPDATE ON `mvp_exception_events` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_exceptional_departures_immutable_del table=mvp_exceptional_departures timing=BEFORE event=DELETE pg_name=mvp_exceptional_departures_immutable
DROP TRIGGER IF EXISTS `mvp_exceptional_departures_immutable_del`;
CREATE TRIGGER `mvp_exceptional_departures_immutable_del` BEFORE DELETE ON `mvp_exceptional_departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_exceptional_departures_immutable_upd table=mvp_exceptional_departures timing=BEFORE event=UPDATE pg_name=mvp_exceptional_departures_immutable
DROP TRIGGER IF EXISTS `mvp_exceptional_departures_immutable_upd`;
CREATE TRIGGER `mvp_exceptional_departures_immutable_upd` BEFORE UPDATE ON `mvp_exceptional_departures` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_external_immutable_del table=mvp_external_services timing=BEFORE event=DELETE pg_name=mvp_external_immutable
DROP TRIGGER IF EXISTS `mvp_external_immutable_del`;
CREATE TRIGGER `mvp_external_immutable_del` BEFORE DELETE ON `mvp_external_services` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_external_immutable_upd table=mvp_external_services timing=BEFORE event=UPDATE pg_name=mvp_external_immutable
DROP TRIGGER IF EXISTS `mvp_external_immutable_upd`;
CREATE TRIGGER `mvp_external_immutable_upd` BEFORE UPDATE ON `mvp_external_services` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_invalidations_immutable_del table=mvp_invalidations timing=BEFORE event=DELETE pg_name=mvp_invalidations_immutable
DROP TRIGGER IF EXISTS `mvp_invalidations_immutable_del`;
CREATE TRIGGER `mvp_invalidations_immutable_del` BEFORE DELETE ON `mvp_invalidations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_invalidations_immutable_upd table=mvp_invalidations timing=BEFORE event=UPDATE pg_name=mvp_invalidations_immutable
DROP TRIGGER IF EXISTS `mvp_invalidations_immutable_upd`;
CREATE TRIGGER `mvp_invalidations_immutable_upd` BEFORE UPDATE ON `mvp_invalidations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_medicine_sources_immutable_del table=mvp_medicine_sources timing=BEFORE event=DELETE pg_name=mvp_medicine_sources_immutable
DROP TRIGGER IF EXISTS `mvp_medicine_sources_immutable_del`;
CREATE TRIGGER `mvp_medicine_sources_immutable_del` BEFORE DELETE ON `mvp_medicine_sources` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_medicine_sources_immutable_upd table=mvp_medicine_sources timing=BEFORE event=UPDATE pg_name=mvp_medicine_sources_immutable
DROP TRIGGER IF EXISTS `mvp_medicine_sources_immutable_upd`;
CREATE TRIGGER `mvp_medicine_sources_immutable_upd` BEFORE UPDATE ON `mvp_medicine_sources` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_receivable_receipts_immutable_del table=mvp_receivable_receipts timing=BEFORE event=DELETE pg_name=mvp_receivable_receipts_immutable
DROP TRIGGER IF EXISTS `mvp_receivable_receipts_immutable_del`;
CREATE TRIGGER `mvp_receivable_receipts_immutable_del` BEFORE DELETE ON `mvp_receivable_receipts` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_receivable_receipts_immutable_upd table=mvp_receivable_receipts timing=BEFORE event=UPDATE pg_name=mvp_receivable_receipts_immutable
DROP TRIGGER IF EXISTS `mvp_receivable_receipts_immutable_upd`;
CREATE TRIGGER `mvp_receivable_receipts_immutable_upd` BEFORE UPDATE ON `mvp_receivable_receipts` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_return_invalidation table=mvp_room_returns timing=AFTER event=INSERT pg_name=mvp_return_invalidation
DROP TRIGGER IF EXISTS `mvp_return_invalidation`;
CREATE TRIGGER `mvp_return_invalidation` AFTER INSERT ON `mvp_room_returns` FOR EACH ROW
BEGIN
  INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT m.id, 'actual-return', CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.action IN ('doctor-approval','checklist','check','n-a','finance');
END
-- END TRIGGER

-- TRIGGER name=mvp_room_returns_immutable_del table=mvp_room_returns timing=BEFORE event=DELETE pg_name=mvp_room_returns_immutable
DROP TRIGGER IF EXISTS `mvp_room_returns_immutable_del`;
CREATE TRIGGER `mvp_room_returns_immutable_del` BEFORE DELETE ON `mvp_room_returns` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_room_returns_immutable_upd table=mvp_room_returns timing=BEFORE event=UPDATE pg_name=mvp_room_returns_immutable
DROP TRIGGER IF EXISTS `mvp_room_returns_immutable_upd`;
CREATE TRIGGER `mvp_room_returns_immutable_upd` BEFORE UPDATE ON `mvp_room_returns` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_instruction_invalidates table=mvp_transfer_authorities timing=AFTER event=INSERT pg_name=mvp_transfer_instruction_invalidates
DROP TRIGGER IF EXISTS `mvp_transfer_instruction_invalidates`;
CREATE TRIGGER `mvp_transfer_instruction_invalidates` AFTER INSERT ON `mvp_transfer_authorities` FOR EACH ROW
BEGIN
  INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT m.id, 'mvp_transfer_authorities', CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.action IN ('doctor-approval','checklist','check','n-a','finance');
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_authority_immutable_del table=mvp_transfer_authorities timing=BEFORE event=DELETE pg_name=mvp_transfer_authority_immutable
DROP TRIGGER IF EXISTS `mvp_transfer_authority_immutable_del`;
CREATE TRIGGER `mvp_transfer_authority_immutable_del` BEFORE DELETE ON `mvp_transfer_authorities` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_authority_immutable_upd table=mvp_transfer_authorities timing=BEFORE event=UPDATE pg_name=mvp_transfer_authority_immutable
DROP TRIGGER IF EXISTS `mvp_transfer_authority_immutable_upd`;
CREATE TRIGGER `mvp_transfer_authority_immutable_upd` BEFORE UPDATE ON `mvp_transfer_authorities` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_cancellation_invalidates table=mvp_transfer_cancellations timing=AFTER event=INSERT pg_name=mvp_transfer_cancellation_invalidates
DROP TRIGGER IF EXISTS `mvp_transfer_cancellation_invalidates`;
CREATE TRIGGER `mvp_transfer_cancellation_invalidates` AFTER INSERT ON `mvp_transfer_cancellations` FOR EACH ROW
BEGIN
  INSERT IGNORE INTO mvp_invalidations (event_id, kind, source_id)
  SELECT m.id, 'mvp_transfer_cancellations', CAST(NEW.id AS CHAR) FROM mvp_events m WHERE m.admission_id = NEW.admission_id AND m.action IN ('doctor-approval','checklist','check','n-a','finance');
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_cancellation_immutable_del table=mvp_transfer_cancellations timing=BEFORE event=DELETE pg_name=mvp_transfer_cancellation_immutable
DROP TRIGGER IF EXISTS `mvp_transfer_cancellation_immutable_del`;
CREATE TRIGGER `mvp_transfer_cancellation_immutable_del` BEFORE DELETE ON `mvp_transfer_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=mvp_transfer_cancellation_immutable_upd table=mvp_transfer_cancellations timing=BEFORE event=UPDATE pg_name=mvp_transfer_cancellation_immutable
DROP TRIGGER IF EXISTS `mvp_transfer_cancellation_immutable_upd`;
CREATE TRIGGER `mvp_transfer_cancellation_immutable_upd` BEFORE UPDATE ON `mvp_transfer_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=nursing_addenda_clearance table=nursing_addenda timing=AFTER event=INSERT pg_name=nursing_addenda_clearance
DROP TRIGGER IF EXISTS `nursing_addenda_clearance`;
CREATE TRIGGER `nursing_addenda_clearance` AFTER INSERT ON `nursing_addenda` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  IF NEW.record_type = 'MAR' THEN
    SET v_gate = 'PHARMACY';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'nursing_addenda', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=nursing_consumables_clearance table=nursing_consumables timing=AFTER event=INSERT pg_name=nursing_consumables_clearance
DROP TRIGGER IF EXISTS `nursing_consumables_clearance`;
CREATE TRIGGER `nursing_consumables_clearance` AFTER INSERT ON `nursing_consumables` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'nursing_consumables', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=nursing_observations_clearance table=nursing_observations timing=AFTER event=INSERT pg_name=nursing_observations_clearance
DROP TRIGGER IF EXISTS `nursing_observations_clearance`;
CREATE TRIGGER `nursing_observations_clearance` AFTER INSERT ON `nursing_observations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'nursing_observations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=nursing_shift_ends_clearance table=nursing_shift_ends timing=AFTER event=INSERT pg_name=nursing_shift_ends_clearance
DROP TRIGGER IF EXISTS `nursing_shift_ends_clearance`;
CREATE TRIGGER `nursing_shift_ends_clearance` AFTER INSERT ON `nursing_shift_ends` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SELECT x.admission_id INTO v_episode FROM nursing_shifts x WHERE x.id = NEW.shift_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'nursing_shift_ends', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=attendance_vacancy_guard__nursing_shift_ends table=nursing_shift_ends timing=BEFORE event=INSERT pg_name=attendance_vacancy_guard
DROP TRIGGER IF EXISTS `attendance_vacancy_guard__nursing_shift_ends`;
CREATE TRIGGER `attendance_vacancy_guard__nursing_shift_ends` BEFORE INSERT ON `nursing_shift_ends` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  SELECT n.admission_id INTO v_episode FROM nursing_shifts n WHERE n.id = NEW.shift_id;
  SELECT 1 INTO v_x FROM admissions WHERE id = v_episode FOR UPDATE;
  IF EXISTS(SELECT 1 FROM effective_vacation_facts f WHERE f.shift_id = NEW.shift_id AND f.vacated_at > NEW.ended_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift end cannot precede recorded physical bed vacancy';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=nursing_shifts_clearance table=nursing_shifts timing=AFTER event=INSERT pg_name=nursing_shifts_clearance
DROP TRIGGER IF EXISTS `nursing_shifts_clearance`;
CREATE TRIGGER `nursing_shifts_clearance` AFTER INSERT ON `nursing_shifts` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'nursing_shifts', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=patient_identification_clearance table=patient_identifications timing=AFTER event=INSERT pg_name=patient_identification_clearance
DROP TRIGGER IF EXISTS `patient_identification_clearance`;
CREATE TRIGGER `patient_identification_clearance` AFTER INSERT ON `patient_identifications` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'patient_identifications', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=patient_identification_immutable_del table=patient_identifications timing=BEFORE event=DELETE pg_name=patient_identification_immutable
DROP TRIGGER IF EXISTS `patient_identification_immutable_del`;
CREATE TRIGGER `patient_identification_immutable_del` BEFORE DELETE ON `patient_identifications` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=identification_document_source table=patient_identifications timing=BEFORE event=INSERT pg_name=identification_document_source
DROP TRIGGER IF EXISTS `identification_document_source`;
CREATE TRIGGER `identification_document_source` BEFORE INSERT ON `patient_identifications` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_locked VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  SELECT 1 INTO v_x FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SET v_key = CONCAT('document-identity:', NEW.patient_id);
  INSERT IGNORE INTO hims_locks (lock_key) VALUES (v_key);
  SELECT lock_key INTO v_locked FROM hims_locks WHERE lock_key = v_key FOR UPDATE;
END
-- END TRIGGER

-- TRIGGER name=patient_identification_immutable_upd table=patient_identifications timing=BEFORE event=UPDATE pg_name=patient_identification_immutable
DROP TRIGGER IF EXISTS `patient_identification_immutable_upd`;
CREATE TRIGGER `patient_identification_immutable_upd` BEFORE UPDATE ON `patient_identifications` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=pharmacy_movements_clearance table=pharmacy_movements timing=AFTER event=INSERT pg_name=pharmacy_movements_clearance
DROP TRIGGER IF EXISTS `pharmacy_movements_clearance`;
CREATE TRIGGER `pharmacy_movements_clearance` AFTER INSERT ON `pharmacy_movements` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'PHARMACY';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    SELECT c.admission_id, c.category INTO v_episode, v_category FROM charges c WHERE c.id = NEW.charge_id;
  END IF;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  IF v_category = 'medicine' THEN
    SET v_gate = 'PHARMACY';
  ELSEIF v_category = 'consumable' THEN
    SET v_gate = 'NURSING';
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'pharmacy_movements', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=pharmacy_movements_immutable_del table=pharmacy_movements timing=BEFORE event=DELETE pg_name=pharmacy_movements_immutable
DROP TRIGGER IF EXISTS `pharmacy_movements_immutable_del`;
CREATE TRIGGER `pharmacy_movements_immutable_del` BEFORE DELETE ON `pharmacy_movements` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=pharmacy_movement_source_guard table=pharmacy_movements timing=BEFORE event=INSERT pg_name=pharmacy_movement_source_guard
DROP TRIGGER IF EXISTS `pharmacy_movement_source_guard`;
CREATE TRIGGER `pharmacy_movement_source_guard` BEFORE INSERT ON `pharmacy_movements` FOR EACH ROW
BEGIN
  DECLARE v_b_id UUID DEFAULT NULL;
  DECLARE v_b_scale INT DEFAULT NULL;
  DECLARE v_b_medicine TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_b_unit TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_id UUID DEFAULT NULL;
  DECLARE v_o_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_batch UUID DEFAULT NULL;
  DECLARE v_o_adm UUID DEFAULT NULL;
  DECLARE v_o_order UUID DEFAULT NULL;
  DECLARE v_o_charge UUID DEFAULT NULL;
  DECLARE v_o_purpose TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_qty DECIMAL(40,18) DEFAULT NULL;
  SELECT b.id, b.quantity_scale, b.medicine_id, b.unit INTO v_b_id, v_b_scale, v_b_medicine, v_b_unit FROM pharmacy_batches b WHERE b.id = NEW.batch_id FOR UPDATE;
  IF v_b_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'query returned no rows';
  END IF;
  IF NEW.quantity <> ROUND(NEW.quantity, v_b_scale) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must use the exact configured stock scale';
  END IF;
  IF NEW.kind IN ('ISSUE','RETURN') AND NOT EXISTS (
    SELECT 1 FROM clinical_orders o JOIN charges c ON c.id = NEW.charge_id
    WHERE o.id = NEW.order_id AND o.admission_id = NEW.admission_id AND o.kind = 'MEDICINE'
      AND o.medicine_item_id = v_b_medicine AND c.admission_id = NEW.admission_id AND c.category = 'medicine'
      AND c.item_id = v_b_medicine AND c.unit = v_b_unit
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pharmacy movement must retain Doctor medicine and economic source identity';
  END IF;
  IF NEW.kind = 'ISSUE' AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.id = NEW.charge_id AND c.source_event_id = (CAST(NEW.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_nopad_bin) AND CAST(c.quantity AS DECIMAL(40,18)) = -NEW.quantity) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issue quantity must match its unique original medicine charge';
  END IF;
  IF NEW.kind = 'RETURN' THEN
    SELECT m.id, m.kind, m.batch_id, m.admission_id, m.order_id, m.charge_id, m.purpose, m.quantity INTO v_o_id, v_o_kind, v_o_batch, v_o_adm, v_o_order, v_o_charge, v_o_purpose, v_o_qty FROM pharmacy_movements m WHERE m.id = NEW.original_issue_id;
    IF v_o_id IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'query returned no rows';
    END IF;
    IF v_o_kind <> 'ISSUE' OR v_o_batch <> NEW.batch_id OR v_o_adm <> NEW.admission_id OR v_o_order <> NEW.order_id OR v_o_charge <> NEW.charge_id OR v_o_purpose <> NEW.purpose
       OR NEW.quantity + COALESCE((SELECT SUM(m.quantity) FROM pharmacy_movements m WHERE m.original_issue_id = v_o_id), 0) > -v_o_qty
       OR (NEW.reversal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM charge_reversals r WHERE r.id = NEW.reversal_id AND r.charge_id = NEW.charge_id)) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Return must retain original issue and cannot exceed its net quantity';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=pharmacy_movements_immutable_upd table=pharmacy_movements timing=BEFORE event=UPDATE pg_name=pharmacy_movements_immutable
DROP TRIGGER IF EXISTS `pharmacy_movements_immutable_upd`;
CREATE TRIGGER `pharmacy_movements_immutable_upd` BEFORE UPDATE ON `pharmacy_movements` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=pharmacy_preparations_clearance table=pharmacy_preparations timing=AFTER event=INSERT pg_name=pharmacy_preparations_clearance
DROP TRIGGER IF EXISTS `pharmacy_preparations_clearance`;
CREATE TRIGGER `pharmacy_preparations_clearance` AFTER INSERT ON `pharmacy_preparations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'PHARMACY';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'pharmacy_preparations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=pharmacy_preparations_immutable_del table=pharmacy_preparations timing=BEFORE event=DELETE pg_name=pharmacy_preparations_immutable
DROP TRIGGER IF EXISTS `pharmacy_preparations_immutable_del`;
CREATE TRIGGER `pharmacy_preparations_immutable_del` BEFORE DELETE ON `pharmacy_preparations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=pharmacy_preparations_immutable_upd table=pharmacy_preparations timing=BEFORE event=UPDATE pg_name=pharmacy_preparations_immutable
DROP TRIGGER IF EXISTS `pharmacy_preparations_immutable_upd`;
CREATE TRIGGER `pharmacy_preparations_immutable_upd` BEFORE UPDATE ON `pharmacy_preparations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=post_discharge_amendments_immutable_del table=post_discharge_amendments timing=BEFORE event=DELETE pg_name=post_discharge_amendments_immutable
DROP TRIGGER IF EXISTS `post_discharge_amendments_immutable_del`;
CREATE TRIGGER `post_discharge_amendments_immutable_del` BEFORE DELETE ON `post_discharge_amendments` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=post_discharge_amendment_source table=post_discharge_amendments timing=BEFORE event=INSERT pg_name=post_discharge_amendment_source
DROP TRIGGER IF EXISTS `post_discharge_amendment_source`;
CREATE TRIGGER `post_discharge_amendment_source` BEFORE INSERT ON `post_discharge_amendments` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_doctor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_rev INT DEFAULT NULL;
  DECLARE v_x_id UUID DEFAULT NULL;
  DECLARE v_x_adm UUID DEFAULT NULL;
  DECLARE v_x_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_disp TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_x_source UUID DEFAULT NULL;
  DECLARE v_x_snap LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_valid TINYINT DEFAULT 0;
  SELECT a.id, a.status, a.admitting_doctor_id, a.bill_revision INTO v_e_id, v_e_status, v_e_doctor, v_e_rev FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
  SELECT x.id, x.admission_id, x.type, x.disposition, x.correction_kind, x.source_id, x.snapshot INTO v_x_id, v_x_adm, v_x_type, v_x_disp, v_x_kind, v_x_source, v_x_snap FROM admin_exceptions x WHERE x.id = NEW.exception_id;
  SELECT u.role INTO v_role FROM staff_user u WHERE u.id = NEW.signed_by AND COALESCE(u.banned, 0) = 0;
  IF NOT (v_e_status <=> 'DISCHARGED')
     OR NOT (v_x_adm <=> v_e_id)
     OR NOT (v_x_type <=> 'POST_DISCHARGE_CORRECTION')
     OR NOT (v_x_disp <=> 'AMEND')
     OR NOT (v_x_kind <=> NEW.kind)
     OR NOT (v_x_source <=> NEW.source_id)
     OR v_role IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Closed amendment requires current staff and exact retained authority';
  END IF;
  CASE NEW.kind
    WHEN 'RECEIPT' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM receipts WHERE id = NEW.result_id AND admission_id = v_e_id AND actor_id = NEW.signed_by)
        AND (EXISTS(SELECT 1 FROM departures WHERE id = NEW.source_id AND admission_id = v_e_id)
          OR EXISTS(SELECT 1 FROM exceptional_departures WHERE id = NEW.source_id AND admission_id = v_e_id)));
    WHEN 'REFUND' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM receipt_refunds WHERE id = NEW.result_id AND receipt_id = NEW.source_id AND admission_id = v_e_id AND actor_id = NEW.signed_by));
    WHEN 'ALLOCATE' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM receipt_allocations a JOIN receipts r ON r.id = a.receipt_id WHERE a.id = NEW.result_id AND r.id = NEW.source_id AND r.admission_id = v_e_id AND a.actor_id = NEW.signed_by));
    WHEN 'CANCEL_ALLOCATION' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM allocation_cancellations c JOIN receipt_allocations a ON a.id = c.allocation_id JOIN receipts r ON r.id = a.receipt_id WHERE c.id = NEW.result_id AND a.id = NEW.source_id AND r.admission_id = v_e_id AND c.actor_id = NEW.signed_by));
    WHEN 'INSURANCE_DECISION' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING','INSURANCE')
        AND EXISTS(SELECT 1 FROM insurance_decisions d JOIN insurance_cases c ON c.id = d.case_id WHERE d.id = NEW.result_id AND c.id = NEW.source_id AND c.admission_id = v_e_id AND d.recorded_by = NEW.signed_by AND (v_role <> 'INSURANCE' OR c.assigned_staff_id = NEW.signed_by)));
    WHEN 'DISPOSITION_REVIEW' THEN
      SET v_valid = (v_role = 'DOCTOR' AND v_e_doctor = NEW.signed_by
        AND EXISTS(SELECT 1 FROM exception_evidence WHERE id = NEW.result_id AND admission_id = v_e_id AND source_id = NEW.source_id AND exception_id = v_x_id AND kind = 'PROFESSIONAL_REVIEW' AND signed_by = NEW.signed_by));
    WHEN 'CLINICAL_ADDENDUM' THEN
      SET v_valid = (v_role = 'DOCTOR' AND v_e_doctor = NEW.signed_by
        AND EXISTS(SELECT 1 FROM clinical_addenda a JOIN clinical_rounds r ON r.id = a.note_id WHERE a.id = NEW.result_id AND r.id = NEW.source_id AND r.admission_id = v_e_id AND a.signed_by = NEW.signed_by));
    WHEN 'NURSING_ADDENDUM' THEN
      SET v_valid = (v_role = 'NURSE'
        AND EXISTS(SELECT 1 FROM nurse_assignments a WHERE a.admission_id = v_e_id AND a.nurse_id = NEW.signed_by AND NOT EXISTS(SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = a.id))
        AND EXISTS(SELECT 1 FROM nursing_addenda WHERE id = NEW.result_id AND record_id = NEW.source_id AND admission_id = v_e_id AND signed_by = NEW.signed_by));
    WHEN 'LAB_ADDENDUM' THEN
      SET v_valid = (v_role = 'LAB'
        AND EXISTS(SELECT 1 FROM lab_report_addenda a JOIN lab_reports r ON r.id = a.report_id WHERE a.id = NEW.result_id AND r.id = NEW.source_id AND r.admission_id = v_e_id AND a.signed_by = NEW.signed_by));
    WHEN 'SELF_PAY_REVIEW' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM self_pay_reviews r WHERE r.id = NEW.result_id AND r.admission_id = v_e_id AND r.actor_id = NEW.signed_by)
        AND EXISTS(SELECT 1 FROM insurance_conversions c JOIN insurance_cases i ON i.id = c.case_id WHERE c.id = NEW.source_id AND i.admission_id = v_e_id));
    WHEN 'LAB_BILLING' THEN
      SET v_valid = (v_role = 'LAB'
        AND EXISTS(SELECT 1 FROM lab_reports r JOIN care_billing_events b ON b.order_id = r.order_id JOIN charges c ON c.source_event_id = (CAST(b.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_nopad_bin) WHERE r.id = NEW.result_id AND r.order_id = NEW.source_id AND r.admission_id = v_e_id AND b.state = 'POSTED' AND c.admission_id = v_e_id));
    WHEN 'REVERSE_CHARGE' THEN
      SET v_valid = (v_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM charge_reversals r JOIN charges c ON c.id = r.charge_id WHERE r.id = NEW.result_id AND c.id = NEW.source_id AND c.admission_id = v_e_id AND c.category <> 'room' AND c.source_event_id NOT LIKE 'room:%' AND r.actor_id = NEW.signed_by AND r.correction_exception_id = v_x_id));
    WHEN 'CARE_BILLING' THEN
      SET v_valid = (NEW.result_id = NEW.source_id AND EXISTS(SELECT 1 FROM care_billing_events b JOIN charges c ON c.source_event_id = (CAST(b.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_nopad_bin) WHERE b.id = NEW.source_id AND b.admission_id = v_e_id AND b.state = 'POSTED' AND c.admission_id = v_e_id AND c.correction_exception_id = v_x_id AND c.actor_id = NEW.signed_by AND ((b.category = 'consultation' AND v_role = 'DOCTOR' AND v_e_doctor = NEW.signed_by AND EXISTS(SELECT 1 FROM clinical_rounds r WHERE r.id = b.round_id AND r.admission_id = v_e_id)) OR (b.category = 'consumable' AND v_role = 'NURSE' AND EXISTS(SELECT 1 FROM nursing_consumables n WHERE n.id = b.id AND n.admission_id = v_e_id) AND EXISTS(SELECT 1 FROM nurse_assignments n WHERE n.admission_id = v_e_id AND n.nurse_id = NEW.signed_by AND NOT EXISTS(SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = n.id))))));
    WHEN 'LAB_REPORT' THEN
      SET v_valid = (v_role = 'LAB'
        AND EXISTS(SELECT 1 FROM lab_reports WHERE id = NEW.result_id AND order_id = NEW.source_id AND admission_id = v_e_id AND signed_by = NEW.signed_by));
    ELSE
      SET v_valid = 0;
  END CASE;
  IF NEW.kind IN ('REVERSE_CHARGE','CARE_BILLING') AND (NOT (CAST(JSON_VALUE(NEW.before_snapshot, '$.billVersion') AS SIGNED) <=> CAST(JSON_VALUE(v_x_snap, '$.billVersion') AS SIGNED)) OR NOT (CAST(JSON_VALUE(NEW.after_snapshot, '$.billVersion') AS SIGNED) <=> v_e_rev)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial amendment must bind its fresh authority and persisted bill result';
  END IF;
  IF NOT (v_valid <=> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Amendment result must be the proper role signed effect on its original source';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=post_discharge_amendments_immutable_upd table=post_discharge_amendments timing=BEFORE event=UPDATE pg_name=post_discharge_amendments_immutable
DROP TRIGGER IF EXISTS `post_discharge_amendments_immutable_upd`;
CREATE TRIGGER `post_discharge_amendments_immutable_upd` BEFORE UPDATE ON `post_discharge_amendments` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=receipt_allocations_clearance table=receipt_allocations timing=AFTER event=INSERT pg_name=receipt_allocations_clearance
DROP TRIGGER IF EXISTS `receipt_allocations_clearance`;
CREATE TRIGGER `receipt_allocations_clearance` AFTER INSERT ON `receipt_allocations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SELECT r.admission_id INTO v_episode FROM receipts r WHERE r.id = NEW.receipt_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'receipt_allocations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=receipt_allocations_immutable_del table=receipt_allocations timing=BEFORE event=DELETE pg_name=receipt_allocations_immutable
DROP TRIGGER IF EXISTS `receipt_allocations_immutable_del`;
CREATE TRIGGER `receipt_allocations_immutable_del` BEFORE DELETE ON `receipt_allocations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=receipt_allocations_immutable_upd table=receipt_allocations timing=BEFORE event=UPDATE pg_name=receipt_allocations_immutable
DROP TRIGGER IF EXISTS `receipt_allocations_immutable_upd`;
CREATE TRIGGER `receipt_allocations_immutable_upd` BEFORE UPDATE ON `receipt_allocations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=receipt_refunds_clearance table=receipt_refunds timing=AFTER event=INSERT pg_name=receipt_refunds_clearance
DROP TRIGGER IF EXISTS `receipt_refunds_clearance`;
CREATE TRIGGER `receipt_refunds_clearance` AFTER INSERT ON `receipt_refunds` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'receipt_refunds', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=receipt_refunds_immutable_del table=receipt_refunds timing=BEFORE event=DELETE pg_name=receipt_refunds_immutable
DROP TRIGGER IF EXISTS `receipt_refunds_immutable_del`;
CREATE TRIGGER `receipt_refunds_immutable_del` BEFORE DELETE ON `receipt_refunds` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=receipt_refunds_immutable_upd table=receipt_refunds timing=BEFORE event=UPDATE pg_name=receipt_refunds_immutable
DROP TRIGGER IF EXISTS `receipt_refunds_immutable_upd`;
CREATE TRIGGER `receipt_refunds_immutable_upd` BEFORE UPDATE ON `receipt_refunds` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=receipts_clearance table=receipts timing=AFTER event=INSERT pg_name=receipts_clearance
DROP TRIGGER IF EXISTS `receipts_clearance`;
CREATE TRIGGER `receipts_clearance` AFTER INSERT ON `receipts` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'receipts', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=receipts_immutable_del table=receipts timing=BEFORE event=DELETE pg_name=receipts_immutable
DROP TRIGGER IF EXISTS `receipts_immutable_del`;
CREATE TRIGGER `receipts_immutable_del` BEFORE DELETE ON `receipts` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=receipts_immutable_upd table=receipts timing=BEFORE event=UPDATE pg_name=receipts_immutable
DROP TRIGGER IF EXISTS `receipts_immutable_upd`;
CREATE TRIGGER `receipts_immutable_upd` BEFORE UPDATE ON `receipts` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=room_return_invalidation table=room_returns timing=AFTER event=INSERT pg_name=room_return_invalidation
DROP TRIGGER IF EXISTS `room_return_invalidation`;
CREATE TRIGGER `room_return_invalidation` AFTER INSERT ON `room_returns` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'room_returns', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=room_returns_immutable_del table=room_returns timing=BEFORE event=DELETE pg_name=room_returns_immutable
DROP TRIGGER IF EXISTS `room_returns_immutable_del`;
CREATE TRIGGER `room_returns_immutable_del` BEFORE DELETE ON `room_returns` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=room_return_source table=room_returns timing=BEFORE event=INSERT pg_name=room_return_source
DROP TRIGGER IF EXISTS `room_return_source`;
CREATE TRIGGER `room_return_source` BEFORE INSERT ON `room_returns` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_v_id UUID DEFAULT NULL;
  DECLARE v_v_adm UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  DECLARE v_d_id UUID DEFAULT NULL;
  DECLARE v_d_adm UUID DEFAULT NULL;
  DECLARE v_d_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_d_source UUID DEFAULT NULL;
  DECLARE v_d_signed DATETIME(6) DEFAULT NULL;
  DECLARE v_n_adm UUID DEFAULT NULL;
  DECLARE v_n_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_n_source UUID DEFAULT NULL;
  DECLARE v_n_by TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_n_actual DATETIME(6) DEFAULT NULL;
  DECLARE v_s_adm UUID DEFAULT NULL;
  DECLARE v_s_bed UUID DEFAULT NULL;
  DECLARE v_s_started DATETIME(6) DEFAULT NULL;
  DECLARE v_s_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_a_adm UUID DEFAULT NULL;
  DECLARE v_a_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_disp TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_ev LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  SELECT a.id, a.status INTO v_e_id, v_e_status FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
  SELECT v.id, v.admission_id, v.vacated_at INTO v_v_id, v_v_adm, v_v_vacated FROM effective_room_vacations v WHERE v.id = NEW.vacation_id;
  SELECT d.id, d.admission_id, d.kind, d.source_id, d.signed_at INTO v_d_id, v_d_adm, v_d_kind, v_d_source, v_d_signed FROM exception_evidence d WHERE d.id = NEW.doctor_evidence_id;
  SELECT n.admission_id, n.kind, n.source_id, n.signed_by, n.actual_at INTO v_n_adm, v_n_kind, v_n_source, v_n_by, v_n_actual FROM exception_evidence n WHERE n.id = NEW.nurse_evidence_id;
  SELECT s.admission_id, s.bed_id, s.started_at, s.ended_at INTO v_s_adm, v_s_bed, v_s_started, v_s_ended FROM effective_room_stays s WHERE s.id = NEW.stay_id;
  SELECT a.admission_id, a.type, a.disposition, a.evidence_ids INTO v_a_adm, v_a_type, v_a_disp, v_a_ev FROM admin_exceptions a WHERE a.id = NEW.exception_id;
  IF v_e_status <> 'ADMITTED' OR NOT (v_v_adm <=> v_e_id) OR NOT (v_d_adm <=> v_e_id) OR NOT (v_n_adm <=> v_e_id) OR NOT (v_s_adm <=> v_e_id) OR NOT (v_a_adm <=> v_e_id) OR v_a_type <> 'RETURN_TO_BED' OR v_a_disp <> 'RETURN_TO_BED' OR NOT JSON_CONTAINS(v_a_ev, JSON_QUOTE(CAST(v_d_id AS CHAR))) OR v_d_kind <> 'RETURN_TO_BED' OR v_n_kind <> 'RETURN_HANDOVER' OR NOT (v_d_source <=> v_v_id) OR NOT (v_n_source <=> v_v_id) OR NOT (v_n_by <=> NEW.signed_by) OR NOT (v_n_actual <=> NEW.returned_at) OR NOT (v_s_started <=> NEW.returned_at) OR v_s_ended IS NOT NULL OR v_d_signed < v_v_vacated OR v_n_actual < v_d_signed THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Return requires retained vacancy, fresh Doctor instruction and actual Nurse handover';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.signed_by AND u.role = 'NURSE' AND NOT u.banned) OR NOT EXISTS(SELECT 1 FROM bed_holds h WHERE h.admission_id = v_e_id AND h.bed_id = v_s_bed) OR EXISTS(SELECT 1 FROM effective_bed_turnovers t LEFT JOIN bed_turnover_completions c ON c.turnover_id = t.id WHERE t.bed_id = v_s_bed AND (c.id IS NULL OR c.completed_at > NEW.returned_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current Nurse, reserved bed and actual cleaning are required';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=room_returns_immutable_upd table=room_returns timing=BEFORE event=UPDATE pg_name=room_returns_immutable
DROP TRIGGER IF EXISTS `room_returns_immutable_upd`;
CREATE TRIGGER `room_returns_immutable_upd` BEFORE UPDATE ON `room_returns` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=room_source_clearance_ins table=room_stays timing=AFTER event=INSERT pg_name=room_source_clearance
DROP TRIGGER IF EXISTS `room_source_clearance_ins`;
CREATE TRIGGER `room_source_clearance_ins` AFTER INSERT ON `room_stays` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'room_stays', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=room_source_clearance_upd table=room_stays timing=AFTER event=UPDATE pg_name=room_source_clearance
DROP TRIGGER IF EXISTS `room_source_clearance_upd`;
CREATE TRIGGER `room_source_clearance_upd` AFTER UPDATE ON `room_stays` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  IF NOT (NEW.started_at <=> OLD.started_at AND NEW.ended_at <=> OLD.ended_at AND NEW.bed_id <=> OLD.bed_id AND NEW.tariff_version_id <=> OLD.tariff_version_id) THEN
    SET v_episode = NEW.admission_id;
    IF v_episode IS NULL THEN
      LEAVE trg;
    END IF;
    SET v_ignored = invalidate_clearances(v_episode, v_gate, 'room_stays', JSON_ARRAY(CAST(NEW.id AS CHAR)));
  END IF;
END
-- END TRIGGER

-- TRIGGER name=physical_bed_timeline_guard_ins table=room_stays timing=BEFORE event=INSERT pg_name=physical_bed_timeline_guard
DROP TRIGGER IF EXISTS `physical_bed_timeline_guard_ins`;
CREATE TRIGGER `physical_bed_timeline_guard_ins` BEFORE INSERT ON `room_stays` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_aid UUID DEFAULT NULL;
  DECLARE v_astart DATETIME(6) DEFAULT NULL;
  DECLARE v_aend DATETIME(6) DEFAULT NULL;
  DECLARE v_start DATETIME(6) DEFAULT NULL;
  DECLARE v_end DATETIME(6) DEFAULT NULL;
  SELECT 1 INTO v_x FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
  SELECT 1 INTO v_x FROM beds WHERE id = NEW.bed_id FOR UPDATE;
  SELECT m.id, m.started_at, m.ended_at INTO v_aid, v_astart, v_aend FROM stay_boundary_amendments m WHERE m.stay_id = NEW.id ORDER BY m.version DESC LIMIT 1;
  SET v_start = COALESCE(v_astart, NEW.started_at);
  SET v_end = IF(v_aid IS NULL, NEW.ended_at, v_aend);
  IF EXISTS(SELECT 1 FROM effective_room_stays s WHERE s.id <> NEW.id AND (s.bed_id = NEW.bed_id OR s.admission_id = NEW.admission_id) AND (s.started_at < COALESCE(v_end, '9999-12-31 23:59:59.999999') AND v_start < COALESCE(s.ended_at, '9999-12-31 23:59:59.999999') AND s.started_at < COALESCE(s.ended_at, '9999-12-31 23:59:59.999999') AND v_start < COALESCE(v_end, '9999-12-31 23:59:59.999999'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Effective physical room stays cannot overlap';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=immutable_room_boundary_preserved table=room_stays timing=BEFORE event=UPDATE pg_name=immutable_room_boundary_preserved
DROP TRIGGER IF EXISTS `immutable_room_boundary_preserved`;
CREATE TRIGGER `immutable_room_boundary_preserved` BEFORE UPDATE ON `room_stays` FOR EACH ROW
BEGIN
  IF OLD.ended_at IS NOT NULL AND NOT (NEW.ended_at <=> OLD.ended_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Closed room boundary is immutable; use attributable correction';
  END IF;
  IF NOT (NEW.admission_id <=> OLD.admission_id) OR NOT (NEW.bed_id <=> OLD.bed_id) OR NOT (NEW.started_at <=> OLD.started_at) OR NOT (NEW.tariff_version_id <=> OLD.tariff_version_id) OR NEW.posted_paise < OLD.posted_paise OR (OLD.last_reconciled_at IS NOT NULL AND (NEW.last_reconciled_at IS NULL OR NEW.last_reconciled_at < OLD.last_reconciled_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room source, tariff pin and committed cursor are immutable';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=physical_bed_timeline_guard_upd table=room_stays timing=BEFORE event=UPDATE pg_name=physical_bed_timeline_guard
DROP TRIGGER IF EXISTS `physical_bed_timeline_guard_upd`;
CREATE TRIGGER `physical_bed_timeline_guard_upd` BEFORE UPDATE ON `room_stays` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_aid UUID DEFAULT NULL;
  DECLARE v_astart DATETIME(6) DEFAULT NULL;
  DECLARE v_aend DATETIME(6) DEFAULT NULL;
  DECLARE v_start DATETIME(6) DEFAULT NULL;
  DECLARE v_end DATETIME(6) DEFAULT NULL;
  IF NOT (NEW.bed_id <=> OLD.bed_id AND NEW.started_at <=> OLD.started_at AND NEW.ended_at <=> OLD.ended_at) THEN
    SELECT 1 INTO v_x FROM admissions WHERE id = NEW.admission_id FOR UPDATE;
    SELECT 1 INTO v_x FROM beds WHERE id = NEW.bed_id FOR UPDATE;
    SELECT m.id, m.started_at, m.ended_at INTO v_aid, v_astart, v_aend FROM stay_boundary_amendments m WHERE m.stay_id = NEW.id ORDER BY m.version DESC LIMIT 1;
    SET v_start = COALESCE(v_astart, NEW.started_at);
    SET v_end = IF(v_aid IS NULL, NEW.ended_at, v_aend);
    IF EXISTS(SELECT 1 FROM effective_room_stays s WHERE s.id <> NEW.id AND (s.bed_id = NEW.bed_id OR s.admission_id = NEW.admission_id) AND (s.started_at < COALESCE(v_end, '9999-12-31 23:59:59.999999') AND v_start < COALESCE(s.ended_at, '9999-12-31 23:59:59.999999') AND s.started_at < COALESCE(s.ended_at, '9999-12-31 23:59:59.999999') AND v_start < COALESCE(v_end, '9999-12-31 23:59:59.999999'))) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Effective physical room stays cannot overlap';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=room_vacations_clearance table=room_vacations timing=AFTER event=INSERT pg_name=room_vacations_clearance
DROP TRIGGER IF EXISTS `room_vacations_clearance`;
CREATE TRIGGER `room_vacations_clearance` AFTER INSERT ON `room_vacations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'room_vacations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=room_vacations_immutable_del table=room_vacations timing=BEFORE event=DELETE pg_name=room_vacations_immutable
DROP TRIGGER IF EXISTS `room_vacations_immutable_del`;
CREATE TRIGGER `room_vacations_immutable_del` BEFORE DELETE ON `room_vacations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=attendance_vacancy_guard__room_vacations table=room_vacations timing=BEFORE event=INSERT pg_name=attendance_vacancy_guard
DROP TRIGGER IF EXISTS `attendance_vacancy_guard__room_vacations`;
CREATE TRIGGER `attendance_vacancy_guard__room_vacations` BEFORE INSERT ON `room_vacations` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  SELECT n.admission_id INTO v_episode FROM nursing_shifts n WHERE n.id = NEW.shift_id;
  SELECT 1 INTO v_x FROM admissions WHERE id = v_episode FOR UPDATE;
END
-- END TRIGGER

-- TRIGGER name=room_vacation_physical_guard table=room_vacations timing=BEFORE event=INSERT pg_name=room_vacation_physical_guard
DROP TRIGGER IF EXISTS `room_vacation_physical_guard`;
CREATE TRIGGER `room_vacation_physical_guard` BEFORE INSERT ON `room_vacations` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_rev INT DEFAULT NULL;
  DECLARE v_st_id UUID DEFAULT NULL;
  DECLARE v_st_adm UUID DEFAULT NULL;
  DECLARE v_st_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_st_recon DATETIME(6) DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_gate TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_s_adm UUID DEFAULT NULL;
  DECLARE v_s_signed DATETIME(6) DEFAULT NULL;
  DECLARE v_s_bill INT DEFAULT NULL;
  DECLARE v_n_id UUID DEFAULT NULL;
  DECLARE v_n_adm UUID DEFAULT NULL;
  DECLARE v_n_nurse TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_n_start DATETIME(6) DEFAULT NULL;
  DECLARE v_v_stay UUID DEFAULT NULL;
  DECLARE v_v_vacated DATETIME(6) DEFAULT NULL;
  IF NEW.mvp_readiness_id IS NULL AND NEW.mvp_exception_id IS NULL THEN
    SELECT a.id, a.status, a.bill_revision INTO v_e_id, v_e_status, v_e_rev FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
    SELECT st.id, st.admission_id, st.ended_at, st.last_reconciled_at INTO v_st_id, v_st_adm, v_st_ended, v_st_recon FROM effective_room_stays st WHERE st.id = NEW.stay_id;
    IF NOT (v_e_status <=> 'ADMITTED') OR NOT (v_st_adm <=> v_e_id) OR v_st_ended IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Physical transition requires active episode and closed attributable stay';
    END IF;
    SELECT s.id, s.gate, s.admission_id, s.signed_at INTO v_s_id, v_s_gate, v_s_adm, v_s_signed FROM clearance_seals s WHERE s.id = NEW.nursing_seal_id;
    SELECT n.id, n.admission_id, n.nurse_id, n.started_at INTO v_n_id, v_n_adm, v_n_nurse, v_n_start FROM nursing_shifts n WHERE n.id = NEW.shift_id;
    IF NOT (v_s_gate <=> 'NURSING') OR NOT (v_s_adm <=> v_e_id) OR EXISTS(SELECT 1 FROM clearance_invalidations i WHERE i.seal_id = v_s_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current same-episode Nursing seal required';
    END IF;
    IF NOT (v_n_adm <=> v_e_id) OR NOT (v_n_nurse <=> NEW.signed_by) OR NEW.vacated_at < v_n_start OR EXISTS(SELECT 1 FROM nursing_shift_ends x WHERE x.shift_id = v_n_id AND x.ended_at < NEW.vacated_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Physical vacancy requires actual same-nurse attendance';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM nurse_assignments a WHERE a.admission_id = v_e_id AND a.nurse_id = NEW.signed_by AND NOT EXISTS(SELECT 1 FROM nurse_assignment_revocations r WHERE r.assignment_id = a.id)) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current nursing assignment required';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.signed_by AND u.role = 'NURSE' AND NOT u.banned) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Actual Nurse role required';
    END IF;
    IF NOT (NEW.vacated_at <=> v_st_ended) OR NOT (NEW.vacated_at <=> v_st_recon) OR NEW.vacated_at < v_s_signed OR NEW.vacated_at > UTC_TIMESTAMP(6) OR NEW.signed_at < NEW.vacated_at THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vacancy must equal reconciled actual stay end after Nursing clearance';
    END IF;
  END IF;
END
-- END TRIGGER

-- TRIGGER name=room_vacations_immutable_upd table=room_vacations timing=BEFORE event=UPDATE pg_name=room_vacations_immutable
DROP TRIGGER IF EXISTS `room_vacations_immutable_upd`;
CREATE TRIGGER `room_vacations_immutable_upd` BEFORE UPDATE ON `room_vacations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=self_pay_reviews_clearance table=self_pay_reviews timing=AFTER event=INSERT pg_name=self_pay_reviews_clearance
DROP TRIGGER IF EXISTS `self_pay_reviews_clearance`;
CREATE TRIGGER `self_pay_reviews_clearance` AFTER INSERT ON `self_pay_reviews` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'self_pay_reviews', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=self_pay_reviews_immutable_del table=self_pay_reviews timing=BEFORE event=DELETE pg_name=self_pay_reviews_immutable
DROP TRIGGER IF EXISTS `self_pay_reviews_immutable_del`;
CREATE TRIGGER `self_pay_reviews_immutable_del` BEFORE DELETE ON `self_pay_reviews` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=self_pay_reviews_immutable_upd table=self_pay_reviews timing=BEFORE event=UPDATE pg_name=self_pay_reviews_immutable
DROP TRIGGER IF EXISTS `self_pay_reviews_immutable_upd`;
CREATE TRIGGER `self_pay_reviews_immutable_upd` BEFORE UPDATE ON `self_pay_reviews` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing history is immutable; append a linked correction';
END
-- END TRIGGER

-- TRIGGER name=amended_cutoff_clearance table=stay_boundary_amendments timing=AFTER event=INSERT pg_name=amended_cutoff_clearance
DROP TRIGGER IF EXISTS `amended_cutoff_clearance`;
CREATE TRIGGER `amended_cutoff_clearance` AFTER INSERT ON `stay_boundary_amendments` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'NURSING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'stay_boundary_amendments', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=stay_amendment_invalidation table=stay_boundary_amendments timing=AFTER event=INSERT pg_name=stay_amendment_invalidation
DROP TRIGGER IF EXISTS `stay_amendment_invalidation`;
CREATE TRIGGER `stay_amendment_invalidation` AFTER INSERT ON `stay_boundary_amendments` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'stay_boundary_amendments', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=stay_amendment_immutable_del table=stay_boundary_amendments timing=BEFORE event=DELETE pg_name=stay_amendment_immutable
DROP TRIGGER IF EXISTS `stay_amendment_immutable_del`;
CREATE TRIGGER `stay_amendment_immutable_del` BEFORE DELETE ON `stay_boundary_amendments` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=stay_amendment_guard table=stay_boundary_amendments timing=BEFORE event=INSERT pg_name=stay_amendment_guard
DROP TRIGGER IF EXISTS `stay_amendment_guard`;
CREATE TRIGGER `stay_amendment_guard` BEFORE INSERT ON `stay_boundary_amendments` FOR EACH ROW
BEGIN
  DECLARE v_x INT DEFAULT NULL;
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_admitted DATETIME(6) DEFAULT NULL;
  DECLARE v_s_id UUID DEFAULT NULL;
  DECLARE v_s_adm UUID DEFAULT NULL;
  DECLARE v_s_bed UUID DEFAULT NULL;
  DECLARE v_s_started DATETIME(6) DEFAULT NULL;
  DECLARE v_s_ended DATETIME(6) DEFAULT NULL;
  DECLARE v_a_id UUID DEFAULT NULL;
  DECLARE v_a_adm UUID DEFAULT NULL;
  DECLARE v_a_type TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_disp TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_a_ev LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
  DECLARE v_a_source UUID DEFAULT NULL;
  DECLARE v_p_id UUID DEFAULT NULL;
  DECLARE v_p_adm UUID DEFAULT NULL;
  DECLARE v_p_role TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_p_kind TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_p_source UUID DEFAULT NULL;
  DECLARE v_p_exc UUID DEFAULT NULL;
  DECLARE v_p_vacated DATETIME(6) DEFAULT NULL;
  DECLARE v_p_actual DATETIME(6) DEFAULT NULL;
  SELECT a.id, a.status, a.admitted_at INTO v_e_id, v_e_status, v_e_admitted FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
  SELECT s.id, s.admission_id, s.bed_id, s.started_at, s.ended_at INTO v_s_id, v_s_adm, v_s_bed, v_s_started, v_s_ended FROM room_stays s WHERE s.id = NEW.stay_id;
  SELECT 1 INTO v_x FROM beds WHERE id = v_s_bed FOR UPDATE;
  SELECT a.id, a.admission_id, a.type, a.disposition, a.evidence_ids, a.source_id INTO v_a_id, v_a_adm, v_a_type, v_a_disp, v_a_ev, v_a_source FROM admin_exceptions a WHERE a.id = NEW.exception_id;
  SELECT p.id, p.admission_id, p.role, p.kind, p.source_id, p.exception_id, p.vacated_at, p.actual_at INTO v_p_id, v_p_adm, v_p_role, v_p_kind, v_p_source, v_p_exc, v_p_vacated, v_p_actual FROM exception_evidence p WHERE p.id = NEW.evidence_id;
  IF NOT (v_s_adm <=> v_e_id) OR NOT (v_a_adm <=> v_e_id) OR NOT (v_p_adm <=> v_e_id) OR v_p_role <> 'NURSE' OR NEW.version <> COALESCE((SELECT MAX(m.version) FROM stay_boundary_amendments m WHERE m.stay_id = v_s_id), 0) + 1 OR NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.signed_by AND u.role = 'ADMIN' AND NOT u.banned) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attributable same-episode administrator and Nurse source required';
  END IF;
  IF NOT (NEW.started_at <=> v_s_started) OR NEW.ended_at IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Correction preserves original start and records a factual finite end';
  END IF;
  IF NOT ((v_a_type = 'DELAYED_TRANSFER' AND v_a_disp = 'TRANSFER' AND v_p_kind = 'TRANSFER_HANDOVER' AND JSON_CONTAINS(v_a_ev, JSON_QUOTE(CAST(v_p_id AS CHAR)))) OR (v_a_disp = 'EXCEPTIONAL_EXIT' AND v_p_kind = 'PHYSICAL_EXIT' AND JSON_CONTAINS(v_a_ev, JSON_QUOTE(CAST(v_p_id AS CHAR)))) OR (v_a_type = 'ROOM_CUTOFF_CORRECTION' AND v_a_disp = 'AMEND' AND v_a_source = v_s_id AND v_p_source = v_s_id AND v_p_kind = 'ROOM_CUTOFF' AND v_p_exc = v_a_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Physical amendment requires specific disposition and original professional evidence';
  END IF;
  IF v_a_type = 'ROOM_CUTOFF_CORRECTION' AND (v_s_ended IS NULL AND NOT EXISTS(SELECT 1 FROM stay_boundary_amendments m WHERE m.stay_id = v_s_id AND m.ended_at IS NOT NULL) OR EXISTS(SELECT 1 FROM admission_transfers t WHERE t.old_stay_id = v_s_id) OR EXISTS(SELECT 1 FROM room_returns r JOIN room_vacations v ON v.id = r.vacation_id WHERE v.stay_id = v_s_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Final cutoff cannot silently separate an adjacent transfer or return';
  END IF;
  IF EXISTS(SELECT 1 FROM departures d WHERE d.admission_id = v_e_id AND d.departed_at < NEW.ended_at) OR EXISTS(SELECT 1 FROM exceptional_departures d WHERE d.admission_id = v_e_id AND d.departed_at < NEW.ended_at) OR EXISTS(SELECT 1 FROM bed_turnovers t JOIN bed_turnover_completions c ON c.turnover_id = t.id WHERE t.stay_id = v_s_id AND c.completed_at < NEW.ended_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Correction conflicts with actual departure or cleaning';
  END IF;
  IF NEW.started_at < v_e_admitted OR NEW.started_at > UTC_TIMESTAMP(6) OR NEW.ended_at > UTC_TIMESTAMP(6) OR (NEW.ended_at IS NULL AND (v_s_ended IS NOT NULL OR v_e_status = 'DISCHARGED')) OR (NEW.ended_at IS NOT NULL AND NOT (NEW.ended_at <=> COALESCE(v_p_vacated, v_p_actual))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Amended physical time must retain actual professional source and cannot reopen a closed episode';
  END IF;
  IF EXISTS(SELECT 1 FROM effective_room_stays x WHERE x.id <> v_s_id AND (x.bed_id = v_s_bed OR x.admission_id = v_e_id) AND (x.started_at < COALESCE(NEW.ended_at, '9999-12-31 23:59:59.999999') AND NEW.started_at < COALESCE(x.ended_at, '9999-12-31 23:59:59.999999') AND x.started_at < COALESCE(x.ended_at, '9999-12-31 23:59:59.999999') AND NEW.started_at < COALESCE(NEW.ended_at, '9999-12-31 23:59:59.999999'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Amended physical occupancy conflicts with retained history';
  END IF;
  IF EXISTS(SELECT 1 FROM nursing_consumables c WHERE c.stay_id = v_s_id AND (c.used_at < NEW.started_at OR (NEW.ended_at IS NOT NULL AND c.used_at >= NEW.ended_at))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Amendment cannot silently reassign original source-unit consumables';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=stay_amendment_immutable_upd table=stay_boundary_amendments timing=BEFORE event=UPDATE pg_name=stay_amendment_immutable
DROP TRIGGER IF EXISTS `stay_amendment_immutable_upd`;
CREATE TRIGGER `stay_amendment_immutable_upd` BEFORE UPDATE ON `stay_boundary_amendments` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_insurance_tasks_clearance table=transfer_insurance_tasks timing=AFTER event=INSERT pg_name=transfer_insurance_tasks_clearance
DROP TRIGGER IF EXISTS `transfer_insurance_tasks_clearance`;
CREATE TRIGGER `transfer_insurance_tasks_clearance` AFTER INSERT ON `transfer_insurance_tasks` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'BILLING';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'transfer_insurance_tasks', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=transfer_insurance_tasks_immutable_del table=transfer_insurance_tasks timing=BEFORE event=DELETE pg_name=transfer_insurance_tasks_immutable
DROP TRIGGER IF EXISTS `transfer_insurance_tasks_immutable_del`;
CREATE TRIGGER `transfer_insurance_tasks_immutable_del` BEFORE DELETE ON `transfer_insurance_tasks` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_insurance_tasks_immutable_upd table=transfer_insurance_tasks timing=BEFORE event=UPDATE pg_name=transfer_insurance_tasks_immutable
DROP TRIGGER IF EXISTS `transfer_insurance_tasks_immutable_upd`;
CREATE TRIGGER `transfer_insurance_tasks_immutable_upd` BEFORE UPDATE ON `transfer_insurance_tasks` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_cancellation_clearance table=transfer_order_cancellations timing=AFTER event=INSERT pg_name=transfer_cancellation_clearance
DROP TRIGGER IF EXISTS `transfer_cancellation_clearance`;
CREATE TRIGGER `transfer_cancellation_clearance` AFTER INSERT ON `transfer_order_cancellations` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'transfer_order_cancellations', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=transfer_cancellation_immutable_del table=transfer_order_cancellations timing=BEFORE event=DELETE pg_name=transfer_cancellation_immutable
DROP TRIGGER IF EXISTS `transfer_cancellation_immutable_del`;
CREATE TRIGGER `transfer_cancellation_immutable_del` BEFORE DELETE ON `transfer_order_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_cancellation_source table=transfer_order_cancellations timing=BEFORE event=INSERT pg_name=transfer_cancellation_source
DROP TRIGGER IF EXISTS `transfer_cancellation_source`;
CREATE TRIGGER `transfer_cancellation_source` BEFORE INSERT ON `transfer_order_cancellations` FOR EACH ROW
BEGIN
  DECLARE v_e_id UUID DEFAULT NULL;
  DECLARE v_e_status TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_e_doctor TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_o_id UUID DEFAULT NULL;
  DECLARE v_o_adm UUID DEFAULT NULL;
  DECLARE v_o_source UUID DEFAULT NULL;
  DECLARE v_o_signed DATETIME(6) DEFAULT NULL;
  SELECT a.id, a.status, a.admitting_doctor_id INTO v_e_id, v_e_status, v_e_doctor FROM admissions a WHERE a.id = NEW.admission_id FOR UPDATE;
  SELECT o.id, o.admission_id, o.source_stay_id, o.signed_at INTO v_o_id, v_o_adm, v_o_source, v_o_signed FROM transfer_orders o WHERE o.id = NEW.transfer_order_id;
  IF NOT (v_e_status <=> 'ADMITTED') OR NOT (v_o_adm <=> v_e_id)
     OR NOT (v_o_id <=> (SELECT t.id FROM transfer_orders t WHERE t.admission_id = v_e_id ORDER BY t.version DESC LIMIT 1))
     OR NOT EXISTS(SELECT 1 FROM effective_room_stays s WHERE s.id = v_o_source AND s.admission_id = v_e_id AND s.ended_at IS NULL)
     OR EXISTS(SELECT 1 FROM admission_transfers t WHERE t.transfer_order_id = v_o_id)
     OR EXISTS(SELECT 1 FROM exception_evidence x WHERE x.admission_id = v_e_id AND x.kind = 'TRANSFER_HANDOVER' AND x.source_id = v_o_id)
     OR NOT EXISTS(SELECT 1 FROM staff_user u WHERE u.id = NEW.signed_by AND u.role = 'DOCTOR' AND NOT COALESCE(u.banned, 0))
     OR NOT (v_e_doctor <=> NEW.signed_by) OR CHAR_LENGTH(TRIM(NEW.reason)) < 1
     OR NEW.signed_at < v_o_signed OR NEW.signed_at > UTC_TIMESTAMP(6)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal requires current Doctor and truly unperformed current transfer authority';
  END IF;
END
-- END TRIGGER

-- TRIGGER name=transfer_cancellation_immutable_upd table=transfer_order_cancellations timing=BEFORE event=UPDATE pg_name=transfer_cancellation_immutable
DROP TRIGGER IF EXISTS `transfer_cancellation_immutable_upd`;
CREATE TRIGGER `transfer_cancellation_immutable_upd` BEFORE UPDATE ON `transfer_order_cancellations` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_orders_clearance table=transfer_orders timing=AFTER event=INSERT pg_name=transfer_orders_clearance
DROP TRIGGER IF EXISTS `transfer_orders_clearance`;
CREATE TRIGGER `transfer_orders_clearance` AFTER INSERT ON `transfer_orders` FOR EACH ROW
trg: BEGIN
  DECLARE v_ignored TINYINT DEFAULT NULL;
  DECLARE v_episode UUID DEFAULT NULL;
  DECLARE v_category TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT NULL;
  DECLARE v_gate VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT 'DOCTOR';
  SET v_episode = NEW.admission_id;
  IF v_episode IS NULL THEN
    LEAVE trg;
  END IF;
  SET v_ignored = invalidate_clearances(v_episode, v_gate, 'transfer_orders', JSON_ARRAY(CAST(NEW.id AS CHAR)));
END
-- END TRIGGER

-- TRIGGER name=transfer_orders_immutable_del table=transfer_orders timing=BEFORE event=DELETE pg_name=transfer_orders_immutable
DROP TRIGGER IF EXISTS `transfer_orders_immutable_del`;
CREATE TRIGGER `transfer_orders_immutable_del` BEFORE DELETE ON `transfer_orders` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER

-- TRIGGER name=transfer_orders_immutable_upd table=transfer_orders timing=BEFORE event=UPDATE pg_name=transfer_orders_immutable
DROP TRIGGER IF EXISTS `transfer_orders_immutable_upd`;
CREATE TRIGGER `transfer_orders_immutable_upd` BEFORE UPDATE ON `transfer_orders` FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer history is immutable; append attributable correction evidence';
END
-- END TRIGGER
