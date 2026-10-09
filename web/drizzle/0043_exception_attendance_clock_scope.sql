-- Ordinary care retains the existing server actualTime contract and native shift/source bounds.
-- Exception witnesses and unavailable-Nurse Admin facts additionally enforce the real database clock.
-- No attendance/source/departure bound is relaxed; future ordinary commands remain server-rejected.
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
 IF TG_TABLE_NAME IN ('exception_evidence','administrative_shift_ends') AND moment>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual attendance evidence cannot be in future'; END IF;
 RETURN NEW;
END $$;
