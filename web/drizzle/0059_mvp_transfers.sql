-- Separate external clinical authority from the Nurse who records and performs the move.
CREATE TABLE hims.mvp_transfer_authorities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES hims.admissions(id),
 source_stay_id uuid NOT NULL REFERENCES hims.room_stays(id), external_doctor_id uuid NOT NULL REFERENCES hims.doctor_directory(id),
 authorizer_name text NOT NULL CHECK(length(btrim(authorizer_name)) BETWEEN 2 AND 150),
 source_time timestamptz NOT NULL, destination_category text NOT NULL CHECK(destination_category ~ '^[A-Z0-9_-]{2,32}$'),
 evidence text NOT NULL CHECK(length(btrim(evidence))>=3), reason text NOT NULL CHECK(length(btrim(reason))>=3),
 version integer NOT NULL CHECK(version>0), admission_version integer NOT NULL CHECK(admission_version>0),
 recorded_by text NOT NULL REFERENCES hims.staff_user(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(admission_id,version), CHECK(source_time<=recorded_at)
);
CREATE INDEX mvp_transfer_authority_stay ON hims.mvp_transfer_authorities(source_stay_id);
CREATE INDEX mvp_transfer_authority_doctor ON hims.mvp_transfer_authorities(external_doctor_id);
CREATE INDEX mvp_transfer_authority_recorder ON hims.mvp_transfer_authorities(recorded_by);
CREATE TABLE hims.mvp_transfer_cancellations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES hims.admissions(id),
 authority_id uuid NOT NULL UNIQUE REFERENCES hims.mvp_transfer_authorities(id), external_doctor_id uuid NOT NULL REFERENCES hims.doctor_directory(id),
 authorizer_name text NOT NULL CHECK(length(btrim(authorizer_name)) BETWEEN 2 AND 150), source_time timestamptz NOT NULL,
 evidence text NOT NULL CHECK(length(btrim(evidence))>=3), reason text NOT NULL CHECK(length(btrim(reason))>=3),
 recorded_by text NOT NULL REFERENCES hims.staff_user(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(source_time<=recorded_at)
);
CREATE INDEX mvp_transfer_cancellation_episode ON hims.mvp_transfer_cancellations(admission_id);
CREATE INDEX mvp_transfer_cancellation_doctor ON hims.mvp_transfer_cancellations(external_doctor_id);
CREATE INDEX mvp_transfer_cancellation_recorder ON hims.mvp_transfer_cancellations(recorded_by);
CREATE TRIGGER mvp_transfer_authority_immutable BEFORE UPDATE OR DELETE ON hims.mvp_transfer_authorities FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER mvp_transfer_cancellation_immutable BEFORE UPDATE OR DELETE ON hims.mvp_transfer_cancellations FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
ALTER TABLE hims.admission_transfers ALTER COLUMN transfer_order_id DROP NOT NULL;
ALTER TABLE hims.admission_transfers ADD COLUMN mvp_authority_id uuid UNIQUE REFERENCES hims.mvp_transfer_authorities(id);
ALTER TABLE hims.admission_transfers ADD CONSTRAINT transfer_authority_exactly_one CHECK((transfer_order_id IS NOT NULL)<>(mvp_authority_id IS NOT NULL));

