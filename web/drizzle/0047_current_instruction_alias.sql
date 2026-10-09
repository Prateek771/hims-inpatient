-- Repair ambiguous local variable/table aliases; 0046 applied bytes remain immutable.
CREATE OR REPLACE FUNCTION hims.guard_current_exception_instruction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; d hims.exception_evidence; v hims.effective_room_vacations; r jsonb=to_jsonb(NEW);
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 IF TG_TABLE_NAME='exception_evidence' THEN
  IF NEW.kind NOT IN ('RETURN_TO_BED','RETURN_CANCELLED','RETURN_HANDOVER') THEN RETURN NEW; END IF;
  IF NEW.kind='RETURN_CANCELLED' THEN
   SELECT * INTO d FROM hims.exception_evidence WHERE id=NEW.source_id;
   SELECT * INTO v FROM hims.effective_room_vacations WHERE id=d.source_id;
   IF d.admission_id IS DISTINCT FROM e.id OR d.kind IS DISTINCT FROM 'RETURN_TO_BED' OR NEW.actual_at<d.signed_at OR EXISTS(SELECT 1 FROM hims.room_returns WHERE doctor_evidence_id=d.id) OR EXISTS(SELECT 1 FROM hims.exception_evidence WHERE kind='RETURN_CANCELLED' AND source_id=d.id) OR EXISTS(SELECT 1 FROM hims.exception_evidence WHERE admission_id=e.id AND kind='RETURN_HANDOVER' AND source_id=d.source_id AND actual_at>=d.signed_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Doctor reconsideration requires an unconsumed unwitnessed current return instruction; record actual return first'; END IF;
  ELSE
   SELECT * INTO v FROM hims.effective_room_vacations WHERE id=NEW.source_id;
   SELECT * INTO d FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.kind='RETURN_TO_BED' AND p.source_id=v.id AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.doctor_evidence_id=p.id) ORDER BY signed_at DESC LIMIT 1;
   IF NEW.kind='RETURN_TO_BED' AND d.id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review existing return instruction before another'; END IF;
   IF NEW.kind='RETURN_HANDOVER' AND (d.id IS NULL OR NEW.actual_at<d.signed_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual return handover requires current Doctor instruction'; END IF;
  END IF;
  IF e.status<>'ADMITTED' OR v.admission_id IS DISTINCT FROM e.id OR NEW.actual_at<v.vacated_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Return evidence requires current same-episode factual vacancy'; END IF;
 ELSIF TG_TABLE_NAME='admin_exceptions' AND r->>'type'='RETURN_TO_BED' THEN
  IF NOT EXISTS(SELECT 1 FROM hims.exception_evidence src JOIN hims.effective_room_vacations cur ON cur.id=src.source_id WHERE src.admission_id=e.id AND src.kind='RETURN_TO_BED' AND src.signed_at>=cur.vacated_at AND NEW.evidence_ids ? src.id::text AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=src.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Return authority requires current unsuperseded Doctor instruction'; END IF;
 ELSIF TG_TABLE_NAME='room_returns' THEN
  IF EXISTS(SELECT 1 FROM hims.exception_evidence WHERE kind='RETURN_CANCELLED' AND source_id=NEW.doctor_evidence_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseded Doctor instruction cannot authorize return'; END IF;
 ELSIF TG_TABLE_NAME='clearance_seals' AND r->>'gate'='DOCTOR' THEN
  IF EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.kind='RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.doctor_evidence_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current return instruction requires actual return or explicit Doctor reconsideration'; END IF;
 END IF;
 RETURN NEW;
END $$;
