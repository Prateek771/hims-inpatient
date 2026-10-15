-- New episodes opt into version 2 explicitly. Every existing episode retains version 1.
ALTER TABLE hims.admissions ADD COLUMN workflow_version integer NOT NULL DEFAULT 1 CHECK(workflow_version IN (1,2));
CREATE TABLE hims.mvp_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES hims.admissions(id),
 action text NOT NULL CHECK(action IN ('doctor-approval','checklist','check','n-a','finance','deliver')),
 check_key text, status text, payload jsonb NOT NULL, review_hash text NOT NULL CHECK(review_hash ~ '^[0-9a-f]{64}$'),
 bill_version integer NOT NULL,clinical_id uuid REFERENCES hims.mvp_events(id),checklist_id uuid REFERENCES hims.mvp_events(id),
 recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mvp_event_episode ON hims.mvp_events(admission_id,recorded_at);
CREATE TABLE hims.mvp_invalidations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL UNIQUE REFERENCES hims.mvp_events(id),kind text NOT NULL,source_id text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE hims.mvp_medicine_sources(
 id uuid PRIMARY KEY,admission_id uuid NOT NULL REFERENCES hims.admissions(id),kind text NOT NULL CHECK(kind IN ('CHARGE','RETURN')),
 original_id uuid REFERENCES hims.mvp_medicine_sources(id),charge_id uuid NOT NULL REFERENCES hims.charges(id),reversal_id uuid REFERENCES hims.charge_reversals(id),
 quantity text NOT NULL CHECK(quantity ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' AND quantity::numeric>0),quantity_scale integer NOT NULL CHECK(quantity_scale BETWEEN 0 AND 6),
 evidence text NOT NULL CHECK(length(btrim(evidence))>=3),reference text NOT NULL,recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(admission_id,kind,reference)
);
CREATE INDEX mvp_medicine_episode ON hims.mvp_medicine_sources(admission_id);
CREATE INDEX mvp_medicine_original ON hims.mvp_medicine_sources(original_id);
CREATE UNIQUE INDEX mvp_medicine_reversal_once ON hims.mvp_medicine_sources(reversal_id);
CREATE UNIQUE INDEX mvp_medicine_charge_once ON hims.mvp_medicine_sources(charge_id) WHERE kind='CHARGE';
CREATE TABLE hims.mvp_receivable_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admission_id uuid NOT NULL REFERENCES hims.admissions(id),finance_id uuid NOT NULL REFERENCES hims.mvp_events(id),receipt_id uuid NOT NULL UNIQUE REFERENCES hims.receipts(id),recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX mvp_receivable_episode ON hims.mvp_receivable_receipts(admission_id);
ALTER TABLE hims.room_vacations ALTER COLUMN nursing_seal_id DROP NOT NULL;
ALTER TABLE hims.room_vacations ADD COLUMN mvp_readiness_id uuid REFERENCES hims.mvp_events(id);
ALTER TABLE hims.departures ALTER COLUMN bill_seal_id DROP NOT NULL;
ALTER TABLE hims.departures ADD COLUMN mvp_finance_id uuid REFERENCES hims.mvp_events(id);
ALTER TABLE hims.discharge_documents ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version IN (1,2));
ALTER TABLE hims.discharge_documents ADD COLUMN kind text NOT NULL DEFAULT 'FINAL' CHECK(kind IN ('CLINICAL','FINAL'));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mvp_events','mvp_invalidations','mvp_medicine_sources','mvp_receivable_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history()',t||'_immutable',t);
 END LOOP;
END $$;

