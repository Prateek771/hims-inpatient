CREATE TABLE "hims"."transfer_order_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "transfer_order_cancellations_transfer_order_id_unique" UNIQUE("transfer_order_id")
);
--> statement-breakpoint
ALTER TABLE "hims"."charge_reversals" ADD COLUMN "correction_exception_id" uuid;--> statement-breakpoint
ALTER TABLE "hims"."charge_reversals" ADD COLUMN "physical_amendment_id" uuid;--> statement-breakpoint
ALTER TABLE "hims"."charges" ADD COLUMN "correction_exception_id" uuid;--> statement-breakpoint
ALTER TABLE "hims"."transfer_order_cancellations" ADD CONSTRAINT "transfer_order_cancellations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_order_cancellations" ADD CONSTRAINT "transfer_order_cancellations_transfer_order_id_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "hims"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_order_cancellations" ADD CONSTRAINT "transfer_order_cancellations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_cancel_episode_idx" ON "hims"."transfer_order_cancellations" USING btree ("admission_id");
-- Extend retained closed-source authority without rewriting prior applied SQL.
-- Extend only retained performed-work and converted-responsibility correction authority.
CREATE OR REPLACE FUNCTION hims.guard_admin_exception() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; expected_kind text;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND coalesce(banned,false)=false) OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.follow_up_owner_id AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Admin and active follow-up owner required'; END IF;
 IF NOT (CASE NEW.type
 WHEN 'URGENT_ADMISSION' THEN NEW.disposition='ACTIVATE' AND e.status='PENDING'
 WHEN 'CANCELLED_DEPOSIT' THEN NEW.disposition='RETURN_DEPOSIT' AND e.status='CANCELLED' AND e.admitted_at IS NULL AND EXISTS(SELECT 1 FROM hims.receipts WHERE id=NEW.source_id AND admission_id=e.id AND party='PATIENT' AND kind<>'PAYMENT')
 WHEN 'POST_DISCHARGE_CORRECTION' THEN NEW.disposition='AMEND' AND e.status='DISCHARGED' AND NEW.source_id IS NOT NULL AND NEW.correction_kind IN ('RECEIPT','REFUND','ALLOCATE','CANCEL_ALLOCATION','INSURANCE_DECISION','DISPOSITION_REVIEW','CLINICAL_ADDENDUM','NURSING_ADDENDUM','LAB_ADDENDUM','LAB_REPORT','LAB_BILLING','SELF_PAY_REVIEW','REVERSE_CHARGE','CARE_BILLING')
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
 IF NEW.type='POST_DISCHARGE_CORRECTION' AND NEW.correction_kind='REVERSE_CHARGE' AND NOT EXISTS(SELECT 1 FROM hims.charges WHERE id=NEW.source_id AND admission_id=e.id AND category<>'room' AND source_event_id NOT LIKE 'room:%') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed reversal authority must bind original non-room charge'; END IF;
 IF NEW.type='POST_DISCHARGE_CORRECTION' AND NEW.correction_kind='CARE_BILLING' AND NOT EXISTS(SELECT 1 FROM hims.care_billing_events b WHERE b.id=NEW.source_id AND b.admission_id=e.id AND ((b.category='consultation' AND EXISTS(SELECT 1 FROM hims.clinical_rounds r WHERE r.id=b.round_id AND r.admission_id=e.id)) OR (b.category='consumable' AND EXISTS(SELECT 1 FROM hims.nursing_consumables n WHERE n.id=b.id AND n.admission_id=e.id)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed care authority requires retained performed original source'; END IF;
 IF NEW.type='POST_DISCHARGE_CORRECTION' AND NEW.correction_kind IN ('REVERSE_CHARGE','CARE_BILLING') AND (NEW.snapshot->>'billVersion')::int IS DISTINCT FROM e.bill_revision THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New financial authority requires current bill version'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.evidence_ids) v(id) WHERE NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.id::text=v.id AND p.admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exception evidence must belong to the original admission'; END IF;
 expected_kind=CASE WHEN NEW.type IN ('AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH') THEN NEW.type WHEN NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NEW.disposition='EXCEPTIONAL_EXIT' THEN 'PLANNED_EXIT' END;
 IF expected_kind IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.role='DOCTOR' AND p.kind=expected_kind AND NEW.evidence_ids ? p.id::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proper signed Doctor disposition required'; END IF;
 IF NEW.type IN ('INSURANCE_DELAY','INSURANCE_DENIAL') AND (e.payment_route<>'INSURED' OR NOT EXISTS(SELECT 1 FROM hims.insurance_cases WHERE id=NEW.source_id AND admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual same-episode insurance case required'; END IF;
 IF NEW.type='INSURANCE_DENIAL' AND (SELECT status FROM hims.insurance_decisions WHERE case_id=NEW.source_id ORDER BY case_version DESC LIMIT 1) IS DISTINCT FROM 'REJECTED' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual current external denial required'; END IF;
 RETURN NEW;
END $$;
-- Correct the external-decision result signer to its retained recorded_by column.
-- Each closed-episode amendment binds the retained authority, professional and actual result.
-- The effect and this append-only link are committed in the same application transaction.
CREATE OR REPLACE FUNCTION hims.guard_post_discharge_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e hims.admissions;
  x hims.admin_exceptions;
  staff_role text;
  valid_result boolean := false;
BEGIN
  UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
  SELECT * INTO x FROM hims.admin_exceptions WHERE id=NEW.exception_id;
  SELECT role INTO staff_role FROM hims.staff_user WHERE id=NEW.signed_by AND coalesce(banned,false)=false;
  IF e.status IS DISTINCT FROM 'DISCHARGED'
     OR x.admission_id IS DISTINCT FROM e.id
     OR x.type IS DISTINCT FROM 'POST_DISCHARGE_CORRECTION'
     OR x.disposition IS DISTINCT FROM 'AMEND'
     OR x.correction_kind IS DISTINCT FROM NEW.kind
     OR x.source_id IS DISTINCT FROM NEW.source_id
     OR staff_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed amendment requires current staff and exact retained authority';
  END IF;
  CASE NEW.kind
    WHEN 'RECEIPT' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.receipts WHERE id=NEW.result_id AND admission_id=e.id AND actor_id=NEW.signed_by)
        AND (EXISTS(SELECT 1 FROM hims.departures WHERE id=NEW.source_id AND admission_id=e.id)
          OR EXISTS(SELECT 1 FROM hims.exceptional_departures WHERE id=NEW.source_id AND admission_id=e.id));
    WHEN 'REFUND' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.receipt_refunds WHERE id=NEW.result_id AND receipt_id=NEW.source_id AND admission_id=e.id AND actor_id=NEW.signed_by);
    WHEN 'ALLOCATE' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.receipt_allocations a JOIN hims.receipts r ON r.id=a.receipt_id WHERE a.id=NEW.result_id AND r.id=NEW.source_id AND r.admission_id=e.id AND a.actor_id=NEW.signed_by);
    WHEN 'CANCEL_ALLOCATION' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.allocation_cancellations c JOIN hims.receipt_allocations a ON a.id=c.allocation_id JOIN hims.receipts r ON r.id=a.receipt_id WHERE c.id=NEW.result_id AND a.id=NEW.source_id AND r.admission_id=e.id AND c.actor_id=NEW.signed_by);
    WHEN 'INSURANCE_DECISION' THEN
      valid_result := staff_role IN ('ADMIN','BILLING','INSURANCE')
        AND EXISTS(SELECT 1 FROM hims.insurance_decisions d JOIN hims.insurance_cases c ON c.id=d.case_id WHERE d.id=NEW.result_id AND c.id=NEW.source_id AND c.admission_id=e.id AND d.recorded_by=NEW.signed_by AND (staff_role<>'INSURANCE' OR c.assigned_staff_id=NEW.signed_by));
    WHEN 'DISPOSITION_REVIEW' THEN
      valid_result := staff_role='DOCTOR' AND e.admitting_doctor_id=NEW.signed_by
        AND EXISTS(SELECT 1 FROM hims.exception_evidence WHERE id=NEW.result_id AND admission_id=e.id AND source_id=NEW.source_id AND exception_id=x.id AND kind='PROFESSIONAL_REVIEW' AND signed_by=NEW.signed_by);
    WHEN 'CLINICAL_ADDENDUM' THEN
      valid_result := staff_role='DOCTOR' AND e.admitting_doctor_id=NEW.signed_by
        AND EXISTS(SELECT 1 FROM hims.clinical_addenda a JOIN hims.clinical_rounds r ON r.id=a.note_id WHERE a.id=NEW.result_id AND r.id=NEW.source_id AND r.admission_id=e.id AND a.signed_by=NEW.signed_by);
    WHEN 'NURSING_ADDENDUM' THEN
      valid_result := staff_role='NURSE'
        AND EXISTS(SELECT 1 FROM hims.nurse_assignments a WHERE a.admission_id=e.id AND a.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id))
        AND EXISTS(SELECT 1 FROM hims.nursing_addenda WHERE id=NEW.result_id AND record_id=NEW.source_id AND admission_id=e.id AND signed_by=NEW.signed_by);
    WHEN 'LAB_ADDENDUM' THEN
      valid_result := staff_role='LAB'
        AND EXISTS(SELECT 1 FROM hims.lab_report_addenda a JOIN hims.lab_reports r ON r.id=a.report_id WHERE a.id=NEW.result_id AND r.id=NEW.source_id AND r.admission_id=e.id AND a.signed_by=NEW.signed_by);
    WHEN 'SELF_PAY_REVIEW' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.self_pay_reviews r WHERE r.id=NEW.result_id AND r.admission_id=e.id AND r.actor_id=NEW.signed_by)
        AND EXISTS(SELECT 1 FROM hims.insurance_conversions c JOIN hims.insurance_cases i ON i.id=c.case_id WHERE c.id=NEW.source_id AND i.admission_id=e.id);
    WHEN 'LAB_BILLING' THEN
      valid_result := staff_role='LAB'
        AND EXISTS(SELECT 1 FROM hims.lab_reports r JOIN hims.care_billing_events b ON b.order_id=r.order_id JOIN hims.charges c ON c.source_event_id=b.id::text WHERE r.id=NEW.result_id AND r.order_id=NEW.source_id AND r.admission_id=e.id AND b.state='POSTED' AND c.admission_id=e.id);
    WHEN 'REVERSE_CHARGE' THEN
      valid_result := staff_role IN ('ADMIN','BILLING')
        AND EXISTS(SELECT 1 FROM hims.charge_reversals r JOIN hims.charges c ON c.id=r.charge_id WHERE r.id=NEW.result_id AND c.id=NEW.source_id AND c.admission_id=e.id AND c.category<>'room' AND c.source_event_id NOT LIKE 'room:%' AND r.actor_id=NEW.signed_by AND r.correction_exception_id=x.id);
    WHEN 'CARE_BILLING' THEN
      valid_result := NEW.result_id=NEW.source_id AND EXISTS(SELECT 1 FROM hims.care_billing_events b JOIN hims.charges c ON c.source_event_id=b.id::text WHERE b.id=NEW.source_id AND b.admission_id=e.id AND b.state='POSTED' AND c.admission_id=e.id AND c.correction_exception_id=x.id AND c.actor_id=NEW.signed_by AND ((b.category='consultation' AND staff_role='DOCTOR' AND e.admitting_doctor_id=NEW.signed_by AND EXISTS(SELECT 1 FROM hims.clinical_rounds r WHERE r.id=b.round_id AND r.admission_id=e.id)) OR (b.category='consumable' AND staff_role='NURSE' AND EXISTS(SELECT 1 FROM hims.nursing_consumables n WHERE n.id=b.id AND n.admission_id=e.id) AND EXISTS(SELECT 1 FROM hims.nurse_assignments n WHERE n.admission_id=e.id AND n.nurse_id=NEW.signed_by AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=n.id)))));
    WHEN 'LAB_REPORT' THEN
      valid_result := staff_role='LAB'
        AND EXISTS(SELECT 1 FROM hims.lab_reports WHERE id=NEW.result_id AND order_id=NEW.source_id AND admission_id=e.id AND signed_by=NEW.signed_by);
    ELSE valid_result := false;
  END CASE;
  IF NEW.kind IN ('REVERSE_CHARGE','CARE_BILLING') AND ((NEW.before_snapshot->>'billVersion')::int IS DISTINCT FROM (x.snapshot->>'billVersion')::int OR (NEW.after_snapshot->>'billVersion')::int IS DISTINCT FROM e.bill_revision) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial amendment must bind its fresh authority and persisted bill result'; END IF;
  IF valid_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Amendment result must be the proper role signed effect on its original source';
  END IF;
  RETURN NEW;
