CREATE TABLE "hims"."room_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"vacation_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"doctor_evidence_id" uuid NOT NULL,
	"nurse_evidence_id" uuid NOT NULL,
	"returned_at" timestamp with time zone NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "room_returns_vacation_id_unique" UNIQUE("vacation_id"),
	CONSTRAINT "room_returns_stay_id_unique" UNIQUE("stay_id")
);
--> statement-breakpoint
DROP INDEX "hims"."room_vacation_episode_once";--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_vacation_id_room_vacations_id_fk" FOREIGN KEY ("vacation_id") REFERENCES "hims"."room_vacations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_doctor_evidence_id_exception_evidence_id_fk" FOREIGN KEY ("doctor_evidence_id") REFERENCES "hims"."exception_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_nurse_evidence_id_exception_evidence_id_fk" FOREIGN KEY ("nurse_evidence_id") REFERENCES "hims"."exception_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_returns" ADD CONSTRAINT "room_returns_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_return_episode" ON "hims"."room_returns" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "room_return_authority" ON "hims"."room_returns" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "room_return_doctor" ON "hims"."room_returns" USING btree ("doctor_evidence_id");--> statement-breakpoint
CREATE INDEX "room_return_nurse" ON "hims"."room_returns" USING btree ("nurse_evidence_id");
--> statement-breakpoint
CREATE VIEW hims.effective_room_vacations AS SELECT v.* FROM hims.room_vacations v WHERE NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.vacation_id=v.id);
CREATE TRIGGER room_returns_immutable BEFORE UPDATE OR DELETE ON hims.room_returns FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE FUNCTION hims.guard_room_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; v hims.room_vacations; d hims.exception_evidence; n hims.exception_evidence; s hims.effective_room_stays; a hims.admin_exceptions;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO v FROM hims.effective_room_vacations WHERE id=NEW.vacation_id;
 SELECT * INTO d FROM hims.exception_evidence WHERE id=NEW.doctor_evidence_id;
 SELECT * INTO n FROM hims.exception_evidence WHERE id=NEW.nurse_evidence_id;
 SELECT * INTO s FROM hims.effective_room_stays WHERE id=NEW.stay_id;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 IF e.status<>'ADMITTED' OR v.admission_id IS DISTINCT FROM e.id OR d.admission_id IS DISTINCT FROM e.id OR n.admission_id IS DISTINCT FROM e.id OR s.admission_id IS DISTINCT FROM e.id OR a.admission_id IS DISTINCT FROM e.id OR a.type<>'RETURN_TO_BED' OR a.disposition<>'RETURN_TO_BED' OR d.kind<>'RETURN_TO_BED' OR n.kind<>'RETURN_HANDOVER' OR d.source_id IS DISTINCT FROM v.id OR n.source_id IS DISTINCT FROM v.id OR n.signed_by IS DISTINCT FROM NEW.signed_by OR n.actual_at IS DISTINCT FROM NEW.returned_at OR s.started_at IS DISTINCT FROM NEW.returned_at OR s.ended_at IS NOT NULL OR d.signed_at<v.vacated_at OR n.actual_at<d.signed_at THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Return requires retained vacancy, fresh Doctor instruction and actual Nurse handover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='NURSE' AND NOT banned) OR NOT EXISTS(SELECT 1 FROM hims.bed_holds WHERE admission_id=e.id AND bed_id=s.bed_id) OR EXISTS(SELECT 1 FROM hims.bed_turnovers t LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=t.id WHERE t.bed_id=s.bed_id AND (c.id IS NULL OR c.completed_at>NEW.returned_at)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current Nurse, reserved bed and actual cleaning are required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER room_return_source BEFORE INSERT ON hims.room_returns FOR EACH ROW EXECUTE FUNCTION hims.guard_room_return();
CREATE TRIGGER room_return_invalidation AFTER INSERT ON hims.room_returns FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('DOCTOR');
CREATE FUNCTION hims.guard_current_vacation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id;
 IF EXISTS(SELECT 1 FROM hims.effective_room_vacations WHERE admission_id=NEW.admission_id) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current bed vacancy already exists; explicit return supersession required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER current_room_vacation BEFORE INSERT ON hims.room_vacations FOR EACH ROW EXECUTE FUNCTION hims.guard_current_vacation();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION hims.guard_physical_discharge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; s hims.clearance_seals; st hims.effective_room_stays; n hims.nursing_shifts; v hims.room_vacations;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 SELECT * INTO st FROM hims.effective_room_stays WHERE id=NEW.stay_id;
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
  SELECT * INTO v FROM hims.effective_room_vacations WHERE admission_id=e.id;
  IF s.gate IS DISTINCT FROM 'BILLING' OR s.admission_id IS DISTINCT FROM e.id OR s.bill_version IS DISTINCT FROM NEW.bill_version OR e.bill_revision IS DISTINCT FROM NEW.bill_version OR EXISTS(SELECT 1 FROM hims.clearance_invalidations WHERE seal_id=s.id) THEN RAISE EXCEPTION 'Current same-episode Billing seal and bill required'; END IF;
  IF v.stay_id IS DISTINCT FROM st.id OR NEW.departed_at<v.vacated_at OR NEW.departed_at<s.signed_at OR NEW.departed_at>clock_timestamp() OR NEW.signed_at<NEW.departed_at THEN RAISE EXCEPTION 'Actual hospital departure must follow room vacancy and human clearance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role IN ('BILLING','ADMIN') AND NOT banned) THEN RAISE EXCEPTION 'Billing or Admin departure authority required'; END IF;
 END IF;
 RETURN NEW;
END $$;