CREATE FUNCTION hims.mvp_current(episode uuid,kind text) RETURNS uuid LANGUAGE sql STABLE AS $$
 WITH chosen AS (SELECT e.* FROM hims.mvp_events e WHERE e.admission_id=episode AND
  (CASE WHEN kind IN ('doctor-approval','checklist','finance') THEN e.action=kind ELSE e.action IN ('check','n-a') AND e.check_key=kind END)
  ORDER BY e.recorded_at DESC,e.id DESC LIMIT 1)
 SELECT c.id FROM chosen c WHERE NOT EXISTS(SELECT 1 FROM hims.mvp_invalidations i WHERE i.event_id=c.id)
 AND (kind='doctor-approval' OR c.clinical_id=(SELECT id FROM hims.mvp_events WHERE admission_id=episode AND action='doctor-approval' ORDER BY recorded_at DESC,id DESC LIMIT 1))
 AND (kind IN ('doctor-approval','checklist') OR c.checklist_id=(SELECT id FROM hims.mvp_events WHERE admission_id=episode AND action='checklist' ORDER BY recorded_at DESC,id DESC LIMIT 1))
 AND (kind IN ('doctor-approval','checklist','finance') OR c.status IN ('COMPLETE','NA'))
$$;
CREATE FUNCTION hims.mvp_assigned(episode uuid,actor text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM hims.staff_user u JOIN hims.nurse_assignments a ON a.nurse_id=u.id WHERE u.id=actor AND u.role='NURSE' AND NOT coalesce(u.banned,false) AND a.admission_id=episode AND NOT EXISTS(SELECT 1 FROM hims.nurse_assignment_revocations r WHERE r.assignment_id=a.id))
$$;
CREATE FUNCTION hims.mvp_finance_guard(episode uuid,selected jsonb) RETURNS void LANGUAGE plpgsql AS $$
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
  IF EXISTS(SELECT 1 FROM hims.insurance_conversions x JOIN hims.insurance_cases c ON c.id=x.case_id WHERE c.admission_id=e.id) THEN
   -- Self-pay conversions retain their reviewed historical external liability; no fabricated cash.
   SELECT coalesce((x.allocation->>'retainedInsurerLiabilityPaise')::numeric,0),coalesce((x.allocation->>'verifiedPatientLiabilityPaise')::numeric,net) INTO ins,patient FROM hims.insurance_conversions x JOIN hims.insurance_cases c ON c.id=x.case_id WHERE c.admission_id=e.id;
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
CREATE FUNCTION hims.guard_mvp_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; actor hims.staff_user; doc hims.discharge_documents; clinical uuid; checklist uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 SELECT * INTO actor FROM hims.staff_user WHERE id=NEW.recorded_by FOR SHARE;
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version IS DISTINCT FROM 2 OR e.status IS DISTINCT FROM 'ADMITTED' OR actor.id IS NULL OR coalesce(actor.banned,false) OR NEW.bill_version<>e.bill_revision OR NEW.recorded_at>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current MVP episode, actor and bill source required'; END IF;
 clinical=hims.mvp_current(e.id,'doctor-approval');checklist=hims.mvp_current(e.id,'checklist');
 IF NEW.action IN ('doctor-approval','checklist') OR (NEW.action='check' AND NEW.check_key IN ('NURSING','DIAGNOSTICS')) THEN
  IF NOT hims.mvp_assigned(e.id,actor.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse records external authority and readiness'; END IF;
 ELSIF NEW.action='check' THEN
  IF (NEW.check_key='PHARMACY' AND actor.role<>'PHARMACY') OR (NEW.check_key='INSURANCE' AND (actor.role<>'INSURANCE' OR NOT EXISTS(SELECT 1 FROM hims.insurance_cases WHERE admission_id=e.id AND assigned_staff_id=actor.id))) OR NEW.check_key NOT IN ('PHARMACY','INSURANCE') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current responsible department actor required'; END IF;
 ELSIF NEW.action='n-a' AND actor.role<>'ADMIN' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Admin confirms optional applicability';
 ELSIF NEW.action='finance' AND actor.role NOT IN ('ADMIN','BILLING') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Admin or Billing final financial authority required';
 ELSIF NEW.action='deliver' AND NOT (actor.role='ADMIN' OR hims.mvp_assigned(e.id,actor.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse or Admin delivers papers'; END IF;
 IF NEW.action='doctor-approval' THEN
  IF length(btrim(coalesce(NEW.payload->>'authorizerName','')))<3 OR length(btrim(coalesce(NEW.payload->>'evidence','')))<3 OR length(btrim(coalesce(NEW.payload->>'clinicalSummary','')))<3 OR length(btrim(coalesce(NEW.payload->>'prescription','')))<3 OR length(btrim(coalesce(NEW.payload->>'followUp','')))<3 OR (NEW.payload->>'sourceTime')::timestamptz<e.admitted_at OR (NEW.payload->>'sourceTime')::timestamptz>clock_timestamp() OR NEW.payload->>'sourceTime' IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Named external Doctor source and actual source time required'; END IF;
 ELSE
  IF clinical IS NULL OR NEW.clinical_id IS DISTINCT FROM clinical THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current external Doctor authorization required'; END IF;
  IF NEW.action<>'checklist' AND NOT(NEW.action='deliver' AND NEW.payload->>'kind'='CLINICAL') AND (checklist IS NULL OR NEW.checklist_id IS DISTINCT FROM checklist) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current published checklist required'; END IF;
 END IF;
 IF NEW.action='checklist' THEN
  IF jsonb_typeof(NEW.payload->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.payload->'proposedNa') IS DISTINCT FROM 'array' OR length(btrim(coalesce(NEW.payload->>'remarks','')))<3 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Published physical checklist and applicability proposal required';END IF;
  IF jsonb_array_length(NEW.payload->'items') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.payload->'items') i WHERE length(btrim(i))<3) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.payload->'proposedNa') k WHERE k NOT IN ('PHARMACY','INSURANCE','DIAGNOSTICS')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Checklist must retain actual items and optional-only applicability';END IF;
 END IF;
 IF NEW.action='check' AND length(btrim(coalesce(NEW.payload->>'remarks','')))<3 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attributed department remarks required';END IF;
 IF NEW.action='check' AND (coalesce(NEW.check_key,'') NOT IN ('NURSING','PHARMACY','INSURANCE','DIAGNOSTICS') OR coalesce(NEW.status,'') NOT IN ('PENDING','COMPLETE')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid attributed department status required'; END IF;
 IF NEW.action='check' AND NEW.check_key='DIAGNOSTICS' AND NEW.status='COMPLETE' AND (length(btrim(coalesce(NEW.payload->>'confirmerName','')))<3 OR length(btrim(coalesce(NEW.payload->>'evidence','')))<3 OR NEW.payload->>'sourceTime' IS NULL OR (NEW.payload->>'sourceTime')::timestamptz>clock_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Named external diagnostic confirmation required; Nurse is recorder'; END IF;
 IF NEW.action='n-a' THEN
  IF NEW.check_key NOT IN ('PHARMACY','INSURANCE','DIAGNOSTICS') OR NEW.status IS DISTINCT FROM 'NA' OR length(btrim(coalesce(NEW.payload->>'reason','')))<3
   OR NOT EXISTS(SELECT 1 FROM hims.mvp_events WHERE id=checklist AND payload->'proposedNa' ? NEW.check_key)
   OR (NEW.check_key='INSURANCE' AND (e.payment_route<>'SELF_PAY' OR EXISTS(SELECT 1 FROM hims.insurance_cases WHERE admission_id=e.id)))
   OR (NEW.check_key='PHARMACY' AND EXISTS(SELECT 1 FROM hims.charges WHERE admission_id=e.id AND category='medicine'))
   OR (NEW.check_key='DIAGNOSTICS' AND EXISTS(SELECT 1 FROM hims.charges WHERE admission_id=e.id AND category IN ('lab','radiology')))
   OR (SELECT status FROM hims.mvp_events WHERE admission_id=e.id AND check_key=NEW.check_key AND action IN ('check','n-a') ORDER BY recorded_at DESC,id DESC LIMIT 1)='PENDING'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Optional N/A needs Nurse proposal, Admin reason and absence of relevant work'; END IF;
 END IF;
 IF NEW.action='finance' THEN PERFORM hims.mvp_finance_guard(e.id,NEW.payload); END IF;
 IF NEW.action='deliver' THEN
  SELECT * INTO doc FROM hims.discharge_documents WHERE id=(NEW.payload->>'documentId')::uuid;
  IF doc.admission_id IS DISTINCT FROM e.id OR doc.schema_version IS DISTINCT FROM 2 OR doc.kind IS DISTINCT FROM NEW.payload->>'kind' OR doc.hash IS DISTINCT FROM NEW.payload->>'documentHash' OR doc.version IS DISTINCT FROM (NEW.payload->>'documentVersion')::integer OR NEW.payload->>'deliveredAt' IS NULL OR length(btrim(coalesce(NEW.payload->>'recipient','')))<3 OR length(btrim(coalesce(NEW.payload->>'evidence','')))<3
   OR (NEW.payload->>'deliveredAt')::timestamptz<doc.created_at OR (NEW.payload->>'deliveredAt')::timestamptz>clock_timestamp()
   OR (doc.snapshot->'clinical'->>'id')::uuid IS DISTINCT FROM clinical
   OR (doc.kind='FINAL' AND ((NEW.payload->>'financeId')::uuid IS DISTINCT FROM hims.mvp_current(e.id,'finance') OR (doc.snapshot->'finance'->>'id')::uuid IS DISTINCT FROM hims.mvp_current(e.id,'finance')))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact current authorized document delivery required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mvp_event_source BEFORE INSERT ON hims.mvp_events FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_event();
CREATE FUNCTION hims.invalidate_mvp_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action IN ('doctor-approval','checklist','check','n-a') THEN
  INSERT INTO hims.mvp_invalidations(event_id,kind,source_id) SELECT id,NEW.action,NEW.id::text FROM hims.mvp_events WHERE admission_id=NEW.admission_id AND id<>NEW.id AND
  (action='finance' OR (NEW.action='doctor-approval' AND action IN ('checklist','check','n-a')) OR (NEW.action='checklist' AND action IN ('check','n-a')) OR (NEW.action IN ('check','n-a') AND action IN ('check','n-a') AND check_key=NEW.check_key)) ON CONFLICT(event_id) DO NOTHING;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_event_invalidation AFTER INSERT ON hims.mvp_events FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_event();

-- Preserve the literal legacy gate algorithm while routing new episode invalidation by real dependency.
CREATE OR REPLACE FUNCTION hims.invalidate_clearances(episode uuid, first_gate text, changed_kind text, changed_ids jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE version integer;
BEGIN
 SELECT workflow_version INTO version FROM hims.admissions WHERE id=episode FOR UPDATE;
 IF version=2 THEN
  IF EXISTS(SELECT 1 FROM hims.admissions WHERE id=episode AND status='DISCHARGED') THEN RETURN; END IF;
  INSERT INTO hims.mvp_invalidations(event_id,kind,source_id)
  SELECT e.id,changed_kind,changed_ids::text FROM hims.mvp_events e WHERE e.admission_id=episode AND
   (e.action='finance' OR (e.action IN ('check','n-a') AND ((first_gate='PHARMACY' AND e.check_key='PHARMACY') OR (first_gate='NURSING' AND e.check_key='NURSING') OR (changed_kind LIKE 'insurance%' AND e.check_key='INSURANCE')))) ON CONFLICT(event_id) DO NOTHING;
  RETURN;
 END IF;
 INSERT INTO hims.clearance_invalidations(seal_id,change_kind,changed_record_ids)
 SELECT s.id,changed_kind,changed_ids FROM hims.clearance_seals s
 WHERE s.admission_id=episode AND array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],s.gate)>=array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],first_gate)
 AND NOT EXISTS(SELECT 1 FROM hims.clearance_invalidations i WHERE i.seal_id=s.id) ON CONFLICT(seal_id) DO NOTHING;
