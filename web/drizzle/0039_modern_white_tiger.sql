CREATE TABLE "hims"."exception_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"note" text NOT NULL,
	"owner_id" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."exception_followups" ADD CONSTRAINT "exception_followups_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exception_followups" ADD CONSTRAINT "exception_followups_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exception_followups" ADD CONSTRAINT "exception_followups_owner_id_staff_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."exception_followups" ADD CONSTRAINT "exception_followups_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_followup_authority" ON "hims"."exception_followups" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "exception_followup_episode" ON "hims"."exception_followups" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "exception_followup_owner" ON "hims"."exception_followups" USING btree ("owner_id");
--> statement-breakpoint
CREATE TRIGGER exception_followups_immutable BEFORE UPDATE OR DELETE ON hims.exception_followups FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE FUNCTION hims.guard_exception_followup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x hims.admin_exceptions; current_owner text; staff_role text;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id;
 SELECT * INTO x FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 SELECT role INTO staff_role FROM hims.staff_user WHERE id=NEW.signed_by AND coalesce(banned,false)=false;
 SELECT owner_id INTO current_owner FROM hims.exception_followups WHERE exception_id=x.id ORDER BY signed_at DESC LIMIT 1;
 current_owner=coalesce(current_owner,x.follow_up_owner_id);
 IF x.admission_id IS DISTINCT FROM NEW.admission_id OR staff_role IS NULL OR (staff_role<>'ADMIN' AND (NEW.signed_by<>current_owner OR NEW.owner_id<>current_owner)) OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.owner_id AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current accountable owner or Admin must record follow-up'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exception_followups_source BEFORE INSERT ON hims.exception_followups FOR EACH ROW EXECUTE FUNCTION hims.guard_exception_followup();