CREATE FUNCTION hims.guard_mvp_transfer_instruction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; a hims.mvp_transfer_authorities; s hims.effective_room_stays; latest integer; doctor hims.doctor_directory_versions; category jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 PERFORM 1 FROM hims.staff_user WHERE id=NEW.recorded_by FOR SHARE;
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version IS DISTINCT FROM 2 OR e.status IS DISTINCT FROM 'ADMITTED' OR NOT hims.mvp_assigned(e.id,NEW.recorded_by)
  OR NEW.recorded_at>clock_timestamp() OR NEW.source_time>NEW.recorded_at OR NEW.source_time<e.admitted_at
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned active Nurse must record external authority for the active MVP episode'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('doctor-directory:'||NEW.external_doctor_id::text,0));
 SELECT * INTO doctor FROM hims.doctor_directory_versions WHERE doctor_id=NEW.external_doctor_id ORDER BY version DESC LIMIT 1;
 IF doctor.id IS NULL OR NOT doctor.active OR doctor.name IS DISTINCT FROM NEW.authorizer_name THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Named current external Doctor directory source required'; END IF;
 SELECT * INTO s FROM hims.effective_room_stays WHERE admission_id=e.id AND ended_at IS NULL;
 IF s.id IS NULL OR s.bed_id IS DISTINCT FROM e.bed_id OR NEW.source_time<s.started_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer instruction must bind the current occupied physical stay'; END IF;
 SELECT * INTO a FROM hims.mvp_transfer_authorities WHERE admission_id=e.id ORDER BY version DESC LIMIT 1;
 IF TG_TABLE_NAME='mvp_transfer_authorities' THEN
  latest=coalesce(a.version,0);
  SELECT payload INTO category FROM hims.setting_versions WHERE hospital_id=e.hospital_id AND payload->>'type'='bed-category' AND payload->>'code'=NEW.destination_category ORDER BY version DESC LIMIT 1;
  IF NEW.source_stay_id IS DISTINCT FROM s.id OR NEW.version<>latest+1 OR NEW.admission_version<>e.version
   OR coalesce(category->>'active','false')<>'true' OR (a.id IS NOT NULL AND NEW.source_time<a.source_time)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current admission version, source stay, configured category and latest external instruction required'; END IF;
 ELSE
  IF a.id IS NULL OR a.id IS DISTINCT FROM NEW.authority_id OR a.source_stay_id IS DISTINCT FROM s.id OR NEW.source_time<a.source_time
   OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE mvp_authority_id=a.id)
   OR EXISTS(SELECT 1 FROM hims.mvp_transfer_cancellations WHERE authority_id=a.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only the current truly unperformed transfer may be withdrawn by recorded external instruction'; END IF;
 END IF;
 UPDATE hims.admissions SET version=version+1 WHERE id=e.id;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_transfer_authority_source BEFORE INSERT ON hims.mvp_transfer_authorities FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_transfer_instruction();
CREATE TRIGGER mvp_transfer_cancellation_source BEFORE INSERT ON hims.mvp_transfer_cancellations FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_transfer_instruction();

-- Keep the literal legacy algorithms, restricted to their original native authority.
DROP TRIGGER exact_transfer_boundary ON hims.admission_transfers;
CREATE TRIGGER exact_transfer_boundary BEFORE INSERT ON hims.admission_transfers FOR EACH ROW WHEN(NEW.transfer_order_id IS NOT NULL) EXECUTE FUNCTION hims.validate_transfer_boundary();
DROP TRIGGER transfer_current_authority ON hims.admission_transfers;
CREATE TRIGGER transfer_current_authority BEFORE INSERT ON hims.admission_transfers FOR EACH ROW WHEN(NEW.transfer_order_id IS NOT NULL) EXECUTE FUNCTION hims.guard_transfer_withdrawal();

CREATE FUNCTION hims.guard_mvp_transfer_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; a hims.mvp_transfer_authorities; previous hims.effective_room_stays; following hims.effective_room_stays; shift hims.nursing_shifts; ended timestamptz; policy jsonb; elapsed numeric; unit_ms numeric; rate numeric; due numeric; net numeric;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 PERFORM 1 FROM hims.staff_user WHERE id=NEW.signed_by FOR SHARE;
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version=1 THEN
  IF NEW.transfer_order_id IS NULL OR NEW.mvp_authority_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy transfer retains its original Doctor order'; END IF;
  RETURN NEW;
 END IF;
 IF e.workflow_version IS DISTINCT FROM 2 OR e.status IS DISTINCT FROM 'ADMITTED' OR NEW.transfer_order_id IS NOT NULL OR NEW.mvp_authority_id IS NULL OR NOT hims.mvp_assigned(e.id,NEW.signed_by)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MVP transfer requires current assigned Nurse and separate external authority'; END IF;
 SELECT * INTO a FROM hims.mvp_transfer_authorities WHERE id=NEW.mvp_authority_id;
 SELECT * INTO previous FROM hims.effective_room_stays WHERE id=NEW.old_stay_id;
 SELECT * INTO following FROM hims.effective_room_stays WHERE id=NEW.new_stay_id;
 SELECT * INTO shift FROM hims.nursing_shifts WHERE id=NEW.shift_id;
 SELECT ended_at INTO ended FROM hims.effective_shift_ends WHERE shift_id=NEW.shift_id;
 PERFORM 1 FROM hims.beds WHERE id IN (NEW.old_bed_id,NEW.target_bed_id) ORDER BY id FOR UPDATE;
 IF a.id IS NULL OR a.admission_id IS DISTINCT FROM e.id OR a.source_stay_id IS DISTINCT FROM previous.id
  OR a.id IS DISTINCT FROM (SELECT id FROM hims.mvp_transfer_authorities WHERE admission_id=e.id ORDER BY version DESC LIMIT 1)
  OR EXISTS(SELECT 1 FROM hims.mvp_transfer_cancellations WHERE authority_id=a.id)
  OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE mvp_authority_id=a.id)
  OR previous.id IS NULL OR following.id IS NULL OR previous.admission_id IS DISTINCT FROM e.id OR following.admission_id IS DISTINCT FROM e.id
  OR previous.bed_id IS DISTINCT FROM NEW.old_bed_id OR following.bed_id IS DISTINCT FROM NEW.target_bed_id OR NEW.old_bed_id=NEW.target_bed_id
  OR previous.ended_at IS DISTINCT FROM NEW.transferred_at OR following.started_at IS DISTINCT FROM NEW.transferred_at OR following.ended_at IS NOT NULL
  OR previous.started_at>=NEW.transferred_at OR previous.last_reconciled_at IS DISTINCT FROM NEW.transferred_at
  OR NEW.transferred_at<a.source_time OR NEW.transferred_at>clock_timestamp() OR NEW.signed_at<NEW.transferred_at OR NEW.signed_at>clock_timestamp()
  OR shift.id IS NULL OR shift.admission_id IS DISTINCT FROM e.id OR shift.nurse_id IS DISTINCT FROM NEW.signed_by OR NEW.transferred_at<shift.started_at OR (ended IS NOT NULL AND NEW.transferred_at>ended)
  OR e.bed_id IS DISTINCT FROM NEW.target_bed_id OR length(btrim(NEW.handover))<3
  OR NOT EXISTS(SELECT 1 FROM hims.beds WHERE id=NEW.old_bed_id AND active)
  OR NOT EXISTS(SELECT 1 FROM hims.beds WHERE id=NEW.target_bed_id AND active AND category=a.destination_category)
  OR following.tariff_version_id IS DISTINCT FROM (SELECT id FROM hims.setting_versions WHERE hospital_id=e.hospital_id AND payload->>'type'='tariff' AND payload->>'category'=a.destination_category ORDER BY version DESC LIMIT 1)
  OR coalesce((SELECT payload->>'active' FROM hims.setting_versions WHERE hospital_id=e.hospital_id AND payload->>'type'='bed-category' AND payload->>'code'=a.destination_category ORDER BY version DESC LIMIT 1),'false')<>'true'
  OR NOT EXISTS(SELECT 1 FROM hims.bed_holds WHERE bed_id=NEW.target_bed_id AND admission_id=e.id AND held_at=NEW.transferred_at)
  OR EXISTS(SELECT 1 FROM hims.effective_bed_turnovers t LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=t.id WHERE t.bed_id=NEW.target_bed_id AND (c.id IS NULL OR c.completed_at>NEW.transferred_at))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer needs exact adjacent stays, current uncancelled source, actual Nurse shift and authorized target hold'; END IF;
 IF EXISTS(SELECT 1 FROM (
   SELECT signed_at at FROM hims.clinical_rounds WHERE admission_id=e.id
   UNION ALL SELECT signed_at FROM hims.clinical_orders WHERE admission_id=e.id
   UNION ALL SELECT signed_at FROM hims.clinical_summaries WHERE admission_id=e.id
   UNION ALL SELECT ev.signed_at FROM hims.clinical_task_events ev JOIN hims.clinical_orders o ON o.id=ev.order_id WHERE o.admission_id=e.id
   UNION ALL SELECT ad.signed_at FROM hims.clinical_addenda ad JOIN hims.clinical_rounds r ON r.id=ad.note_id WHERE r.admission_id=e.id
   UNION ALL SELECT actual_at FROM hims.medication_administrations WHERE admission_id=e.id
   UNION ALL SELECT observed_at FROM hims.nursing_observations WHERE admission_id=e.id
   UNION ALL SELECT started_at FROM hims.nursing_shifts WHERE admission_id=e.id
   UNION ALL SELECT x.ended_at FROM hims.effective_shift_ends x JOIN hims.nursing_shifts n ON n.id=x.shift_id WHERE n.admission_id=e.id
  ) history WHERE at>NEW.transferred_at)
  OR EXISTS(SELECT 1 FROM hims.nursing_consumables WHERE stay_id=previous.id AND used_at>=NEW.transferred_at)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer cannot predate recorded actual care or source-stay use'; END IF;
 -- Reuse the original pinned tariff's integer-paise cumulative formula at this exact cutoff.
 SELECT payload INTO policy FROM hims.setting_versions WHERE id=previous.tariff_version_id;
 elapsed=greatest(0,floor(extract(epoch FROM NEW.transferred_at)*1000)-floor(extract(epoch FROM previous.started_at)*1000)-coalesce((policy->>'graceMinutes')::numeric,0)*60000);
 unit_ms=CASE WHEN policy->>'basis'='hour' THEN 3600000 ELSE 86400000 END; rate=(policy->>'amount')::numeric;
 due=CASE WHEN policy->>'rounding'='started-unit' THEN floor((elapsed+unit_ms-1)/unit_ms)*rate ELSE floor((elapsed*rate+unit_ms/2)/unit_ms) END;
 SELECT coalesce(sum(ch.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0)),0) INTO net FROM hims.charges ch WHERE ch.admission_id=e.id AND ch.source_event_id LIKE 'room:'||previous.id::text||':%';
 IF net IS DISTINCT FROM due THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original room-use charges must reconcile through the exact transfer cutoff'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_transfer_movement_source BEFORE INSERT ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_transfer_movement();

