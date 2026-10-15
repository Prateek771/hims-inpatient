-- External performed-service billing evidence is separate from clinical orders, reports and seals.
CREATE TABLE hims.mvp_external_services(
 id uuid PRIMARY KEY,admission_id uuid NOT NULL REFERENCES hims.admissions(id),charge_id uuid NOT NULL UNIQUE REFERENCES hims.charges(id),
 category text NOT NULL CHECK(category IN ('consultation','procedure','consumable','lab','radiology')),item_id text NOT NULL,quantity text NOT NULL,unit text NOT NULL,tariff_version_id uuid NOT NULL REFERENCES hims.setting_versions(id),
 performed_at timestamptz NOT NULL,department_issuer text NOT NULL,external_bill_reference text NOT NULL,external_line_reference text NOT NULL,evidence text NOT NULL,
 recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorder_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT mvp_external_bill_line_once UNIQUE(admission_id,department_issuer,external_bill_reference,external_line_reference)
);
CREATE INDEX mvp_external_episode ON hims.mvp_external_services(admission_id,recorded_at);
CREATE TRIGGER mvp_external_immutable BEFORE UPDATE OR DELETE ON hims.mvp_external_services FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE FUNCTION hims.guard_mvp_external_service() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; actor hims.staff_user; c hims.charges; rate hims.setting_versions; policy jsonb; department text; fraction text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 SELECT * INTO actor FROM hims.staff_user WHERE id=NEW.recorded_by FOR SHARE;
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 SELECT * INTO c FROM hims.charges WHERE id=NEW.charge_id;
 IF e.workflow_version IS DISTINCT FROM 2 OR e.status IS DISTINCT FROM 'ADMITTED' OR actor.id IS NULL OR coalesce(actor.banned,false) OR actor.role NOT IN ('ADMIN','BILLING') OR NEW.recorder_name IS DISTINCT FROM actor.name
 OR NEW.performed_at<e.admitted_at OR NEW.performed_at>clock_timestamp() OR NEW.recorded_at<NEW.performed_at OR NEW.recorded_at>clock_timestamp()
 OR length(btrim(NEW.department_issuer)) NOT BETWEEN 3 AND 2000 OR length(btrim(NEW.evidence)) NOT BETWEEN 3 AND 2000 OR length(btrim(NEW.external_bill_reference)) NOT BETWEEN 1 AND 200 OR length(btrim(NEW.external_line_reference)) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Admin/Billing recorder, actual performed-service time and external issuer bill-line evidence required';END IF;
 SELECT * INTO rate FROM hims.setting_versions v WHERE v.hospital_id=e.hospital_id AND v.kind='tariff' AND v.payload->>'type'='billable-item' AND v.payload->>'code'=NEW.item_id ORDER BY v.version DESC LIMIT 1;policy=rate.payload;
 department=CASE WHEN NEW.category IN ('consultation','procedure') THEN 'DOCTOR' WHEN NEW.category='consumable' THEN 'NURSE' ELSE 'LAB' END;
 IF rate.id IS DISTINCT FROM NEW.tariff_version_id OR (policy->>'active')::boolean IS DISTINCT FROM true OR policy->>'category' IS DISTINCT FROM NEW.category OR policy->>'department' IS DISTINCT FROM department OR policy->>'unit' IS DISTINCT FROM NEW.unit
 OR NEW.quantity !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='External billing source must pin the current active configured department item and quantity unit';END IF;
 fraction=split_part(NEW.quantity,'.',2);
 IF NEW.quantity::numeric<=0 OR length(fraction)>(policy->>'quantityScale')::integer OR c.admission_id IS DISTINCT FROM e.id OR c.source_event_id IS DISTINCT FROM NEW.id::text OR c.category IS DISTINCT FROM NEW.category OR c.item_id IS DISTINCT FROM NEW.item_id OR c.quantity IS DISTINCT FROM NEW.quantity OR c.unit IS DISTINCT FROM NEW.unit OR c.tariff_version_id IS DISTINCT FROM rate.id
 OR c.actor_type IS DISTINCT FROM 'staff' OR c.actor_id IS DISTINCT FROM actor.id OR c.initial_status IS DISTINCT FROM 'FINAL' OR c.correction_exception_id IS NOT NULL OR c.description IS DISTINCT FROM policy->>'name' OR c.rate_paise::numeric IS DISTINCT FROM (policy->>'amount')::numeric OR c.amount_paise::numeric IS DISTINCT FROM floor((policy->>'amount')::numeric*NEW.quantity::numeric+0.5)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='External performed-service charge must match its exact immutable source and deterministic configured rate';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_external_source BEFORE INSERT ON hims.mvp_external_services FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_external_service();