CREATE OR REPLACE FUNCTION hims.guard_admin_exception() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; expected_kind text;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND coalesce(banned,false)=false) OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.follow_up_owner_id AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Admin and active follow-up owner required'; END IF;
 IF NOT (CASE NEW.type
 WHEN 'URGENT_ADMISSION' THEN NEW.disposition='ACTIVATE' AND e.status='PENDING'
 WHEN 'CANCELLED_DEPOSIT' THEN NEW.disposition='RETURN_DEPOSIT' AND e.status='CANCELLED' AND e.admitted_at IS NULL AND EXISTS(SELECT 1 FROM hims.receipts WHERE id=NEW.source_id AND admission_id=e.id AND party='PATIENT' AND kind<>'PAYMENT')
 WHEN 'POST_DISCHARGE_CORRECTION' THEN NEW.disposition='AMEND' AND e.status='DISCHARGED' AND NEW.source_id IS NOT NULL AND NEW.correction_kind IN ('RECEIPT','REFUND','ALLOCATE','CANCEL_ALLOCATION','INSURANCE_DECISION','DISPOSITION_REVIEW','CLINICAL_ADDENDUM','NURSING_ADDENDUM','LAB_ADDENDUM','LAB_REPORT')
 WHEN 'DELAYED_TRANSFER' THEN NEW.disposition='TRANSFER' AND e.status='ADMITTED'
 WHEN 'ROOM_CUTOFF_CORRECTION' THEN NEW.disposition='AMEND' AND e.status IN ('ADMITTED','DISCHARGED') AND EXISTS(SELECT 1 FROM hims.effective_room_stays WHERE id=NEW.source_id AND admission_id=e.id AND ended_at IS NOT NULL)
 WHEN 'RETURN_TO_BED' THEN NEW.disposition='RETURN_TO_BED' AND e.status='ADMITTED' AND EXISTS(SELECT 1 FROM hims.effective_room_vacations WHERE admission_id=e.id)
 WHEN 'UNAVAILABLE_APPROVER' THEN (NEW.disposition='FOLLOW_UP' AND e.status='ADMITTED') OR (NEW.disposition='CLOSE_ATTENDANCE' AND e.status IN ('ADMITTED','DISCHARGED') AND EXISTS(SELECT 1 FROM hims.nursing_shifts WHERE id=NEW.source_id AND admission_id=e.id))
 WHEN 'EARLY_EXIT' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'AGAINST_ADVICE' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'EXTERNAL_TRANSFER' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'DEATH' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'CREDIT' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'INSURANCE_DELAY' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 WHEN 'INSURANCE_DENIAL' THEN NEW.disposition IN ('FOLLOW_UP','EXCEPTIONAL_EXIT') AND e.status='ADMITTED'
 ELSE false END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Named exception does not authorize this episode disposition'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.evidence_ids) v(id) WHERE NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.id::text=v.id AND p.admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exception evidence must belong to the original admission'; END IF;
 expected_kind=CASE WHEN NEW.type IN ('AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH') THEN NEW.type WHEN NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NEW.disposition='EXCEPTIONAL_EXIT' THEN 'PLANNED_EXIT' END;
 IF expected_kind IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.role='DOCTOR' AND p.kind=expected_kind AND NEW.evidence_ids ? p.id::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proper signed Doctor disposition required'; END IF;
 IF NEW.type IN ('INSURANCE_DELAY','INSURANCE_DENIAL') AND (e.payment_route<>'INSURED' OR NOT EXISTS(SELECT 1 FROM hims.insurance_cases WHERE id=NEW.source_id AND admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual same-episode insurance case required'; END IF;
 IF NEW.type='INSURANCE_DENIAL' AND (SELECT status FROM hims.insurance_decisions WHERE case_id=NEW.source_id ORDER BY case_version DESC LIMIT 1) IS DISTINCT FROM 'REJECTED' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual current external denial required'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_exception_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; n hims.nursing_shifts;
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id RETURNING * INTO e;
 IF (e.status<>'ADMITTED' AND NOT(e.status='DISCHARGED' AND NEW.kind IN ('ROOM_CUTOFF','PROFESSIONAL_REVIEW'))) OR NEW.actual_at<e.admitted_at OR NEW.actual_at>clock_timestamp() OR NEW.signed_at<NEW.actual_at OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role=NEW.role AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current professional evidence with factual episode time required'; END IF;
 IF NEW.kind='PROFESSIONAL_REVIEW' AND NOT EXISTS(SELECT 1 FROM hims.admin_exceptions x JOIN hims.exceptional_departures d ON d.id=x.source_id WHERE x.id=NEW.exception_id AND x.admission_id=e.id AND x.type='POST_DISCHARGE_CORRECTION' AND x.disposition='AMEND' AND x.correction_kind='DISPOSITION_REVIEW' AND x.source_id=NEW.source_id AND d.admission_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Professional follow-up requires specific retained departure authority'; END IF;
 IF NEW.kind='ROOM_CUTOFF' AND NOT EXISTS(SELECT 1 FROM hims.admin_exceptions x WHERE x.id=NEW.exception_id AND x.admission_id=e.id AND x.type='ROOM_CUTOFF_CORRECTION' AND x.disposition='AMEND' AND x.source_id=NEW.source_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cutoff witness must bind retained original authority'; END IF;
 IF NEW.role='DOCTOR' AND e.admitting_doctor_id<>NEW.signed_by THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assigned Doctor evidence required'; END IF;
 IF NEW.role='NURSE' THEN
  SELECT * INTO n FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  IF n.admission_id IS DISTINCT FROM e.id OR n.nurse_id IS DISTINCT FROM NEW.signed_by OR NEW.actual_at<n.started_at OR EXISTS(SELECT 1 FROM hims.effective_shift_ends WHERE shift_id=n.id AND ended_at<NEW.actual_at) OR NOT EXISTS(SELECT 1 FROM hims.nurse_assignments a WHERE a.admission_id=e.id AND a.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current assigned Nurse and actual attendance required'; END IF;
 END IF;
 IF NEW.vacated_at IS NOT NULL AND (NEW.vacated_at<e.admitted_at OR NEW.vacated_at>NEW.actual_at) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Physical vacancy must precede hospital exit'; END IF;
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
 IF NOT (a.evidence_ids ? p.id::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual departure witness must be included in authority'; END IF;
 IF EXISTS(SELECT 1 FROM (
 SELECT actual_at t FROM hims.medication_administrations WHERE admission_id=e.id
 UNION ALL SELECT observed_at FROM hims.nursing_observations WHERE admission_id=e.id
 UNION ALL SELECT used_at FROM hims.nursing_consumables WHERE admission_id=e.id
 UNION ALL SELECT transferred_at FROM hims.admission_transfers WHERE admission_id=e.id
 UNION ALL SELECT ended_at FROM hims.effective_shift_ends n JOIN hims.nursing_shifts h ON h.id=n.shift_id WHERE h.admission_id=e.id
 ) facts WHERE t>NEW.departed_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recorded actual care or attendance continues after claimed departure'; END IF;
 RETURN NEW;
END $$;
