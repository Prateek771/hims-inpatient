-- Corrected physical facts carry the witness who attested that cutoff, with raw history separate.
CREATE OR REPLACE VIEW hims.effective_vacation_facts AS
SELECT v.id,v.admission_id,v.stay_id,v.nursing_seal_id,
 CASE WHEN s.ended_at IS DISTINCT FROM v.vacated_at THEN p.shift_id ELSE v.shift_id END shift_id,
 s.ended_at vacated_at,
 CASE WHEN s.ended_at IS DISTINCT FROM v.vacated_at THEN 'See corrected Nurse findings' ELSE v.waiting_location END waiting_location,
 CASE WHEN s.ended_at IS DISTINCT FROM v.vacated_at THEN p.notes ELSE v.handover END handover,
 CASE WHEN s.ended_at IS DISTINCT FROM v.vacated_at THEN p.signed_by ELSE v.signed_by END signed_by,
 CASE WHEN s.ended_at IS DISTINCT FROM v.vacated_at THEN p.signed_at ELSE v.signed_at END signed_at,
 a.id amendment_id,p.id evidence_id,v.vacated_at original_vacated_at,v.shift_id original_shift_id,
 v.handover original_handover,v.signed_by original_signed_by,v.signed_at original_signed_at,
 v.waiting_location original_waiting_location
FROM hims.room_vacations v JOIN hims.effective_room_stays s ON s.id=v.stay_id
LEFT JOIN LATERAL (SELECT * FROM hims.stay_boundary_amendments WHERE stay_id=v.stay_id ORDER BY version DESC LIMIT 1) a ON true
LEFT JOIN hims.exception_evidence p ON p.id=a.evidence_id;
CREATE OR REPLACE VIEW hims.effective_room_vacations AS SELECT v.* FROM hims.effective_vacation_facts v WHERE NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.vacation_id=v.id);
CREATE OR REPLACE VIEW hims.effective_bed_turnovers AS
SELECT t.id,t.bed_id,t.stay_id,t.admission_id,s.ended_at vacated_at,t.reason,t.signed_by,t.signed_at,
 a.id amendment_id,p.id evidence_id,t.vacated_at original_vacated_at,
 p.shift_id cutoff_shift_id,p.signed_by cutoff_signed_by,p.signed_at cutoff_signed_at,p.notes cutoff_findings
FROM hims.bed_turnovers t JOIN hims.effective_room_stays s ON s.id=t.stay_id
LEFT JOIN LATERAL (SELECT * FROM hims.stay_boundary_amendments WHERE stay_id=t.stay_id ORDER BY version DESC LIMIT 1) a ON true
LEFT JOIN hims.exception_evidence p ON p.id=a.evidence_id;