END $$;

-- Current attributable transfer withdrawal; admission ownership serializes both insertion orders.
CREATE FUNCTION hims.guard_transfer_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; o hims.transfer_orders;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 IF TG_TABLE_NAME='transfer_order_cancellations' THEN
  SELECT * INTO o FROM hims.transfer_orders WHERE id=NEW.transfer_order_id;
  IF e.status IS DISTINCT FROM 'ADMITTED' OR o.admission_id IS DISTINCT FROM e.id
   OR o.id IS DISTINCT FROM (SELECT id FROM hims.transfer_orders WHERE admission_id=e.id ORDER BY version DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM hims.effective_room_stays WHERE id=o.source_stay_id AND admission_id=e.id AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE transfer_order_id=o.id)
   OR EXISTS(SELECT 1 FROM hims.exception_evidence WHERE admission_id=e.id AND kind='TRANSFER_HANDOVER' AND source_id=o.id)
   OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='DOCTOR' AND NOT coalesce(banned,false))
   OR e.admitting_doctor_id IS DISTINCT FROM NEW.signed_by OR length(btrim(NEW.reason))<1
   OR NEW.signed_at<o.signed_at OR NEW.signed_at>clock_timestamp()
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Withdrawal requires current Doctor and truly unperformed current transfer authority'; END IF;
 ELSIF TG_TABLE_NAME='admission_transfers' THEN
  SELECT * INTO o FROM hims.transfer_orders WHERE id=NEW.transfer_order_id;
  IF e.status IS DISTINCT FROM 'ADMITTED' OR o.admission_id IS DISTINCT FROM e.id OR o.source_stay_id IS DISTINCT FROM NEW.old_stay_id
   OR o.id IS DISTINCT FROM (SELECT id FROM hims.transfer_orders WHERE admission_id=e.id ORDER BY version DESC LIMIT 1)
   OR EXISTS(SELECT 1 FROM hims.transfer_order_cancellations WHERE transfer_order_id=o.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual transfer cannot consume cancelled or superseded authority'; END IF;
 ELSE
  IF NEW.kind<>'TRANSFER_HANDOVER' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM hims.transfer_orders WHERE id=NEW.source_id;
  IF e.status IS DISTINCT FROM 'ADMITTED' OR o.admission_id IS DISTINCT FROM e.id
   OR o.id IS DISTINCT FROM (SELECT id FROM hims.transfer_orders WHERE admission_id=e.id ORDER BY version DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM hims.effective_room_stays WHERE id=o.source_stay_id AND admission_id=e.id AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM hims.transfer_order_cancellations WHERE transfer_order_id=o.id)
   OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE transfer_order_id=o.id) OR NEW.actual_at<o.signed_at
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Witnessed transfer requires current uncancelled original authority'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transfer_cancellation_source BEFORE INSERT ON hims.transfer_order_cancellations FOR EACH ROW EXECUTE FUNCTION hims.guard_transfer_withdrawal();
CREATE TRIGGER transfer_cancellation_immutable BEFORE UPDATE OR DELETE ON hims.transfer_order_cancellations FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER transfer_cancellation_clearance AFTER INSERT ON hims.transfer_order_cancellations FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('DOCTOR');
CREATE TRIGGER transfer_current_authority BEFORE INSERT ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.guard_transfer_withdrawal();
CREATE TRIGGER transfer_witness_authority BEFORE INSERT ON hims.exception_evidence FOR EACH ROW EXECUTE FUNCTION hims.guard_transfer_withdrawal();

