-- Extend only retained performed-work and converted-responsibility correction authority.
CREATE OR REPLACE FUNCTION hims.guard_admin_exception() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; expected_kind text;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND coalesce(banned,false)=false) OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.follow_up_owner_id AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Admin and active follow-up owner required'; END IF;
 IF NOT (CASE NEW.type
 WHEN 'URGENT_ADMISSION' THEN NEW.disposition='ACTIVATE' AND e.status='PENDING'
 WHEN 'CANCELLED_DEPOSIT' THEN NEW.disposition='RETURN_DEPOSIT' AND e.status='CANCELLED' AND e.admitted_at IS NULL AND EXISTS(SELECT 1 FROM hims.receipts WHERE id=NEW.source_id AND admission_id=e.id AND party='PATIENT' AND kind<>'PAYMENT')
 WHEN 'POST_DISCHARGE_CORRECTION' THEN NEW.disposition='AMEND' AND e.status='DISCHARGED' AND NEW.source_id IS NOT NULL AND NEW.correction_kind IN ('RECEIPT','REFUND','ALLOCATE','CANCEL_ALLOCATION','INSURANCE_DECISION','DISPOSITION_REVIEW','CLINICAL_ADDENDUM','NURSING_ADDENDUM','LAB_ADDENDUM','LAB_REPORT','LAB_BILLING','SELF_PAY_REVIEW')
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
    WHEN 'LAB_REPORT' THEN
      valid_result := staff_role='LAB'
        AND EXISTS(SELECT 1 FROM hims.lab_reports WHERE id=NEW.result_id AND order_id=NEW.source_id AND admission_id=e.id AND signed_by=NEW.signed_by);
    ELSE valid_result := false;
  END CASE;
  IF valid_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Amendment result must be the proper role signed effect on its original source';
  END IF;
  RETURN NEW;
END $$;
