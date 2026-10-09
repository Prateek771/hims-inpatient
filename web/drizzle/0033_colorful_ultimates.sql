CREATE TABLE "hims"."exception_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"shift_id" uuid,
	"source_id" uuid,
	"actual_at" timestamp with time zone NOT NULL,
	"vacated_at" timestamp with time zone,
	"notes" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exception_evidence_role" CHECK (("hims"."exception_evidence"."kind" in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER') and "hims"."exception_evidence"."role"='NURSE' and "hims"."exception_evidence"."shift_id" is not null) or ("hims"."exception_evidence"."kind" not in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER') and "hims"."exception_evidence"."role"='DOCTOR'))
);
--> statement-breakpoint
CREATE TABLE "hims"."exceptional_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"physical_evidence_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"departed_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exceptional_departures_admission_id_unique" UNIQUE("admission_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."post_discharge_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD CONSTRAINT "exception_evidence_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD CONSTRAINT "exception_evidence_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exception_evidence" ADD CONSTRAINT "exception_evidence_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exceptional_departures" ADD CONSTRAINT "exceptional_departures_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exceptional_departures" ADD CONSTRAINT "exceptional_departures_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exceptional_departures" ADD CONSTRAINT "exceptional_departures_physical_evidence_id_exception_evidence_id_fk" FOREIGN KEY ("physical_evidence_id") REFERENCES "hims"."exception_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exceptional_departures" ADD CONSTRAINT "exceptional_departures_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exceptional_departures" ADD CONSTRAINT "exceptional_departures_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."post_discharge_amendments" ADD CONSTRAINT "post_discharge_amendments_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."post_discharge_amendments" ADD CONSTRAINT "post_discharge_amendments_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."post_discharge_amendments" ADD CONSTRAINT "post_discharge_amendments_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_evidence_episode" ON "hims"."exception_evidence" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "exception_evidence_shift" ON "hims"."exception_evidence" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "exception_evidence_source" ON "hims"."exception_evidence" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "exceptional_departure_authority" ON "hims"."exceptional_departures" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "exceptional_departure_stay" ON "hims"."exceptional_departures" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "exceptional_departure_evidence" ON "hims"."exceptional_departures" USING btree ("physical_evidence_id");--> statement-breakpoint
CREATE INDEX "amendment_episode" ON "hims"."post_discharge_amendments" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "amendment_authority" ON "hims"."post_discharge_amendments" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "amendment_source" ON "hims"."post_discharge_amendments" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "amendment_result" ON "hims"."post_discharge_amendments" USING btree ("result_id");
--> statement-breakpoint
CREATE TRIGGER exception_evidence_immutable BEFORE UPDATE OR DELETE ON hims.exception_evidence FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER exceptional_departures_immutable BEFORE UPDATE OR DELETE ON hims.exceptional_departures FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER post_discharge_amendments_immutable BEFORE UPDATE OR DELETE ON hims.post_discharge_amendments FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE FUNCTION hims.guard_exception_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; n hims.nursing_shifts;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 IF e.status<>'ADMITTED' OR NEW.actual_at<e.admitted_at OR NEW.actual_at>clock_timestamp() OR NEW.signed_at<NEW.actual_at OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role=NEW.role AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current professional evidence with factual episode time required'; END IF;
 IF NEW.role='DOCTOR' AND e.admitting_doctor_id<>NEW.signed_by THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assigned Doctor evidence required'; END IF;
 IF NEW.role='NURSE' THEN
  SELECT * INTO n FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  IF n.admission_id IS DISTINCT FROM e.id OR n.nurse_id IS DISTINCT FROM NEW.signed_by OR NEW.actual_at<n.started_at OR EXISTS(SELECT 1 FROM hims.nursing_shift_ends WHERE shift_id=n.id AND ended_at<NEW.actual_at) OR NOT EXISTS(SELECT 1 FROM hims.nurse_assignments a WHERE a.admission_id=e.id AND a.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current assigned Nurse and actual attendance required'; END IF;
 END IF;
 IF NEW.vacated_at IS NOT NULL AND (NEW.vacated_at<e.admitted_at OR NEW.vacated_at>NEW.actual_at) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Physical vacancy must precede hospital exit'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exception_evidence_source BEFORE INSERT ON hims.exception_evidence FOR EACH ROW EXECUTE FUNCTION hims.guard_exception_evidence();
CREATE FUNCTION hims.guard_exceptional_departure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; a hims.admin_exceptions; p hims.exception_evidence; s hims.room_stays;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 SELECT * INTO p FROM hims.exception_evidence WHERE id=NEW.physical_evidence_id;
 SELECT * INTO s FROM hims.room_stays WHERE id=NEW.stay_id;
 IF e.status<>'ADMITTED' OR a.admission_id IS DISTINCT FROM e.id OR a.disposition<>'EXCEPTIONAL_EXIT' OR p.admission_id IS DISTINCT FROM e.id OR p.kind<>'PHYSICAL_EXIT' OR p.actual_at IS DISTINCT FROM NEW.departed_at OR s.admission_id IS DISTINCT FROM e.id OR s.ended_at IS DISTINCT FROM p.vacated_at OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND NOT banned) OR EXISTS(SELECT 1 FROM hims.departures WHERE admission_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Actual source-linked exceptional departure required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exceptional_departure_source BEFORE INSERT ON hims.exceptional_departures FOR EACH ROW EXECUTE FUNCTION hims.guard_exceptional_departure();
CREATE FUNCTION hims.guard_exception_attendance_end() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
 SELECT admission_id INTO episode FROM hims.nursing_shifts WHERE id=NEW.shift_id;
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=episode;
 IF EXISTS(SELECT 1 FROM hims.exception_evidence WHERE shift_id=NEW.shift_id AND actual_at>NEW.ended_at) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Attendance cannot end before witnessed physical exception evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exception_attendance_end BEFORE INSERT ON hims.nursing_shift_ends FOR EACH ROW EXECUTE FUNCTION hims.guard_exception_attendance_end();