CREATE FUNCTION hims.guard_mvp_transfer_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.mvp_authority_id IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM hims.bed_turnovers WHERE admission_id=NEW.admission_id AND stay_id=NEW.old_stay_id AND bed_id=NEW.old_bed_id AND vacated_at=NEW.transferred_at)
  OR (EXISTS(SELECT 1 FROM hims.admissions WHERE id=NEW.admission_id AND payment_route='INSURED') AND NOT EXISTS(SELECT 1 FROM hims.transfer_insurance_tasks WHERE admission_id=NEW.admission_id AND transfer_id=NEW.id))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual transfer must retain source-bed turnover and required external insurance follow-up'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mvp_transfer_effects AFTER INSERT ON hims.admission_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_transfer_effects();

CREATE FUNCTION hims.invalidate_mvp_transfer_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='admission_transfers' THEN
  IF NEW.mvp_authority_id IS NULL THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO hims.mvp_invalidations(event_id,kind,source_id)
 SELECT id,TG_TABLE_NAME,NEW.id::text FROM hims.mvp_events WHERE admission_id=NEW.admission_id AND action IN ('doctor-approval','checklist','check','n-a','finance') ON CONFLICT(event_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_transfer_instruction_invalidates AFTER INSERT ON hims.mvp_transfer_authorities FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_transfer_readiness();
CREATE TRIGGER mvp_transfer_cancellation_invalidates AFTER INSERT ON hims.mvp_transfer_cancellations FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_transfer_readiness();
CREATE TRIGGER mvp_transfer_movement_invalidates AFTER INSERT ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_transfer_readiness();
CREATE FUNCTION hims.guard_mvp_pending_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='doctor-approval' AND EXISTS(
  SELECT 1 FROM hims.mvp_transfer_authorities a WHERE a.admission_id=NEW.admission_id
   AND a.id=(SELECT id FROM hims.mvp_transfer_authorities WHERE admission_id=NEW.admission_id ORDER BY version DESC LIMIT 1)
   AND NOT EXISTS(SELECT 1 FROM hims.mvp_transfer_cancellations c WHERE c.authority_id=a.id)
   AND NOT EXISTS(SELECT 1 FROM hims.admission_transfers t WHERE t.mvp_authority_id=a.id)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Resolve the current external transfer instruction before recording discharge approval'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_pending_transfer_approval BEFORE INSERT ON hims.mvp_events FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_pending_transfer();