CREATE FUNCTION hims.assert_planned_exit_instruction(episode uuid, selected jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE last_return timestamptz;
BEGIN
 IF EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=episode AND p.kind='RETURN_TO_BED'
  AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence c WHERE c.kind='RETURN_CANCELLED' AND c.source_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.doctor_evidence_id=p.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Planned departure requires actual return or source-bound Doctor reconsideration'; END IF;
 SELECT max(returned_at) INTO last_return FROM hims.room_returns WHERE admission_id=episode;
 IF last_return IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=episode AND p.role='DOCTOR' AND p.kind='PLANNED_EXIT' AND selected ? p.id::text AND p.actual_at>=last_return AND p.signed_at>=last_return)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual return requires fresh appropriate Doctor exit disposition'; END IF;
END $$;
CREATE FUNCTION hims.guard_final_exit_chronology() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; a hims.admin_exceptions; required_kind text;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 IF TG_TABLE_NAME='admin_exceptions' THEN
  IF NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NEW.disposition='EXCEPTIONAL_EXIT' THEN PERFORM hims.assert_planned_exit_instruction(e.id,NEW.evidence_ids); END IF;
 ELSIF TG_TABLE_NAME='exceptional_departures' THEN
  SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.exception_id;
  required_kind=CASE WHEN a.type IN ('DEATH','EXTERNAL_TRANSFER','AGAINST_ADVICE') THEN a.type WHEN a.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') THEN 'PLANNED_EXIT' END;
  IF required_kind IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.role='DOCTOR' AND p.kind=required_kind AND a.evidence_ids ? p.id::text AND p.actual_at<=NEW.departed_at)
   OR EXISTS(SELECT 1 FROM hims.exception_evidence p WHERE p.admission_id=e.id AND p.role='DOCTOR' AND p.kind=required_kind AND a.evidence_ids ? p.id::text AND p.actual_at>NEW.departed_at))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Selected actual Doctor disposition cannot follow the witnessed hospital exit'; END IF;
  IF required_kind='PLANNED_EXIT' THEN PERFORM hims.assert_planned_exit_instruction(e.id,a.evidence_ids); END IF;
 ELSIF NEW.role='DOCTOR' AND NEW.kind IN ('DEATH','EXTERNAL_TRANSFER','AGAINST_ADVICE','PLANNED_EXIT') AND EXISTS(SELECT 1 FROM (SELECT departed_at FROM hims.departures WHERE admission_id=e.id UNION ALL SELECT departed_at FROM hims.exceptional_departures WHERE admission_id=e.id) d WHERE d.departed_at<NEW.actual_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual professional disposition cannot occur after actual hospital exit';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER planned_exception_instruction BEFORE INSERT ON hims.admin_exceptions FOR EACH ROW EXECUTE FUNCTION hims.guard_final_exit_chronology();
CREATE TRIGGER selected_doctor_exit_chronology BEFORE INSERT ON hims.exceptional_departures FOR EACH ROW EXECUTE FUNCTION hims.guard_final_exit_chronology();
CREATE TRIGGER actual_doctor_exit_chronology BEFORE INSERT ON hims.exception_evidence FOR EACH ROW EXECUTE FUNCTION hims.guard_final_exit_chronology();

-- Effect rows explicitly bind closed financial authority or the actual physical amendment.
ALTER TABLE hims.charges ADD CONSTRAINT charge_correction_authority_fk FOREIGN KEY(correction_exception_id) REFERENCES hims.admin_exceptions(id);
ALTER TABLE hims.charge_reversals ADD CONSTRAINT reversal_correction_authority_fk FOREIGN KEY(correction_exception_id) REFERENCES hims.admin_exceptions(id);
ALTER TABLE hims.charge_reversals ADD CONSTRAINT reversal_physical_amendment_fk FOREIGN KEY(physical_amendment_id) REFERENCES hims.stay_boundary_amendments(id);
CREATE INDEX charge_correction_authority_idx ON hims.charges(correction_exception_id);
CREATE INDEX reversal_correction_authority_idx ON hims.charge_reversals(correction_exception_id);
CREATE INDEX reversal_physical_amendment_idx ON hims.charge_reversals(physical_amendment_id);
CREATE FUNCTION hims.guard_final_financial_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; c hims.charges; a hims.admin_exceptions; b hims.care_billing_events; st hims.effective_room_stays; amendment hims.stay_boundary_amendments; policy jsonb; staff_role text; elapsed numeric; unit_ms numeric; rate numeric; due numeric; net numeric; prior numeric;
BEGIN
 IF TG_TABLE_NAME='charge_reversals' THEN SELECT * INTO c FROM hims.charges WHERE id=NEW.charge_id; ELSE c=NEW; END IF;
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=c.admission_id RETURNING * INTO e;
 SELECT role INTO staff_role FROM hims.staff_user WHERE id=NEW.actor_id AND NOT coalesce(banned,false);
 IF TG_TABLE_NAME='charge_reversals' THEN
  SELECT coalesce(sum(amount_paise),0) INTO prior FROM hims.charge_reversals WHERE charge_id=c.id;
  IF prior+NEW.amount_paise>c.amount_paise THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reversal exceeds remaining original source'; END IF;
  IF c.category='room' OR c.source_event_id LIKE 'room:%' THEN
   SELECT * INTO amendment FROM hims.stay_boundary_amendments WHERE id=NEW.physical_amendment_id;
   SELECT * INTO st FROM hims.effective_room_stays WHERE id=amendment.stay_id;
   IF NEW.correction_exception_id IS NOT NULL OR NEW.actor_type<>'staff' OR staff_role IS DISTINCT FROM 'ADMIN'
    OR amendment.id IS NULL OR st.amendment_id IS DISTINCT FROM amendment.id OR amendment.admission_id IS DISTINCT FROM e.id
    OR amendment.signed_by IS DISTINCT FROM NEW.actor_id OR c.source_event_id NOT LIKE 'room:'||st.id::text||':%'
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Room reversal requires the current original-source physical amendment'; END IF;
   SELECT payload INTO policy FROM hims.setting_versions WHERE id=st.tariff_version_id;
   elapsed=greatest(0,floor(extract(epoch FROM st.ended_at)*1000)-floor(extract(epoch FROM st.started_at)*1000)-coalesce((policy->>'graceMinutes')::numeric,0)*60000);
   unit_ms=CASE WHEN policy->>'basis'='hour' THEN 3600000 ELSE 86400000 END; rate=(policy->>'amount')::numeric*100;
   due=CASE WHEN policy->>'rounding'='started-unit' THEN floor((elapsed+unit_ms-1)/unit_ms)*rate ELSE floor((elapsed*rate+unit_ms/2)/unit_ms) END;
   SELECT coalesce(sum(ch.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM hims.charge_reversals r WHERE r.charge_id=ch.id),0)),0) INTO net FROM hims.charges ch WHERE ch.admission_id=e.id AND ch.source_event_id LIKE 'room:'||st.id::text||':%';
   IF net-NEW.amount_paise<due THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Physical correction cannot waive occupied time or double-credit the pinned room rate'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.physical_amendment_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Physical amendment only corrects its original room source'; END IF;
 END IF;
 IF NEW.correction_exception_id IS NOT NULL THEN
  SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.correction_exception_id;
  IF e.status IS DISTINCT FROM 'DISCHARGED' OR NEW.actor_type<>'staff' OR staff_role IS NULL OR a.admission_id IS DISTINCT FROM e.id OR a.type IS DISTINCT FROM 'POST_DISCHARGE_CORRECTION' OR a.disposition IS DISTINCT FROM 'AMEND' OR (a.snapshot->>'billVersion')::int IS DISTINCT FROM e.bill_revision THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed financial effect needs fresh exact Admin authority'; END IF;
  IF TG_TABLE_NAME='charge_reversals' THEN
   IF a.correction_kind IS DISTINCT FROM 'REVERSE_CHARGE' OR a.source_id IS DISTINCT FROM c.id OR staff_role NOT IN ('ADMIN','BILLING') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed reversal requires proper Billing role and original non-room charge'; END IF;
  ELSE
   SELECT * INTO b FROM hims.care_billing_events WHERE id::text=NEW.source_event_id AND admission_id=e.id;
   IF a.correction_kind='CARE_BILLING' THEN
    IF b.id IS DISTINCT FROM a.source_id OR b.category IS DISTINCT FROM NEW.category OR b.item_id IS DISTINCT FROM NEW.item_id OR b.quantity IS DISTINCT FROM NEW.quantity OR b.unit IS DISTINCT FROM NEW.unit OR b.tariff_version_id IS DISTINCT FROM NEW.tariff_version_id OR NEW.initial_status<>'FINAL'
     OR NOT ((b.category='consultation' AND staff_role='DOCTOR' AND e.admitting_doctor_id=NEW.actor_id AND EXISTS(SELECT 1 FROM hims.clinical_rounds r WHERE r.id=b.round_id AND r.admission_id=e.id)) OR (b.category='consumable' AND staff_role='NURSE' AND EXISTS(SELECT 1 FROM hims.nursing_consumables n WHERE n.id=b.id AND n.admission_id=e.id AND n.item_id=b.item_id AND n.quantity=b.quantity AND n.unit=b.unit) AND EXISTS(SELECT 1 FROM hims.nurse_assignments n WHERE n.admission_id=e.id AND n.nurse_id=NEW.actor_id AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=n.id))))
    THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed care fee requires original performed source quantity pin and current proper role'; END IF;
   ELSIF a.correction_kind IN ('LAB_REPORT','LAB_BILLING') THEN
    IF staff_role IS DISTINCT FROM 'LAB' OR b.order_id IS DISTINCT FROM a.source_id OR b.category NOT IN ('lab','radiology') OR NOT EXISTS(SELECT 1 FROM hims.lab_processing WHERE order_id=b.order_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed diagnostic fee requires original performed Lab source'; END IF;
   ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No authority for this closed charge'; END IF;
   SELECT payload INTO policy FROM hims.setting_versions WHERE id=NEW.tariff_version_id AND hospital_id=e.hospital_id;
   IF policy->>'type' IS DISTINCT FROM 'billable-item' OR policy->>'code' IS DISTINCT FROM NEW.item_id OR policy->>'category' IS DISTINCT FROM NEW.category OR policy->>'unit' IS DISTINCT FROM NEW.unit OR NEW.rate_paise IS DISTINCT FROM ((policy->>'amount')::numeric*100)::bigint OR NEW.amount_paise IS DISTINCT FROM round((policy->>'amount')::numeric*100*NEW.quantity::numeric)::bigint THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed charge must retain the exact configured rate and original quantity'; END IF;
  END IF;
 ELSIF e.status='DISCHARGED' AND c.category<>'room' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed non-room money requires exact source-bound amendment authority';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_charge_source BEFORE INSERT ON hims.charges FOR EACH ROW EXECUTE FUNCTION hims.guard_final_financial_source();
CREATE TRIGGER final_reversal_source BEFORE INSERT ON hims.charge_reversals FOR EACH ROW EXECUTE FUNCTION hims.guard_final_financial_source();
CREATE FUNCTION hims.guard_final_financial_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a hims.admin_exceptions; valid boolean;
BEGIN
 SELECT * INTO a FROM hims.admin_exceptions WHERE id=NEW.correction_exception_id;
 IF TG_TABLE_NAME='charge_reversals' THEN
  valid=EXISTS(SELECT 1 FROM hims.post_discharge_amendments m WHERE m.exception_id=a.id AND m.kind='REVERSE_CHARGE' AND m.source_id=NEW.charge_id AND m.result_id=NEW.id AND m.signed_by=NEW.actor_id);
 ELSE
  valid=EXISTS(SELECT 1 FROM hims.post_discharge_amendments m WHERE m.exception_id=a.id AND m.kind=a.correction_kind AND m.source_id=a.source_id AND m.signed_by=NEW.actor_id AND ((m.kind='CARE_BILLING' AND m.result_id::text=NEW.source_event_id) OR (m.kind IN ('LAB_REPORT','LAB_BILLING') AND EXISTS(SELECT 1 FROM hims.lab_reports r WHERE r.id=m.result_id AND r.order_id=a.source_id))));
 END IF;
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed financial effect must commit its exact persisted attributable amendment'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER closed_charge_result AFTER INSERT ON hims.charges DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.correction_exception_id IS NOT NULL) EXECUTE FUNCTION hims.guard_final_financial_result();
CREATE CONSTRAINT TRIGGER closed_reversal_result AFTER INSERT ON hims.charge_reversals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.correction_exception_id IS NOT NULL) EXECUTE FUNCTION hims.guard_final_financial_result();
