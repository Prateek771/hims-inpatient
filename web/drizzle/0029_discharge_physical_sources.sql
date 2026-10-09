ALTER TABLE "hims"."room_vacations" ADD CONSTRAINT "room_vacations_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_vacation_shift" ON "hims"."room_vacations" USING btree ("shift_id");
--> statement-breakpoint
-- Source coherence supplements application authorization without taking an inverse staff lock.
CREATE FUNCTION hims.guard_physical_discharge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; s hims.clearance_seals; st hims.room_stays; n hims.nursing_shifts; v hims.room_vacations;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 SELECT * INTO st FROM hims.room_stays WHERE id=NEW.stay_id;
 IF e.status IS DISTINCT FROM 'ADMITTED' OR st.admission_id IS DISTINCT FROM e.id OR st.ended_at IS NULL THEN RAISE EXCEPTION 'Physical transition requires active episode and closed attributable stay'; END IF;
 IF TG_TABLE_NAME='room_vacations' THEN
  SELECT * INTO s FROM hims.clearance_seals WHERE id=NEW.nursing_seal_id;
  SELECT * INTO n FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  IF s.gate IS DISTINCT FROM 'NURSING' OR s.admission_id IS DISTINCT FROM e.id OR EXISTS(SELECT 1 FROM hims.clearance_invalidations WHERE seal_id=s.id) THEN RAISE EXCEPTION 'Current same-episode Nursing seal required'; END IF;
  IF n.admission_id IS DISTINCT FROM e.id OR n.nurse_id IS DISTINCT FROM NEW.signed_by OR NEW.vacated_at<n.started_at OR EXISTS(SELECT 1 FROM hims.nursing_shift_ends WHERE shift_id=n.id AND ended_at<NEW.vacated_at) THEN RAISE EXCEPTION 'Physical vacancy requires actual same-nurse attendance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.nurse_assignments a WHERE a.admission_id=e.id AND a.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id)) THEN RAISE EXCEPTION 'Current nursing assignment required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='NURSE' AND NOT banned) THEN RAISE EXCEPTION 'Actual Nurse role required'; END IF;
  IF NEW.vacated_at IS DISTINCT FROM st.ended_at OR NEW.vacated_at IS DISTINCT FROM st.last_reconciled_at OR NEW.vacated_at<s.signed_at OR NEW.vacated_at>clock_timestamp() OR NEW.signed_at<NEW.vacated_at THEN RAISE EXCEPTION 'Vacancy must equal reconciled actual stay end after Nursing clearance'; END IF;
 ELSE
  SELECT * INTO s FROM hims.clearance_seals WHERE id=NEW.bill_seal_id;
  SELECT * INTO v FROM hims.room_vacations WHERE admission_id=e.id;
  IF s.gate IS DISTINCT FROM 'BILLING' OR s.admission_id IS DISTINCT FROM e.id OR s.bill_version IS DISTINCT FROM NEW.bill_version OR e.bill_revision IS DISTINCT FROM NEW.bill_version OR EXISTS(SELECT 1 FROM hims.clearance_invalidations WHERE seal_id=s.id) THEN RAISE EXCEPTION 'Current same-episode Billing seal and bill required'; END IF;
  IF v.stay_id IS DISTINCT FROM st.id OR NEW.departed_at<v.vacated_at OR NEW.departed_at<s.signed_at OR NEW.departed_at>clock_timestamp() OR NEW.signed_at<NEW.departed_at THEN RAISE EXCEPTION 'Actual hospital departure must follow room vacancy and human clearance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role IN ('BILLING','ADMIN') AND NOT banned) THEN RAISE EXCEPTION 'Billing or Admin departure authority required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER room_vacation_physical_guard BEFORE INSERT ON hims.room_vacations FOR EACH ROW EXECUTE FUNCTION hims.guard_physical_discharge();
CREATE TRIGGER departure_physical_guard BEFORE INSERT ON hims.departures FOR EACH ROW EXECUTE FUNCTION hims.guard_physical_discharge();
