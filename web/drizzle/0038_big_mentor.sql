ALTER TABLE "hims"."exception_evidence" DROP CONSTRAINT "exception_evidence_role";--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD COLUMN "exception_id" uuid;--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD CONSTRAINT "exception_evidence_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_evidence_authority" ON "hims"."exception_evidence" USING btree ("exception_id");--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD CONSTRAINT "exception_evidence_role" CHECK (("hims"."exception_evidence"."kind" in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER','ROOM_CUTOFF') and "hims"."exception_evidence"."role"='NURSE' and "hims"."exception_evidence"."shift_id" is not null) or ("hims"."exception_evidence"."kind" not in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER','ROOM_CUTOFF') and "hims"."exception_evidence"."role"='DOCTOR'));
--> statement-breakpoint
CREATE VIEW hims.effective_vacation_facts AS SELECT v.id,v.admission_id,v.stay_id,v.nursing_seal_id,v.shift_id,s.ended_at vacated_at,v.waiting_location,v.handover,v.signed_by,v.signed_at FROM hims.room_vacations v JOIN hims.effective_room_stays s ON s.id=v.stay_id;
CREATE OR REPLACE VIEW hims.effective_room_vacations AS SELECT v.* FROM hims.effective_vacation_facts v WHERE NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.vacation_id=v.id);
CREATE VIEW hims.effective_bed_turnovers AS SELECT t.id,t.bed_id,t.stay_id,t.admission_id,s.ended_at vacated_at,t.reason,t.signed_by,t.signed_at FROM hims.bed_turnovers t JOIN hims.effective_room_stays s ON s.id=t.stay_id;
CREATE OR REPLACE FUNCTION hims.guard_exception_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; n hims.nursing_shifts;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 IF (e.status<>'ADMITTED' AND NOT(e.status='DISCHARGED' AND NEW.kind='ROOM_CUTOFF')) OR NEW.actual_at<e.admitted_at OR NEW.actual_at>clock_timestamp() OR NEW.signed_at<NEW.actual_at OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role=NEW.role AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current professional evidence with factual episode time required'; END IF;
 IF NEW.kind='ROOM_CUTOFF' AND NOT EXISTS(SELECT 1 FROM hims.admin_exceptions x WHERE x.id=NEW.exception_id AND x.admission_id=e.id AND x.type='ROOM_CUTOFF_CORRECTION' AND x.disposition='AMEND' AND x.source_id=NEW.source_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cutoff witness must bind retained original authority'; END IF;
 IF NEW.role='DOCTOR' AND e.admitting_doctor_id<>NEW.signed_by THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assigned Doctor evidence required'; END IF;
 IF NEW.role='NURSE' THEN
  SELECT * INTO n FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  IF n.admission_id IS DISTINCT FROM e.id OR n.nurse_id IS DISTINCT FROM NEW.signed_by OR NEW.actual_at<n.started_at OR EXISTS(SELECT 1 FROM hims.effective_shift_ends WHERE shift_id=n.id AND ended_at<NEW.actual_at) OR NOT EXISTS(SELECT 1 FROM hims.nurse_assignments a WHERE a.admission_id=e.id AND a.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current assigned Nurse and actual attendance required'; END IF;
 END IF;
 IF NEW.vacated_at IS NOT NULL AND (NEW.vacated_at<e.admitted_at OR NEW.vacated_at>NEW.actual_at) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Physical vacancy must precede hospital exit'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_stay_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s hims.room_stays; a hims.admin_exceptions; p hims.exception_evidence; e hims.admissions;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO s FROM hims.room_stays WHERE id=NEW.stay_id;
 UPDATE hims.beds SET active=active WHERE id=s.bed_id;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 SELECT * INTO p FROM hims.exception_evidence WHERE id=NEW.evidence_id;
 IF s.admission_id IS DISTINCT FROM e.id OR a.admission_id IS DISTINCT FROM e.id OR p.admission_id IS DISTINCT FROM e.id OR p.role<>'NURSE' OR NEW.version<>coalesce((SELECT max(version) FROM hims.stay_boundary_amendments WHERE stay_id=s.id),0)+1 OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Attributable same-episode administrator and Nurse source required'; END IF;
 IF NEW.started_at IS DISTINCT FROM s.started_at OR NEW.ended_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Correction preserves original start and records a factual finite end'; END IF;
 IF NOT ((a.type='DELAYED_TRANSFER' AND a.disposition='TRANSFER' AND p.kind='TRANSFER_HANDOVER' AND a.evidence_ids ? p.id::text) OR (a.disposition='EXCEPTIONAL_EXIT' AND p.kind='PHYSICAL_EXIT' AND a.evidence_ids ? p.id::text) OR (a.type='ROOM_CUTOFF_CORRECTION' AND a.disposition='AMEND' AND a.source_id=s.id AND p.source_id=s.id AND p.kind='ROOM_CUTOFF' AND p.exception_id=a.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Physical amendment requires specific disposition and original professional evidence'; END IF;
 IF a.type='ROOM_CUTOFF_CORRECTION' AND (s.ended_at IS NULL AND NOT EXISTS(SELECT 1 FROM hims.stay_boundary_amendments WHERE stay_id=s.id AND ended_at IS NOT NULL) OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE old_stay_id=s.id) OR EXISTS(SELECT 1 FROM hims.room_returns r JOIN hims.room_vacations v ON v.id=r.vacation_id WHERE v.stay_id=s.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Final cutoff cannot silently separate an adjacent transfer or return'; END IF;
 IF EXISTS(SELECT 1 FROM hims.departures WHERE admission_id=e.id AND departed_at<NEW.ended_at) OR EXISTS(SELECT 1 FROM hims.exceptional_departures WHERE admission_id=e.id AND departed_at<NEW.ended_at) OR EXISTS(SELECT 1 FROM hims.bed_turnovers t JOIN hims.bed_turnover_completions c ON c.turnover_id=t.id WHERE t.stay_id=s.id AND c.completed_at<NEW.ended_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Correction conflicts with actual departure or cleaning'; END IF;
 IF NEW.started_at<e.admitted_at OR NEW.started_at>clock_timestamp() OR NEW.ended_at>clock_timestamp() OR (NEW.ended_at IS NULL AND (s.ended_at IS NOT NULL OR e.status='DISCHARGED')) OR (NEW.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM coalesce(p.vacated_at,p.actual_at)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Amended physical time must retain actual professional source and cannot reopen a closed episode'; END IF;
 IF EXISTS(SELECT 1 FROM hims.effective_room_stays x WHERE x.id<>s.id AND (x.bed_id=s.bed_id OR x.admission_id=e.id) AND tstzrange(x.started_at,x.ended_at,'[)')&&tstzrange(NEW.started_at,NEW.ended_at,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Amended physical occupancy conflicts with retained history'; END IF;
 IF EXISTS(SELECT 1 FROM hims.nursing_consumables WHERE stay_id=s.id AND (used_at<NEW.started_at OR (NEW.ended_at IS NOT NULL AND used_at>=NEW.ended_at))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Amendment cannot silently reassign original source-unit consumables'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_bed_turnover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t hims.effective_bed_turnovers; s hims.effective_room_stays;
BEGIN
 IF TG_TABLE_NAME='bed_holds' THEN
  PERFORM 1 FROM hims.beds WHERE id=NEW.bed_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM hims.effective_bed_turnovers b LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=b.id WHERE b.bed_id=NEW.bed_id AND (c.id IS NULL OR c.completed_at>NEW.held_at)) THEN RAISE EXCEPTION 'Actual housekeeping completion required before bed reuse'; END IF;
 ELSIF TG_TABLE_NAME='bed_turnovers' THEN
  SELECT * INTO s FROM hims.effective_room_stays WHERE id=NEW.stay_id;
  IF s.bed_id IS DISTINCT FROM NEW.bed_id OR s.admission_id IS DISTINCT FROM NEW.admission_id OR s.ended_at IS DISTINCT FROM NEW.vacated_at THEN RAISE EXCEPTION 'Turnover must reference the actual closed physical stay'; END IF;
 ELSE
  SELECT * INTO t FROM hims.effective_bed_turnovers WHERE id=NEW.turnover_id;
  PERFORM 1 FROM hims.beds WHERE id=t.bed_id FOR UPDATE;
  IF NEW.completed_at<t.vacated_at OR NEW.completed_at>clock_timestamp() THEN RAISE EXCEPTION 'Cleaning completion must follow actual bed vacancy'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_vacancy_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
  SELECT admission_id INTO episode FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=episode;
  IF TG_TABLE_NAME='nursing_shift_ends' THEN
    IF EXISTS (
      SELECT 1 FROM hims.effective_vacation_facts WHERE shift_id=NEW.shift_id AND vacated_at>NEW.ended_at
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shift end cannot precede recorded physical bed vacancy'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_effective_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb=to_jsonb(NEW); n hims.nursing_shifts; e hims.admissions; x hims.admin_exceptions; moment timestamptz; ending boolean;
BEGIN
 SELECT * INTO n FROM hims.nursing_shifts WHERE id=(r->>'shift_id')::uuid;
 IF n.id IS NULL THEN RETURN NEW; END IF;
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=n.admission_id RETURNING * INTO e;
 ending=TG_TABLE_NAME IN ('nursing_shift_ends','administrative_shift_ends');
 IF ending THEN
  moment=NEW.ended_at;
  IF EXISTS(SELECT 1 FROM hims.effective_shift_ends WHERE shift_id=n.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attendance already has a retained factual end'; END IF;
  IF TG_TABLE_NAME='administrative_shift_ends' THEN
   SELECT * INTO x FROM hims.admin_exceptions WHERE id=NEW.exception_id;
   IF x.admission_id IS DISTINCT FROM e.id OR x.type<>'UNAVAILABLE_APPROVER' OR x.disposition<>'CLOSE_ATTENDANCE' OR x.source_id IS DISTINCT FROM n.id OR NEW.admission_id IS DISTINCT FROM e.id OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original shift and actual Admin exception authority required'; END IF;
  ELSE
   IF NEW.signed_by IS DISTINCT FROM n.nurse_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only original Nurse signs professional attendance'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM (
   SELECT actual_at t FROM hims.medication_administrations WHERE shift_id=n.id
   UNION ALL SELECT observed_at FROM hims.nursing_observations WHERE shift_id=n.id
   UNION ALL SELECT used_at FROM hims.nursing_consumables WHERE shift_id=n.id
   UNION ALL SELECT transferred_at FROM hims.admission_transfers WHERE shift_id=n.id
   UNION ALL SELECT vacated_at FROM hims.effective_vacation_facts WHERE shift_id=n.id
   UNION ALL SELECT actual_at FROM hims.exception_evidence WHERE shift_id=n.id
  ) facts WHERE t>moment) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attendance cannot end before actual care or physical handover'; END IF;
  IF moment<=n.started_at OR EXISTS(SELECT 1 FROM hims.departures WHERE admission_id=e.id AND departed_at<moment) OR EXISTS(SELECT 1 FROM hims.exceptional_departures WHERE admission_id=e.id AND departed_at<moment) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attendance end outside actual episode'; END IF;
 ELSE
  moment=coalesce((r->>'actual_at')::timestamptz,(r->>'observed_at')::timestamptz,(r->>'used_at')::timestamptz,(r->>'transferred_at')::timestamptz,(r->>'vacated_at')::timestamptz);
  IF n.admission_id IS DISTINCT FROM (r->>'admission_id')::uuid OR n.nurse_id IS DISTINCT FROM r->>'signed_by' OR moment<n.started_at OR EXISTS(SELECT 1 FROM hims.effective_shift_ends WHERE shift_id=n.id AND ended_at<moment) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual care must fit original Nurse attendance'; END IF;
 END IF;
 IF moment>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual attendance evidence cannot be in future'; END IF;
 RETURN NEW;
END $$;
