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