-- The charge may be inserted first, but a source-less v2 service charge can never commit.
CREATE FUNCTION hims.guard_mvp_external_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM hims.admissions WHERE id=NEW.admission_id AND workflow_version=2) AND NOT EXISTS(SELECT 1 FROM hims.mvp_external_services s WHERE s.charge_id=NEW.id AND s.id::text=NEW.source_event_id AND s.admission_id=NEW.admission_id AND s.recorded_by=NEW.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Version 2 service charges require their atomic external performed-service source';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mvp_external_charge_pair AFTER INSERT ON hims.charges DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.category IN ('consultation','procedure','consumable','lab','radiology')) EXECUTE FUNCTION hims.guard_mvp_external_pair();
-- Existing ordinary and correction ledger sources remain intact; only affected v2 checks reopen.
CREATE FUNCTION hims.invalidate_mvp_external_charge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid; category text; source text;
BEGIN
 IF TG_TABLE_NAME='charges' THEN episode=NEW.admission_id;category=NEW.category;source=NEW.id::text;
 ELSE SELECT c.admission_id,c.category INTO episode,category FROM hims.charges c WHERE c.id=NEW.charge_id;source=NEW.id::text;END IF;
 IF category NOT IN ('consultation','procedure','consumable','lab','radiology') OR NOT EXISTS(SELECT 1 FROM hims.admissions WHERE id=episode AND workflow_version=2) THEN RETURN NEW;END IF;
 INSERT INTO hims.mvp_invalidations(event_id,kind,source_id) SELECT ev.id,'external-service-'||TG_TABLE_NAME,source FROM hims.mvp_events ev WHERE ev.admission_id=episode AND (ev.action='finance' OR (ev.action IN ('check','n-a') AND ((category IN ('lab','radiology') AND ev.check_key='DIAGNOSTICS') OR (category='consumable' AND ev.check_key='NURSING')))) ON CONFLICT(event_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_external_charge_invalidation AFTER INSERT ON hims.charges FOR EACH ROW WHEN(NEW.category IN ('consultation','procedure','consumable','lab','radiology')) EXECUTE FUNCTION hims.invalidate_mvp_external_charge();
CREATE TRIGGER mvp_external_reversal_invalidation AFTER INSERT ON hims.charge_reversals FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_external_charge();

-- Alias-only repair: the SELF_PAY conversion JOIN must not collide with the declared c row variable.
CREATE OR REPLACE FUNCTION hims.mvp_finance_guard(episode uuid,selected jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; d hims.insurance_decisions; c hims.insurance_cases; net numeric; ins numeric=0; patient numeric; patient_cash numeric; patient_applied numeric; insurer_cash numeric; deposits numeric; allocated numeric; eligible numeric; copay numeric;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=episode FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM hims.effective_room_vacations WHERE admission_id=e.id)
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['NURSING','PHARMACY','INSURANCE','DIAGNOSTICS']) k WHERE hims.mvp_current(e.id,k) IS NULL)
 OR EXISTS(SELECT 1 FROM hims.charges ch WHERE ch.admission_id=e.id AND ch.initial_status='PENDING' AND NOT EXISTS(SELECT 1 FROM hims.charge_finalizations f WHERE f.charge_id=ch.id) AND ch.amount_paise>coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0))
 OR EXISTS(SELECT 1 FROM hims.transfer_insurance_tasks t WHERE t.admission_id=e.id AND NOT EXISTS(SELECT 1 FROM hims.insurance_transfer_resolutions r WHERE r.task_id=t.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current applicable checks, actual vacancy and reconciled sources required'; END IF;
 SELECT coalesce(sum(ch.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0)),0) INTO net FROM hims.charges ch WHERE ch.admission_id=e.id AND (ch.initial_status='FINAL' OR EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=ch.id));
 patient=net;
 IF e.payment_route='INSURED' THEN
  SELECT * INTO c FROM hims.insurance_cases WHERE admission_id=e.id;
  SELECT * INTO d FROM hims.insurance_decisions WHERE case_id=c.id ORDER BY case_version DESC LIMIT 1;
  IF d.id IS NULL OR d.status='PENDING' OR (d.allocation->>'netBillPaise')::numeric IS DISTINCT FROM net OR (selected->'financial'->>'decisionId')::uuid IS DISTINCT FROM d.id
   OR d.policy_event_id IS DISTINCT FROM (SELECT id FROM hims.insurance_events WHERE case_id=c.id AND kind='POLICY' ORDER BY case_version DESC LIMIT 1)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current externally verified accepted responsibility required'; END IF;
  eligible=(d.allocation->>'eligibleBillPaise')::numeric;copay=floor((eligible*d.co_pay_bps+5000)/10000);
  ins=least(d.approved_paise,eligible-copay);patient=coalesce((d.allocation->>'verifiedPatientLiabilityPaise')::numeric,copay+net-eligible);
 ELSE
  IF EXISTS(SELECT 1 FROM hims.insurance_conversions x JOIN hims.insurance_cases converted_case ON converted_case.id=x.case_id WHERE converted_case.admission_id=e.id) THEN
   -- Self-pay conversions retain their reviewed historical external liability; no fabricated cash.
   SELECT coalesce((x.allocation->>'retainedInsurerLiabilityPaise')::numeric,0),coalesce((x.allocation->>'verifiedPatientLiabilityPaise')::numeric,net) INTO ins,patient FROM hims.insurance_conversions x JOIN hims.insurance_cases converted_case ON converted_case.id=x.case_id WHERE converted_case.admission_id=e.id;
  END IF;
 END IF;
 SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds f WHERE f.receipt_id=r.id),0)) FILTER(WHERE r.party='PATIENT'),0),
 coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds f WHERE f.receipt_id=r.id),0)) FILTER(WHERE r.party='INSURER'),0),
 coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds f WHERE f.receipt_id=r.id),0)) FILTER(WHERE r.kind<>'PAYMENT'),0),
 coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds f WHERE f.receipt_id=r.id),0)) FILTER(WHERE r.party='PATIENT' AND r.kind='PAYMENT'),0)
 INTO patient_cash,insurer_cash,deposits,patient_applied FROM hims.receipts r WHERE r.admission_id=e.id;
 SELECT coalesce(sum(a.amount_paise),0) INTO allocated FROM hims.receipt_allocations a JOIN hims.receipts r ON r.id=a.receipt_id WHERE r.admission_id=e.id AND NOT EXISTS(SELECT 1 FROM hims.allocation_cancellations x WHERE x.allocation_id=a.id);
 patient_applied=patient_applied+allocated;
 IF ins<0 OR patient<0 OR ins+patient<>net OR patient_applied<>patient OR patient_cash<>patient OR insurer_cash>ins OR deposits<>allocated
 OR (selected->'bill'->>'revision')::integer IS DISTINCT FROM e.bill_revision OR (selected->'bill'->>'netPaise')::numeric IS DISTINCT FROM net
 OR (selected->'financial'->'responsibility'->>'insurerPaise')::numeric IS DISTINCT FROM ins OR (selected->'financial'->'responsibility'->>'patientPaise')::numeric IS DISTINCT FROM patient
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact reconciled patient settlement and accepted insurer responsibility required; receivable is distinct from cash'; END IF;
END $$;
