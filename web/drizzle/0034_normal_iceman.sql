CREATE TABLE "hims"."stay_boundary_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stay_amendment_bounds" CHECK ("hims"."stay_boundary_amendments"."version">0 and ("hims"."stay_boundary_amendments"."ended_at" is null or "hims"."stay_boundary_amendments"."ended_at">"hims"."stay_boundary_amendments"."started_at"))
);
--> statement-breakpoint
DROP INDEX "hims"."room_stay_active_admission_idx";--> statement-breakpoint
ALTER TABLE "hims"."stay_boundary_amendments" ADD CONSTRAINT "stay_boundary_amendments_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."stay_boundary_amendments" ADD CONSTRAINT "stay_boundary_amendments_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."stay_boundary_amendments" ADD CONSTRAINT "stay_boundary_amendments_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."stay_boundary_amendments" ADD CONSTRAINT "stay_boundary_amendments_evidence_id_exception_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "hims"."exception_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."stay_boundary_amendments" ADD CONSTRAINT "stay_boundary_amendments_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stay_amendment_version" ON "hims"."stay_boundary_amendments" USING btree ("stay_id","version");--> statement-breakpoint
CREATE INDEX "stay_amendment_episode" ON "hims"."stay_boundary_amendments" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "stay_amendment_authority" ON "hims"."stay_boundary_amendments" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "stay_amendment_evidence" ON "hims"."stay_boundary_amendments" USING btree ("evidence_id");
--> statement-breakpoint
CREATE VIEW hims.effective_room_stays AS
 SELECT s.id,s.admission_id,s.bed_id,s.tariff_version_id,
 coalesce(a.started_at,s.started_at) started_at,CASE WHEN a.id IS NULL THEN s.ended_at ELSE a.ended_at END ended_at,
 s.last_reconciled_at,s.posted_paise,a.id amendment_id
 FROM hims.room_stays s LEFT JOIN LATERAL (SELECT x.* FROM hims.stay_boundary_amendments x WHERE x.stay_id=s.id ORDER BY version DESC LIMIT 1) a ON true;