CREATE FUNCTION hims.guard_current_exception_instruction() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT EXISTS(SELECT 1 FROM hims.exception_evidence d JOIN hims.effective_room_vacations v ON v.id=d.source_id WHERE d.admission_id=e.id AND d.kind='RETURN_TO_BED' AND d.signed_at>=v.vacated_at AND NEW.evidence_ids ? d.id::text AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=d.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Return authority requires current unsuperseded Doctor instruction'; END IF;
 ELSIF TG_TABLE_NAME='room_returns' THEN
  IF EXISTS(SELECT 1 FROM hims.exception_evidence WHERE kind='RETURN_CANCELLED' AND source_id=NEW.doctor_evidence_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseded Doctor instruction cannot authorize return'; END IF;
 ELSIF TG_TABLE_NAME='clearance_seals' AND r->>'gate'='DOCTOR' THEN
  IF EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.kind='RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.doctor_evidence_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current return instruction requires actual return or explicit Doctor reconsideration'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exception_instruction_current BEFORE INSERT ON hims.exception_evidence FOR EACH ROW EXECUTE FUNCTION hims.guard_current_exception_instruction();
CREATE TRIGGER exception_authority_instruction BEFORE INSERT ON hims.admin_exceptions FOR EACH ROW EXECUTE FUNCTION hims.guard_current_exception_instruction();
CREATE TRIGGER room_return_instruction BEFORE INSERT ON hims.room_returns FOR EACH ROW EXECUTE FUNCTION hims.guard_current_exception_instruction();
CREATE TRIGGER clearance_instruction_current BEFORE INSERT ON hims.clearance_seals FOR EACH ROW EXECUTE FUNCTION hims.guard_current_exception_instruction();
CREATE TRIGGER exception_doctor_clearance AFTER INSERT ON hims.exception_evidence FOR EACH ROW WHEN (NEW.role='DOCTOR') EXECUTE FUNCTION hims.invalidate_clearance_source('DOCTOR');
CREATE TRIGGER exception_nurse_clearance AFTER INSERT ON hims.exception_evidence FOR EACH ROW WHEN (NEW.role='NURSE') EXECUTE FUNCTION hims.invalidate_clearance_source('NURSING');
CREATE TRIGGER amended_cutoff_clearance AFTER INSERT ON hims.stay_boundary_amendments FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('NURSING');

-- Revalidate cutoff (distinct from hospital-exit time) with its true witness under admission ownership.
CREATE FUNCTION hims.guard_amended_cutoff_witness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p hims.exception_evidence; n hims.nursing_shifts;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id;
 SELECT * INTO p FROM hims.exception_evidence WHERE id=NEW.evidence_id;
 SELECT * INTO n FROM hims.nursing_shifts WHERE id=p.shift_id;
 IF EXISTS(SELECT 1 FROM hims.room_vacations WHERE stay_id=NEW.stay_id AND vacated_at=NEW.ended_at) THEN RETURN NEW; END IF;
 IF n.admission_id IS DISTINCT FROM NEW.admission_id OR n.nurse_id IS DISTINCT FROM p.signed_by OR NEW.ended_at<n.started_at OR NEW.ended_at>p.signed_at OR EXISTS(SELECT 1 FROM hims.effective_shift_ends WHERE shift_id=n.id AND ended_at<NEW.ended_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Changed bed cutoff must fit its actual Nurse witness attendance and signature'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER amended_cutoff_witness BEFORE INSERT ON hims.stay_boundary_amendments FOR EACH ROW EXECUTE FUNCTION hims.guard_amended_cutoff_witness();

CREATE OR REPLACE FUNCTION hims.guard_room_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; v hims.effective_room_vacations; d hims.exception_evidence; n hims.exception_evidence; s hims.effective_room_stays; a hims.admin_exceptions;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO v FROM hims.effective_room_vacations WHERE id=NEW.vacation_id;
 SELECT * INTO d FROM hims.exception_evidence WHERE id=NEW.doctor_evidence_id;
 SELECT * INTO n FROM hims.exception_evidence WHERE id=NEW.nurse_evidence_id;
 SELECT * INTO s FROM hims.effective_room_stays WHERE id=NEW.stay_id;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 IF e.status<>'ADMITTED' OR v.admission_id IS DISTINCT FROM e.id OR d.admission_id IS DISTINCT FROM e.id OR n.admission_id IS DISTINCT FROM e.id OR s.admission_id IS DISTINCT FROM e.id OR a.admission_id IS DISTINCT FROM e.id OR a.type<>'RETURN_TO_BED' OR a.disposition<>'RETURN_TO_BED' OR NOT(a.evidence_ids ? d.id::text) OR d.kind<>'RETURN_TO_BED' OR n.kind<>'RETURN_HANDOVER' OR d.source_id IS DISTINCT FROM v.id OR n.source_id IS DISTINCT FROM v.id OR n.signed_by IS DISTINCT FROM NEW.signed_by OR n.actual_at IS DISTINCT FROM NEW.returned_at OR s.started_at IS DISTINCT FROM NEW.returned_at OR s.ended_at IS NOT NULL OR d.signed_at<v.vacated_at OR n.actual_at<d.signed_at THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Return requires retained vacancy, fresh Doctor instruction and actual Nurse handover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='NURSE' AND NOT banned) OR NOT EXISTS(SELECT 1 FROM hims.bed_holds WHERE admission_id=e.id AND bed_id=s.bed_id) OR EXISTS(SELECT 1 FROM hims.effective_bed_turnovers t LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=t.id WHERE t.bed_id=s.bed_id AND (c.id IS NULL OR c.completed_at>NEW.returned_at)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current Nurse, reserved bed and actual cleaning are required'; END IF;
 RETURN NEW;
END $$;