END $$;

-- The old trigger functions remain unchanged and continue protecting every version 1 fact.
DROP TRIGGER room_vacation_physical_guard ON hims.room_vacations;
CREATE TRIGGER room_vacation_physical_guard BEFORE INSERT ON hims.room_vacations FOR EACH ROW WHEN(NEW.mvp_readiness_id IS NULL) EXECUTE FUNCTION hims.guard_physical_discharge();
DROP TRIGGER departure_physical_guard ON hims.departures;
CREATE TRIGGER departure_physical_guard BEFORE INSERT ON hims.departures FOR EACH ROW WHEN(NEW.mvp_finance_id IS NULL) EXECUTE FUNCTION hims.guard_physical_discharge();
CREATE FUNCTION hims.guard_mvp_physical() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; st hims.effective_room_stays; ev hims.mvp_events; v hims.effective_room_vacations; approval uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF TG_TABLE_NAME='clearance_seals' THEN IF e.workflow_version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy professional seals cannot impersonate external MVP authority'; END IF;RETURN NEW;END IF;
 IF e.workflow_version=1 THEN
  IF TG_TABLE_NAME='room_vacations' THEN IF NEW.nursing_seal_id IS NULL OR NEW.mvp_readiness_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy Nursing source required'; END IF;
  ELSE IF NEW.bill_seal_id IS NULL OR NEW.mvp_finance_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy Billing source required'; END IF;END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO st FROM hims.effective_room_stays WHERE id=NEW.stay_id;
 IF e.status<>'ADMITTED' OR st.admission_id IS DISTINCT FROM e.id OR st.ended_at IS NULL OR NOT hims.mvp_assigned(e.id,NEW.signed_by) OR NOT EXISTS(SELECT 1 FROM hims.bed_holds WHERE admission_id=e.id AND bed_id=st.bed_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse and held closed actual stay required'; END IF;
 IF TG_TABLE_NAME='room_vacations' THEN
  approval=hims.mvp_current(e.id,'NURSING');SELECT * INTO ev FROM hims.mvp_events WHERE id=approval;
  IF NEW.nursing_seal_id IS NOT NULL OR NEW.mvp_readiness_id IS DISTINCT FROM approval OR approval IS NULL OR NEW.vacated_at IS DISTINCT FROM st.ended_at OR NEW.vacated_at IS DISTINCT FROM st.last_reconciled_at OR NEW.vacated_at<ev.recorded_at OR NEW.vacated_at>clock_timestamp() OR NEW.signed_at<NEW.vacated_at
   OR NOT EXISTS(SELECT 1 FROM hims.nursing_shifts n WHERE n.id=NEW.shift_id AND n.admission_id=e.id AND n.nurse_id=NEW.signed_by AND n.started_at<=NEW.vacated_at AND NOT EXISTS(SELECT 1 FROM hims.effective_shift_ends x WHERE x.shift_id=n.id AND x.ended_at<NEW.vacated_at))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual vacancy must retain current Nursing readiness and same-nurse attendance'; END IF;
 ELSE
  approval=hims.mvp_current(e.id,'finance');SELECT * INTO ev FROM hims.mvp_events WHERE id=approval;SELECT * INTO v FROM hims.effective_room_vacations WHERE admission_id=e.id;
  IF NEW.bill_seal_id IS NOT NULL OR approval IS NULL OR NEW.mvp_finance_id IS DISTINCT FROM approval OR NEW.bill_version IS DISTINCT FROM e.bill_revision OR ev.bill_version IS DISTINCT FROM e.bill_revision OR NEW.departed_at<ev.recorded_at OR NEW.departed_at<v.vacated_at OR v.stay_id IS DISTINCT FROM st.id OR NEW.departed_at>clock_timestamp() OR NEW.signed_at<NEW.departed_at
   OR NOT EXISTS(SELECT 1 FROM hims.mvp_events d WHERE d.admission_id=e.id AND d.action='deliver' AND d.payload->>'kind'='FINAL' AND (d.payload->>'financeId')::uuid=approval AND (d.payload->>'deliveredAt')::timestamptz<=NEW.departed_at)
   OR NOT EXISTS(SELECT 1 FROM hims.nursing_shifts n WHERE n.admission_id=e.id AND n.nurse_id=NEW.signed_by AND n.started_at<=NEW.departed_at AND NOT EXISTS(SELECT 1 FROM hims.effective_shift_ends x WHERE x.shift_id=n.id AND x.ended_at<NEW.departed_at))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual assigned-Nurse exit requires current finance and prior exact paper delivery'; END IF;
  PERFORM hims.mvp_finance_guard(e.id,ev.payload);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_physical_vacancy BEFORE INSERT ON hims.room_vacations FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_physical();
CREATE TRIGGER mvp_physical_departure BEFORE INSERT ON hims.departures FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_physical();
CREATE TRIGGER mvp_legacy_seal BEFORE INSERT ON hims.clearance_seals FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_physical();

DROP TRIGGER discharge_document_source ON hims.discharge_documents;
CREATE TRIGGER discharge_document_source BEFORE INSERT ON hims.discharge_documents FOR EACH ROW WHEN(NEW.schema_version=1) EXECUTE FUNCTION hims.guard_discharge_document();
CREATE FUNCTION hims.guard_mvp_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; actor hims.staff_user; prior hims.discharge_documents; clinical uuid; finance uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);SELECT * INTO actor FROM hims.staff_user WHERE id=NEW.created_by FOR SHARE;SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF NEW.schema_version=1 THEN IF e.workflow_version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MVP documents require explicit provenance schema';END IF;RETURN NEW;END IF;
 IF e.workflow_version<>2 OR actor.id IS NULL OR coalesce(actor.banned,false) OR NOT(actor.role IN ('ADMIN','BILLING') OR hims.mvp_assigned(e.id,actor.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current authorized document staff required';END IF;
 clinical=hims.mvp_current(e.id,'doctor-approval');finance=hims.mvp_current(e.id,'finance');
 IF e.status='DISCHARGED' THEN SELECT mvp_finance_id INTO finance FROM hims.departures WHERE admission_id=e.id;SELECT clinical_id INTO clinical FROM hims.mvp_events WHERE id=finance; END IF;
 SELECT * INTO prior FROM hims.discharge_documents WHERE admission_id=e.id ORDER BY version DESC LIMIT 1;
 IF clinical IS NULL OR (NEW.kind='FINAL' AND finance IS NULL) OR (NEW.snapshot->'clinical'->>'id')::uuid IS DISTINCT FROM clinical OR (NEW.kind='FINAL' AND (NEW.snapshot->'finance'->>'id')::uuid IS DISTINCT FROM finance)
 OR NEW.version<>coalesce(prior.version,0)+1 OR NEW.replaces_document_id IS DISTINCT FROM prior.id OR (NEW.snapshot->>'schemaVersion')::integer IS DISTINCT FROM 2 OR NEW.snapshot->>'kind' IS DISTINCT FROM NEW.kind
 OR (NEW.snapshot->'admission'->>'id')::uuid IS DISTINCT FROM e.id OR (NEW.snapshot->>'documentId')::uuid IS DISTINCT FROM NEW.id OR (NEW.snapshot->>'version')::integer IS DISTINCT FROM NEW.version OR NEW.snapshot->>'sourceHash' IS DISTINCT FROM NEW.source_hash OR (NEW.snapshot->>'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact immutable authorized MVP paper sources required'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_document_source BEFORE INSERT ON hims.discharge_documents FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_document();

CREATE FUNCTION hims.guard_mvp_medicine() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; c hims.charges; original hims.mvp_medicine_sources; prior numeric; credited numeric; expected numeric; actual numeric;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version<>2 OR e.status<>'ADMITTED' OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.recorded_by AND role='PHARMACY' AND NOT coalesce(banned,false)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Pharmacy actor and active MVP admission required'; END IF;
 SELECT * INTO c FROM hims.charges WHERE id=NEW.charge_id;
 IF c.admission_id IS DISTINCT FROM e.id OR c.category<>'medicine' OR length(split_part(NEW.quantity,'.',2))>NEW.quantity_scale THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact original patient medicine charge required'; END IF;
 IF NEW.kind='CHARGE' THEN
    IF NEW.original_id IS NOT NULL OR NEW.reversal_id IS NOT NULL OR c.source_event_id IS DISTINCT FROM NEW.id::text OR c.quantity IS DISTINCT FROM NEW.quantity OR c.actor_id IS DISTINCT FROM NEW.recorded_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Medicine charge must bind its unique source'; END IF;
 ELSE
  SELECT * INTO original FROM hims.mvp_medicine_sources WHERE id=NEW.original_id;
  SELECT coalesce(sum(quantity::numeric),0) INTO prior FROM hims.mvp_medicine_sources WHERE original_id=original.id;
  SELECT coalesce(sum(r.amount_paise),0) INTO credited FROM hims.mvp_medicine_sources m JOIN hims.charge_reversals r ON r.id=m.reversal_id WHERE m.original_id=original.id;
  expected=least(c.amount_paise,round(c.rate_paise*(prior+NEW.quantity::numeric)))-credited;
  SELECT amount_paise INTO actual FROM hims.charge_reversals WHERE id=NEW.reversal_id AND charge_id=c.id;
  IF original.kind IS DISTINCT FROM 'CHARGE' OR original.admission_id IS DISTINCT FROM e.id OR original.charge_id IS DISTINCT FROM c.id OR prior+NEW.quantity::numeric>original.quantity::numeric OR NEW.quantity_scale IS DISTINCT FROM original.quantity_scale OR expected<0 OR (expected>0 AND actual IS DISTINCT FROM expected) OR (expected=0 AND NEW.reversal_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Accepted return exceeds original quantity or exact original-price credit'; END IF;
 END IF;
 PERFORM hims.invalidate_clearances(e.id,'PHARMACY','mvp_medicine',jsonb_build_array(NEW.id));RETURN NEW;
END $$;
CREATE TRIGGER mvp_medicine_source BEFORE INSERT ON hims.mvp_medicine_sources FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_medicine();
CREATE FUNCTION hims.guard_mvp_closed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; f hims.mvp_events; accepted numeric; received numeric;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version<>2 OR e.status<>'DISCHARGED' THEN RETURN NEW;END IF;
 SELECT ev.* INTO f FROM hims.departures d JOIN hims.mvp_events ev ON ev.id=d.mvp_finance_id WHERE d.admission_id=e.id;
 accepted=(f.payload->'financial'->'responsibility'->>'insurerPaise')::numeric;
 SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)),0) INTO received FROM hims.receipts r WHERE r.admission_id=e.id AND r.party='INSURER';
 IF NEW.party<>'INSURER' OR NEW.kind<>'PAYMENT' OR NEW.evidence_id IS NULL OR f.id IS NULL OR accepted IS NULL OR received>accepted
 OR NOT EXISTS(SELECT 1 FROM hims.mvp_receivable_receipts b JOIN hims.staff_user u ON u.id=b.recorded_by WHERE b.receipt_id=NEW.id AND b.admission_id=e.id AND b.finance_id=f.id AND b.recorded_by=NEW.actor_id AND u.role IN ('ADMIN','BILLING') AND NOT coalesce(u.banned,false))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed insurer receipt requires original accepted receivable and exact current Billing binding';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mvp_closed_receipt AFTER INSERT ON hims.receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_closed_receipt();
CREATE FUNCTION hims.guard_mvp_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.workflow_version IS DISTINCT FROM OLD.workflow_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Episode workflow cannot be silently reinterpreted';END IF;RETURN NEW;END $$;
CREATE TRIGGER mvp_episode_version BEFORE UPDATE OF workflow_version ON hims.admissions FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_version();