CREATE TRIGGER stay_amendment_immutable BEFORE UPDATE OR DELETE ON hims.stay_boundary_amendments FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE FUNCTION hims.guard_stay_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s hims.room_stays; a hims.admin_exceptions; p hims.exception_evidence; e hims.admissions;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO s FROM hims.room_stays WHERE id=NEW.stay_id;
 UPDATE hims.beds SET active=active WHERE id=s.bed_id;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 SELECT * INTO p FROM hims.exception_evidence WHERE id=NEW.evidence_id;
 IF s.admission_id IS DISTINCT FROM e.id OR a.admission_id IS DISTINCT FROM e.id OR p.admission_id IS DISTINCT FROM e.id OR p.role<>'NURSE' OR NEW.version<>coalesce((SELECT max(version) FROM hims.stay_boundary_amendments WHERE stay_id=s.id),0)+1 OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Attributable same-episode administrator and Nurse source required'; END IF;
 IF NEW.started_at<e.admitted_at OR NEW.started_at>clock_timestamp() OR NEW.ended_at>clock_timestamp() OR (NEW.ended_at IS NULL AND (s.ended_at IS NOT NULL OR e.status='DISCHARGED')) OR (NEW.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM coalesce(p.vacated_at,p.actual_at)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Amended physical time must retain actual professional source and cannot reopen a closed episode'; END IF;
 IF EXISTS(SELECT 1 FROM hims.effective_room_stays x WHERE x.id<>s.id AND (x.bed_id=s.bed_id OR x.admission_id=e.id) AND tstzrange(x.started_at,x.ended_at,'[)')&&tstzrange(NEW.started_at,NEW.ended_at,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Amended physical occupancy conflicts with retained history'; END IF;
 IF EXISTS(SELECT 1 FROM hims.nursing_consumables WHERE stay_id=s.id AND (used_at<NEW.started_at OR (NEW.ended_at IS NOT NULL AND used_at>=NEW.ended_at))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Amendment cannot silently reassign original source-unit consumables'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stay_amendment_guard BEFORE INSERT ON hims.stay_boundary_amendments FOR EACH ROW EXECUTE FUNCTION hims.guard_stay_amendment();
CREATE TRIGGER stay_amendment_invalidation AFTER INSERT ON hims.stay_boundary_amendments FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('BILLING');
CREATE OR REPLACE FUNCTION hims.guard_physical_bed_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a hims.stay_boundary_amendments; effective_start timestamptz; effective_end timestamptz;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id;
 UPDATE hims.beds SET active=active WHERE id=NEW.bed_id;
 SELECT * INTO a FROM hims.stay_boundary_amendments WHERE stay_id=NEW.id ORDER BY version DESC LIMIT 1;
 effective_start=coalesce(a.started_at,NEW.started_at); effective_end=CASE WHEN a.id IS NULL THEN NEW.ended_at ELSE a.ended_at END;
 IF EXISTS(SELECT 1 FROM hims.effective_room_stays s WHERE s.id<>NEW.id AND (s.bed_id=NEW.bed_id OR s.admission_id=NEW.admission_id) AND tstzrange(s.started_at,s.ended_at,'[)')&&tstzrange(effective_start,effective_end,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Effective physical room stays cannot overlap'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hims.guard_effective_consumable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id;
 IF NOT EXISTS(SELECT 1 FROM hims.effective_room_stays s WHERE s.id=NEW.stay_id AND s.admission_id=NEW.admission_id AND s.bed_id=NEW.bed_id AND NEW.used_at>=s.started_at AND (s.ended_at IS NULL OR NEW.used_at<s.ended_at)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Consumable must retain its actual effective physical source unit'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER effective_consumable_source BEFORE INSERT ON hims.nursing_consumables FOR EACH ROW EXECUTE FUNCTION hims.guard_effective_consumable();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION hims.validate_transfer_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hims.effective_room_stays previous_stay JOIN hims.effective_room_stays next_stay ON next_stay.id=NEW.new_stay_id
    JOIN hims.transfer_orders o ON o.id=NEW.transfer_order_id
    JOIN hims.nursing_shifts s ON s.id=NEW.shift_id
    WHERE previous_stay.id=NEW.old_stay_id AND previous_stay.admission_id=NEW.admission_id AND next_stay.admission_id=NEW.admission_id
    AND o.admission_id=NEW.admission_id AND o.source_stay_id=previous_stay.id AND s.admission_id=NEW.admission_id AND s.nurse_id=NEW.signed_by
    AND previous_stay.bed_id=NEW.old_bed_id AND next_stay.bed_id=NEW.target_bed_id AND previous_stay.bed_id<>next_stay.bed_id
    AND previous_stay.ended_at=NEW.transferred_at AND next_stay.started_at=NEW.transferred_at
  ) THEN RAISE EXCEPTION 'Transfer must retain exact adjacent stays and episode/signature provenance'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_bed_turnover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t hims.bed_turnovers; s hims.effective_room_stays;
BEGIN
 IF TG_TABLE_NAME='bed_holds' THEN
  PERFORM 1 FROM hims.beds WHERE id=NEW.bed_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM hims.bed_turnovers b LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=b.id WHERE b.bed_id=NEW.bed_id AND (c.id IS NULL OR c.completed_at>NEW.held_at)) THEN RAISE EXCEPTION 'Actual housekeeping completion required before bed reuse'; END IF;
 ELSIF TG_TABLE_NAME='bed_turnovers' THEN
  SELECT * INTO s FROM hims.effective_room_stays WHERE id=NEW.stay_id;
  IF s.bed_id IS DISTINCT FROM NEW.bed_id OR s.admission_id IS DISTINCT FROM NEW.admission_id OR s.ended_at IS DISTINCT FROM NEW.vacated_at THEN RAISE EXCEPTION 'Turnover must reference the actual closed physical stay'; END IF;
 ELSE
  SELECT * INTO t FROM hims.bed_turnovers WHERE id=NEW.turnover_id;
  PERFORM 1 FROM hims.beds WHERE id=t.bed_id FOR UPDATE;
  IF NEW.completed_at<t.vacated_at OR NEW.completed_at>clock_timestamp() THEN RAISE EXCEPTION 'Cleaning completion must follow actual bed vacancy'; END IF;
 END IF;
 RETURN NEW;
END $$;
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
  SELECT * INTO v FROM hims.room_vacations WHERE admission_id=e.id;
  IF s.gate IS DISTINCT FROM 'BILLING' OR s.admission_id IS DISTINCT FROM e.id OR s.bill_version IS DISTINCT FROM NEW.bill_version OR e.bill_revision IS DISTINCT FROM NEW.bill_version OR EXISTS(SELECT 1 FROM hims.clearance_invalidations WHERE seal_id=s.id) THEN RAISE EXCEPTION 'Current same-episode Billing seal and bill required'; END IF;
  IF v.stay_id IS DISTINCT FROM st.id OR NEW.departed_at<v.vacated_at OR NEW.departed_at<s.signed_at OR NEW.departed_at>clock_timestamp() OR NEW.signed_at<NEW.departed_at THEN RAISE EXCEPTION 'Actual hospital departure must follow room vacancy and human clearance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role IN ('BILLING','ADMIN') AND NOT banned) THEN RAISE EXCEPTION 'Billing or Admin departure authority required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_exceptional_departure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; a hims.admin_exceptions; p hims.exception_evidence; s hims.effective_room_stays;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 SELECT * INTO p FROM hims.exception_evidence WHERE id=NEW.physical_evidence_id;
 SELECT * INTO s FROM hims.effective_room_stays WHERE id=NEW.stay_id;
 IF e.status<>'ADMITTED' OR a.admission_id IS DISTINCT FROM e.id OR a.disposition<>'EXCEPTIONAL_EXIT' OR p.admission_id IS DISTINCT FROM e.id OR p.kind<>'PHYSICAL_EXIT' OR p.actual_at IS DISTINCT FROM NEW.departed_at OR s.admission_id IS DISTINCT FROM e.id OR s.ended_at IS DISTINCT FROM p.vacated_at OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND NOT banned) OR EXISTS(SELECT 1 FROM hims.departures WHERE admission_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Actual source-linked exceptional departure required'; END IF;
 RETURN NEW;
END $$;