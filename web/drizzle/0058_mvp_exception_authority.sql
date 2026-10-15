-- External clinical authority is recorded by a Nurse; no historical Doctor seal is fabricated.
CREATE TABLE hims.mvp_exception_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admission_id uuid NOT NULL REFERENCES hims.admissions(id),
 action text NOT NULL CHECK(action IN ('CLINICAL','AUTHORITY','FOLLOWUP','VACANCY','DELIVERY')),type text NOT NULL,
 source_id uuid,payload jsonb NOT NULL,bill_version integer NOT NULL,recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mvp_exception_episode ON hims.mvp_exception_events(admission_id,recorded_at);
ALTER TABLE hims.mvp_receivable_receipts ALTER COLUMN finance_id DROP NOT NULL;
ALTER TABLE hims.mvp_receivable_receipts ADD COLUMN exception_authority_id uuid REFERENCES hims.mvp_exception_events(id);
ALTER TABLE hims.mvp_receivable_receipts ADD COLUMN allocation_amendment_id uuid REFERENCES hims.post_discharge_amendments(id);
ALTER TABLE hims.mvp_receivable_receipts ADD CONSTRAINT mvp_receivable_original_authority CHECK((finance_id IS NULL)<>(exception_authority_id IS NULL));
CREATE TABLE hims.mvp_exceptional_departures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admission_id uuid NOT NULL UNIQUE REFERENCES hims.admissions(id),
 authority_id uuid NOT NULL REFERENCES hims.mvp_exception_events(id),clinical_id uuid NOT NULL REFERENCES hims.mvp_exception_events(id),stay_id uuid NOT NULL REFERENCES hims.room_stays(id),shift_id uuid NOT NULL REFERENCES hims.nursing_shifts(id),
 departed_at timestamptz NOT NULL,snapshot jsonb NOT NULL,recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hims.mvp_room_returns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admission_id uuid NOT NULL REFERENCES hims.admissions(id),vacation_id uuid NOT NULL UNIQUE REFERENCES hims.room_vacations(id),
 authority_id uuid NOT NULL REFERENCES hims.mvp_exception_events(id),clinical_id uuid NOT NULL REFERENCES hims.mvp_exception_events(id),stay_id uuid NOT NULL UNIQUE REFERENCES hims.room_stays(id),shift_id uuid NOT NULL REFERENCES hims.nursing_shifts(id),
 returned_at timestamptz NOT NULL,handover text NOT NULL,recorded_by text NOT NULL REFERENCES hims.staff_user(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE hims.room_vacations ADD COLUMN mvp_exception_id uuid REFERENCES hims.mvp_exception_events(id);
CREATE OR REPLACE VIEW hims.effective_room_vacations AS SELECT v.* FROM hims.effective_vacation_facts v
 WHERE NOT EXISTS(SELECT 1 FROM hims.room_returns r WHERE r.vacation_id=v.id) AND NOT EXISTS(SELECT 1 FROM hims.mvp_room_returns r WHERE r.vacation_id=v.id);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['mvp_exception_events','mvp_exceptional_departures','mvp_room_returns'] LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history()',t||'_immutable',t);END LOOP;END $$;
-- Match the server's economicBasis byte-for-byte; no extension or patient text enters this hash.
CREATE FUNCTION hims.mvp_economic_basis(episode uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to('{"charges":['||
  coalesce((SELECT string_agg('{"id":'||to_json(c.id)::text||',"source":'||to_json(c.source_event_id)::text||',"status":'||to_json(CASE WHEN c.initial_status='FINAL' OR EXISTS(SELECT 1 FROM hims.charge_finalizations f WHERE f.charge_id=c.id) THEN 'FINAL' ELSE 'PENDING' END)::text||',"amount":'||to_json(c.amount_paise::text)::text||',"tariff":'||to_json(c.tariff_version_id)::text||'}',',' ORDER BY c.created_at,c.id) FROM hims.charges c WHERE c.admission_id=episode),'')||
  '],"reversals":['||coalesce((SELECT string_agg('{"id":'||to_json(r.id)::text||',"chargeId":'||to_json(r.charge_id)::text||',"amount":'||to_json(r.amount_paise::text)::text||'}',',' ORDER BY r.id) FROM hims.charge_reversals r JOIN hims.charges c ON c.id=r.charge_id WHERE c.admission_id=episode),'')||']}', 'UTF8')),'hex')
$$;
-- Independently derive the same verified allocation and cash facts used by the server projection.
CREATE FUNCTION hims.mvp_current_responsibility(episode uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE e hims.admissions; c hims.insurance_cases; d hims.insurance_decisions; p hims.insurance_events; conv hims.insurance_conversions; review hims.self_pay_reviews;
 basis text; current_basis text; current_net numeric; net numeric; eligible numeric; insurer numeric; patient numeric; unallocated numeric=0; copay numeric=0; nonpayable numeric=0;
 patient_cash numeric; insurer_cash numeric; patient_applied numeric; stale boolean=false; complete boolean=false; known boolean=false; responsibility jsonb;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=episode;
 basis=hims.mvp_economic_basis(episode);
 SELECT coalesce(sum(ch.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0)),0) INTO net FROM hims.charges ch WHERE ch.admission_id=episode AND (ch.initial_status='FINAL' OR EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=ch.id));
 SELECT * INTO c FROM hims.insurance_cases WHERE admission_id=episode;
 SELECT * INTO d FROM hims.insurance_decisions WHERE case_id=c.id ORDER BY case_version DESC LIMIT 1;
 SELECT * INTO p FROM hims.insurance_events WHERE case_id=c.id AND kind='POLICY' ORDER BY case_version DESC LIMIT 1;
 SELECT * INTO conv FROM hims.insurance_conversions WHERE case_id=c.id;
 SELECT * INTO review FROM hims.self_pay_reviews WHERE admission_id=episode ORDER BY created_at DESC,id DESC LIMIT 1;
 current_basis=coalesce(conv.allocation->>'billBasis',d.allocation->>'billBasis');current_net=coalesce((conv.allocation->>'netBillPaise')::numeric,(d.allocation->>'netBillPaise')::numeric);
 IF e.payment_route='SELF_PAY' THEN
  known=true;insurer=0;patient=net;
  IF conv.id IS NOT NULL THEN
   IF review.id IS NOT NULL THEN insurer=review.insurer_paise;patient=review.patient_paise;current_basis=review.bill_basis;current_net=review.net_paise;
   ELSE insurer=(conv.allocation->>'retainedInsurerLiabilityPaise')::numeric;patient=(conv.allocation->>'verifiedPatientLiabilityPaise')::numeric;END IF;
  END IF;
 ELSIF d.id IS NOT NULL THEN
  known=true;eligible=(d.allocation->>'eligibleBillPaise')::numeric;copay=floor((eligible*d.co_pay_bps+5000)/10000);nonpayable=(d.allocation->>'netBillPaise')::numeric-eligible;
  insurer=least(d.approved_paise,eligible-copay);patient=coalesce((d.allocation->>'verifiedPatientLiabilityPaise')::numeric,copay+nonpayable);unallocated=(d.allocation->>'netBillPaise')::numeric-insurer-patient;
 END IF;
 IF conv.id IS NOT NULL OR d.id IS NOT NULL THEN stale=current_basis IS DISTINCT FROM basis OR current_net IS DISTINCT FROM net OR (e.payment_route='INSURED' AND p.id IS DISTINCT FROM d.policy_event_id);END IF;
 SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)) FILTER(WHERE r.party='PATIENT'),0),coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)) FILTER(WHERE r.party='INSURER'),0),coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)) FILTER(WHERE r.party='PATIENT' AND r.kind='PAYMENT'),0) INTO patient_cash,insurer_cash,patient_applied FROM hims.receipts r WHERE r.admission_id=episode;
 SELECT patient_applied+coalesce(sum(a.amount_paise),0) INTO patient_applied FROM hims.receipt_allocations a JOIN hims.receipts r ON r.id=a.receipt_id WHERE r.admission_id=episode AND NOT EXISTS(SELECT 1 FROM hims.allocation_cancellations x WHERE x.allocation_id=a.id);
 complete=known AND NOT stale AND unallocated=0 AND (e.payment_route='SELF_PAY' OR d.status<>'PENDING');
 IF known THEN responsibility=jsonb_build_object('insurerPaise',insurer::text,'patientPaise',patient::text,'unallocatedPaise',unallocated::text,'coPayPaise',copay::text,'nonPayablePaise',nonpayable::text,'stale',stale,'allocationComplete',complete,'insurerOutstandingPaise',greatest(insurer-insurer_cash,0)::text,'patientOutstandingPaise',greatest(patient-patient_applied,0)::text,'insurerExcessPaise',greatest(insurer_cash-insurer,0)::text,'patientExcessPaise',greatest(patient_cash-patient,0)::text);END IF;
 RETURN jsonb_build_object('responsibility',responsibility,'caseId',c.id,'reviewRevision',c.review_revision,'policyId',p.id,'decisionId',d.id,'conversionId',conv.id,'selfPayReviewId',review.id,'insurerAuthorizedPaise',coalesce(d.approved_paise,0)::text);
END $$;
CREATE FUNCTION hims.guard_mvp_exception() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; actor hims.staff_user; source hims.mvp_exception_events; clinical hims.mvp_exception_events; doc hims.discharge_documents; expected text; net numeric; patient_cash numeric; insurer_cash numeric; refunded numeric; financial jsonb; key text; obligations jsonb='[]'::jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);SELECT * INTO actor FROM hims.staff_user WHERE id=NEW.recorded_by FOR SHARE;SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version IS DISTINCT FROM 2 OR actor.id IS NULL OR coalesce(actor.banned,false) OR NEW.bill_version<>e.bill_revision OR NEW.recorded_at>clock_timestamp() OR (NEW.action<>'FOLLOWUP' AND e.status<>'ADMITTED') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current source-bound MVP exception actor and bill required';END IF;
 IF NEW.action IN ('CLINICAL','VACANCY') AND NOT hims.mvp_assigned(e.id,actor.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse records external clinical authority and factual vacancy'; END IF;
 IF NEW.action IN ('AUTHORITY','FOLLOWUP') AND actor.role<>'ADMIN' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Admin exception authority required';END IF;
 IF NEW.action='DELIVERY' AND NOT(actor.role='ADMIN' OR hims.mvp_assigned(e.id,actor.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse or Admin delivers authorized papers';END IF;
 SELECT * INTO source FROM hims.mvp_exception_events WHERE id=NEW.source_id;
 IF NEW.action='CLINICAL' THEN
  IF NEW.type NOT IN ('PLANNED_EXIT','AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH','RETURN_TO_BED','RETURN_CANCELLED') OR length(btrim(coalesce(NEW.payload->>'authorizerName','')))<3 OR length(btrim(coalesce(NEW.payload->>'evidence','')))<3 OR NEW.payload->>'sourceTime' IS NULL OR (NEW.payload->>'sourceTime')::timestamptz<e.admitted_at OR (NEW.payload->>'sourceTime')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Named external clinical authorizer, source evidence and actual source time required';END IF;
  IF NEW.type='RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM hims.effective_room_vacations v WHERE v.id=NEW.source_id AND v.admission_id=e.id AND v.vacated_at<=(NEW.payload->>'sourceTime')::timestamptz) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Return instruction binds the current actual vacancy';END IF;
  IF NEW.type='RETURN_CANCELLED' AND (source.action IS DISTINCT FROM 'CLINICAL' OR source.type IS DISTINCT FROM 'RETURN_TO_BED' OR source.admission_id IS DISTINCT FROM e.id OR (NEW.payload->>'sourceTime')::timestamptz<(source.payload->>'sourceTime')::timestamptz) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='External reconsideration binds the original return instruction';END IF;
  IF NEW.type='RETURN_TO_BED' AND EXISTS(SELECT 1 FROM hims.mvp_exception_events p WHERE p.admission_id=e.id AND p.action='CLINICAL' AND p.type='RETURN_TO_BED' AND p.source_id=NEW.source_id AND NOT EXISTS(SELECT 1 FROM hims.mvp_exception_events c WHERE c.action='CLINICAL' AND c.type='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.mvp_room_returns r WHERE r.clinical_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='One unperformed return instruction per current vacancy';END IF;
  IF NEW.type='RETURN_CANCELLED' AND (EXISTS(SELECT 1 FROM hims.mvp_room_returns WHERE clinical_id=source.id) OR EXISTS(SELECT 1 FROM hims.mvp_exception_events WHERE action='CLINICAL' AND type='RETURN_CANCELLED' AND source_id=source.id) OR NOT EXISTS(SELECT 1 FROM hims.effective_room_vacations WHERE id=source.source_id AND admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only current unperformed and uncancelled return authority may be reconsidered';END IF;
 ELSIF NEW.action='AUTHORITY' THEN
  expected=CASE WHEN NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') THEN 'PLANNED_EXIT' ELSE NEW.type END;
  IF NEW.type NOT IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL','AGAINST_ADVICE','EXTERNAL_TRANSFER','DEATH','RETURN_TO_BED') OR source.action IS DISTINCT FROM 'CLINICAL' OR source.type IS DISTINCT FROM expected OR source.admission_id IS DISTINCT FROM e.id OR source.id IS DISTINCT FROM (SELECT id FROM hims.mvp_exception_events WHERE admission_id=e.id AND action='CLINICAL' ORDER BY recorded_at DESC,id DESC LIMIT 1)
   OR length(btrim(coalesce(NEW.payload->>'authority','')))<3 OR length(btrim(coalesce(NEW.payload->>'reason','')))<3 OR length(btrim(coalesce(NEW.payload->>'evidence','')))<3
   OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.payload->>'followUpOwnerId' AND NOT coalesce(banned,false))
   OR (NEW.payload->'bill'->>'revision')::integer IS DISTINCT FROM e.bill_revision
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Explicit accountable Admin authority preserves exact clinical source, money and follow-up obligations';END IF;
  IF NEW.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND EXISTS(SELECT 1 FROM hims.mvp_exception_events p WHERE p.admission_id=e.id AND p.action='CLINICAL' AND p.type='RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM hims.mvp_exception_events c WHERE c.action='CLINICAL' AND c.type='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.mvp_room_returns r WHERE r.clinical_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Planned exception requires actual return or source-bound reconsideration';END IF;
  SELECT coalesce(sum(ch.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0)),0) INTO net FROM hims.charges ch WHERE ch.admission_id=e.id AND (ch.initial_status='FINAL' OR EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=ch.id));
  SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)) FILTER(WHERE r.party='PATIENT'),0),coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)) FILTER(WHERE r.party='INSURER'),0) INTO patient_cash,insurer_cash FROM hims.receipts r WHERE r.admission_id=e.id;
  SELECT coalesce(sum(amount_paise),0) INTO refunded FROM hims.receipt_refunds WHERE admission_id=e.id;
  IF (NEW.payload->'bill'->>'netPaise')::numeric IS DISTINCT FROM net OR (NEW.payload->'bill'->>'patientCashPaise')::numeric IS DISTINCT FROM patient_cash OR (NEW.payload->'bill'->>'insurerCashPaise')::numeric IS DISTINCT FROM insurer_cash OR (NEW.payload->'bill'->>'refundedPaise')::numeric IS DISTINCT FROM refunded THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exception authority cannot erase or replace actual ledger amounts';END IF;
  financial=hims.mvp_current_responsibility(e.id);
  FOREACH key IN ARRAY ARRAY['responsibility','caseId','reviewRevision','policyId','decisionId','conversionId','selfPayReviewId','insurerAuthorizedPaise'] LOOP
   IF coalesce(NEW.payload->'financial'->key,'null'::jsonb) IS DISTINCT FROM financial->key THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exception authority must retain the current verified party allocation and exact source';END IF;
  END LOOP;
  IF (financial->'responsibility'->>'allocationComplete')::boolean IS DISTINCT FROM true THEN obligations=obligations||jsonb_build_array('Party responsibility is unresolved or stale; explicit allocation review remains required');END IF;
  IF (financial->'responsibility'->>'patientOutstandingPaise')::numeric>0 THEN obligations=obligations||jsonb_build_array('Patient outstanding paise: '||(financial->'responsibility'->>'patientOutstandingPaise'));END IF;
  IF (financial->'responsibility'->>'insurerOutstandingPaise')::numeric>0 THEN obligations=obligations||jsonb_build_array('Accepted insurer receivable paise: '||(financial->'responsibility'->>'insurerOutstandingPaise'));END IF;
  IF (financial->'responsibility'->>'patientExcessPaise')::numeric>0 OR (financial->'responsibility'->>'insurerExcessPaise')::numeric>0 THEN obligations=obligations||jsonb_build_array('Excess retained cash requires explicit disposition');END IF;
  IF (SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)),0) FROM hims.receipts r WHERE r.admission_id=e.id AND r.kind<>'PAYMENT')>(SELECT coalesce(sum(a.amount_paise),0) FROM hims.receipt_allocations a JOIN hims.receipts r ON r.id=a.receipt_id WHERE r.admission_id=e.id AND NOT EXISTS(SELECT 1 FROM hims.allocation_cancellations x WHERE x.allocation_id=a.id)) THEN obligations=obligations||jsonb_build_array('Unallocated retained deposit requires explicit disposition');END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.effective_room_vacations WHERE admission_id=e.id) THEN obligations=obligations||jsonb_build_array('Actual room vacancy and final room-charge cutoff remain outstanding');END IF;
  FOREACH key IN ARRAY ARRAY['doctor-approval','checklist','NURSING','PHARMACY','INSURANCE','DIAGNOSTICS','finance'] LOOP
   IF hims.mvp_current(e.id,key) IS NULL THEN obligations=obligations||jsonb_build_array('Ordinary approval remains absent: '||key);END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM hims.charges ch WHERE ch.admission_id=e.id AND ch.initial_status='PENDING' AND NOT EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=ch.id) AND ch.amount_paise>coalesce((SELECT sum(amount_paise) FROM hims.charge_reversals WHERE charge_id=ch.id),0)) THEN obligations=obligations||jsonb_build_array('Pending charge sources require reconciliation');END IF;
  IF EXISTS(SELECT 1 FROM hims.transfer_insurance_tasks t WHERE t.admission_id=e.id AND NOT EXISTS(SELECT 1 FROM hims.insurance_transfer_resolutions r WHERE r.task_id=t.id)) THEN obligations=obligations||jsonb_build_array('Transfer insurance responsibility remains unresolved');END IF;
  NEW.payload=jsonb_set(NEW.payload,'{outstandingObligations}',obligations);
  IF NEW.type IN ('INSURANCE_DELAY','INSURANCE_DENIAL') AND (e.payment_route<>'INSURED' OR NOT EXISTS(SELECT 1 FROM hims.insurance_cases WHERE id=(NEW.payload->>'sourceId')::uuid AND admission_id=e.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact external insurance case required';END IF;
  IF NEW.type='INSURANCE_DENIAL' AND (SELECT status FROM hims.insurance_decisions WHERE case_id=(NEW.payload->>'sourceId')::uuid ORDER BY case_version DESC LIMIT 1) IS DISTINCT FROM 'REJECTED' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual current external denial required';END IF;
 ELSIF NEW.action='FOLLOWUP' THEN
  IF source.action IS DISTINCT FROM 'AUTHORITY' OR source.admission_id IS DISTINCT FROM e.id OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.payload->>'ownerId' AND NOT coalesce(banned,false)) OR length(btrim(coalesce(NEW.payload->>'note','')))<3 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original exception and named follow-up owner required';END IF;
 ELSIF NEW.action='VACANCY' THEN
  IF source.action IS DISTINCT FROM 'CLINICAL' OR source.admission_id IS DISTINCT FROM e.id OR source.type IN ('RETURN_TO_BED','RETURN_CANCELLED') OR NEW.payload->>'vacatedAt' IS NULL OR NEW.payload->>'stayId' IS NULL OR NEW.payload->>'shiftId' IS NULL OR length(btrim(coalesce(NEW.payload->>'waitingLocation','')))<3 OR length(btrim(coalesce(NEW.payload->>'handover','')))<3 OR (NEW.payload->>'vacatedAt')::timestamptz<e.admitted_at OR (NEW.payload->>'vacatedAt')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='External exit disposition and factual Nurse vacancy required';END IF;
 ELSIF NEW.action='DELIVERY' THEN
  SELECT * INTO doc FROM hims.discharge_documents WHERE id=(NEW.payload->>'documentId')::uuid;
  IF source.action IS DISTINCT FROM 'AUTHORITY' OR source.admission_id IS DISTINCT FROM e.id OR source.bill_version IS DISTINCT FROM e.bill_revision OR doc.admission_id IS DISTINCT FROM e.id OR doc.schema_version<>2 OR doc.kind<>'FINAL' OR (doc.snapshot->'exception'->>'id')::uuid IS DISTINCT FROM source.id OR doc.hash IS DISTINCT FROM NEW.payload->>'documentHash' OR NEW.payload->>'deliveredAt' IS NULL OR (NEW.payload->>'deliveredAt')::timestamptz<doc.created_at OR (NEW.payload->>'deliveredAt')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact current exceptional paper version and actual delivery required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_exception_source BEFORE INSERT ON hims.mvp_exception_events FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_exception();
CREATE FUNCTION hims.invalidate_mvp_exception() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='CLINICAL' THEN INSERT INTO hims.mvp_invalidations(event_id,kind,source_id) SELECT id,'external-disposition',NEW.id::text FROM hims.mvp_events WHERE admission_id=NEW.admission_id AND action IN ('doctor-approval','checklist','check','n-a','finance') ON CONFLICT(event_id) DO NOTHING;END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_exception_invalidation AFTER INSERT ON hims.mvp_exception_events FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_exception();

DROP TRIGGER room_vacation_physical_guard ON hims.room_vacations;
CREATE TRIGGER room_vacation_physical_guard BEFORE INSERT ON hims.room_vacations FOR EACH ROW WHEN(NEW.mvp_readiness_id IS NULL AND NEW.mvp_exception_id IS NULL) EXECUTE FUNCTION hims.guard_physical_discharge();
DROP TRIGGER mvp_physical_vacancy ON hims.room_vacations;
CREATE TRIGGER mvp_physical_vacancy BEFORE INSERT ON hims.room_vacations FOR EACH ROW WHEN(NEW.mvp_exception_id IS NULL) EXECUTE FUNCTION hims.guard_mvp_physical();
CREATE FUNCTION hims.guard_mvp_exception_physical() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; witness hims.mvp_exception_events; authority hims.mvp_exception_events; clinical hims.mvp_exception_events; st hims.effective_room_stays; v hims.effective_room_vacations; moment timestamptz;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF TG_TABLE_NAME='room_vacations' THEN
  IF NEW.mvp_exception_id IS NULL THEN RETURN NEW;END IF;
  SELECT * INTO witness FROM hims.mvp_exception_events WHERE id=NEW.mvp_exception_id;SELECT * INTO st FROM hims.effective_room_stays WHERE id=NEW.stay_id;
  moment=NEW.vacated_at;
  IF e.workflow_version<>2 OR NEW.nursing_seal_id IS NOT NULL OR NEW.mvp_readiness_id IS NOT NULL OR witness.action IS DISTINCT FROM 'VACANCY' OR witness.admission_id IS DISTINCT FROM e.id OR witness.recorded_by IS DISTINCT FROM NEW.signed_by OR (witness.payload->>'stayId')::uuid IS DISTINCT FROM st.id OR (witness.payload->>'shiftId')::uuid IS DISTINCT FROM NEW.shift_id OR (witness.payload->>'vacatedAt')::timestamptz IS DISTINCT FROM moment OR st.admission_id IS DISTINCT FROM e.id OR st.ended_at IS DISTINCT FROM moment OR st.last_reconciled_at IS DISTINCT FROM moment THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact exceptional physical vacancy source required';END IF;
  IF NOT hims.mvp_assigned(e.id,NEW.signed_by) OR NOT EXISTS(SELECT 1 FROM hims.nursing_shifts s WHERE s.id=NEW.shift_id AND s.admission_id=e.id AND s.nurse_id=NEW.signed_by AND s.started_at<=moment AND NOT EXISTS(SELECT 1 FROM hims.effective_shift_ends x WHERE x.shift_id=s.id AND x.ended_at<moment)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual assigned-Nurse vacancy attendance required';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO authority FROM hims.mvp_exception_events WHERE id=NEW.authority_id;SELECT * INTO clinical FROM hims.mvp_exception_events WHERE id=NEW.clinical_id;SELECT * INTO st FROM hims.effective_room_stays WHERE id=NEW.stay_id;
 IF TG_TABLE_NAME='mvp_room_returns' THEN moment=NEW.returned_at;ELSE moment=NEW.departed_at;END IF;
 IF e.workflow_version<>2 OR e.status<>'ADMITTED' OR NOT hims.mvp_assigned(e.id,NEW.recorded_by) OR authority.action IS DISTINCT FROM 'AUTHORITY' OR clinical.action IS DISTINCT FROM 'CLINICAL' OR authority.source_id IS DISTINCT FROM clinical.id OR authority.admission_id IS DISTINCT FROM e.id OR clinical.admission_id IS DISTINCT FROM e.id OR clinical.id IS DISTINCT FROM (SELECT id FROM hims.mvp_exception_events WHERE admission_id=e.id AND action='CLINICAL' ORDER BY recorded_at DESC,id DESC LIMIT 1) OR st.admission_id IS DISTINCT FROM e.id OR moment<(clinical.payload->>'sourceTime')::timestamptz OR moment>clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM hims.nursing_shifts n WHERE n.id=NEW.shift_id AND n.admission_id=e.id AND n.nurse_id=NEW.recorded_by AND n.started_at<=moment AND NOT EXISTS(SELECT 1 FROM hims.effective_shift_ends x WHERE x.shift_id=n.id AND x.ended_at<moment))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assigned Nurse actual movement needs exact external clinical and Admin authority';END IF;
 PERFORM 1 FROM hims.beds WHERE id=st.bed_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM hims.bed_holds WHERE admission_id=e.id AND bed_id=st.bed_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original bed hold required';END IF;
 IF TG_TABLE_NAME='mvp_room_returns' THEN
  SELECT * INTO v FROM hims.effective_room_vacations WHERE id=NEW.vacation_id;
  IF authority.type<>'RETURN_TO_BED' OR clinical.source_id IS DISTINCT FROM v.id OR v.admission_id IS DISTINCT FROM e.id OR st.started_at IS DISTINCT FROM moment OR st.ended_at IS NOT NULL OR moment<authority.recorded_at OR EXISTS(SELECT 1 FROM hims.mvp_exception_events WHERE action='CLINICAL' AND type='RETURN_CANCELLED' AND source_id=clinical.id)
   OR EXISTS(SELECT 1 FROM hims.effective_bed_turnovers t LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=t.id WHERE t.bed_id=st.bed_id AND (c.id IS NULL OR c.completed_at>moment))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh returned stay requires current original instruction and completed turnover';END IF;
 ELSE
  SELECT * INTO v FROM hims.effective_room_vacations WHERE admission_id=e.id;
  IF authority.type='RETURN_TO_BED' OR authority.bill_version IS DISTINCT FROM e.bill_revision OR v.stay_id IS DISTINCT FROM st.id OR moment<v.vacated_at OR EXISTS(SELECT 1 FROM hims.departures WHERE admission_id=e.id)
   OR (NEW.snapshot->'authority'->>'id')::uuid IS DISTINCT FROM authority.id OR (NEW.snapshot->'bill'->>'revision')::integer IS DISTINCT FROM e.bill_revision
   OR (authority.type IN ('CREDIT','INSURANCE_DELAY','INSURANCE_DENIAL') AND NOT EXISTS(SELECT 1 FROM hims.mvp_exception_events d WHERE d.action='DELIVERY' AND d.source_id=authority.id AND (d.payload->>'deliveredAt')::timestamptz<=moment))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact exceptional obligations, actual vacancy and planned paper delivery required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_exception_vacancy BEFORE INSERT ON hims.room_vacations FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_exception_physical();
CREATE TRIGGER mvp_exception_departure BEFORE INSERT ON hims.mvp_exceptional_departures FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_exception_physical();
CREATE TRIGGER mvp_exception_return BEFORE INSERT ON hims.mvp_room_returns FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_exception_physical();
CREATE FUNCTION hims.invalidate_mvp_return() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO hims.mvp_invalidations(event_id,kind,source_id) SELECT id,'actual-return',NEW.id::text FROM hims.mvp_events WHERE admission_id=NEW.admission_id AND action IN ('doctor-approval','checklist','check','n-a','finance') ON CONFLICT(event_id) DO NOTHING;RETURN NEW;END $$;
CREATE TRIGGER mvp_return_invalidation AFTER INSERT ON hims.mvp_room_returns FOR EACH ROW EXECUTE FUNCTION hims.invalidate_mvp_return();
CREATE FUNCTION hims.guard_mvp_pending_return() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action IN ('doctor-approval','finance') AND EXISTS(SELECT 1 FROM hims.mvp_exception_events p WHERE p.admission_id=NEW.admission_id AND p.action='CLINICAL' AND p.type='RETURN_TO_BED' AND NOT EXISTS(SELECT 1 FROM hims.mvp_exception_events c WHERE c.action='CLINICAL' AND c.type='RETURN_CANCELLED' AND c.source_id=p.id) AND NOT EXISTS(SELECT 1 FROM hims.mvp_room_returns r WHERE r.clinical_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='External return instruction needs actual return or explicit source-bound reconsideration';END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_pending_return BEFORE INSERT ON hims.mvp_events FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_pending_return();

-- Explicit exception paper provenance is separate from ordinary final finance and missing seals.
DROP TRIGGER mvp_document_source ON hims.discharge_documents;
CREATE TRIGGER mvp_document_source BEFORE INSERT ON hims.discharge_documents FOR EACH ROW WHEN(NEW.snapshot->'exception' IS NULL OR NEW.snapshot->'exception'='null'::jsonb) EXECUTE FUNCTION hims.guard_mvp_document();
CREATE FUNCTION hims.guard_mvp_exception_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; authority hims.mvp_exception_events; clinical hims.mvp_exception_events; prior hims.discharge_documents;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;SELECT * INTO authority FROM hims.mvp_exception_events WHERE id=(NEW.snapshot->'exception'->>'id')::uuid;SELECT * INTO clinical FROM hims.mvp_exception_events WHERE id=authority.source_id;
 IF e.workflow_version<>2 OR NEW.schema_version<>2 OR authority.action IS DISTINCT FROM 'AUTHORITY' OR authority.admission_id IS DISTINCT FROM e.id OR clinical.action IS DISTINCT FROM 'CLINICAL' OR (NEW.snapshot->'clinical'->>'id')::uuid IS DISTINCT FROM clinical.id
 OR NOT EXISTS(SELECT 1 FROM hims.staff_user u WHERE u.id=NEW.created_by AND NOT coalesce(u.banned,false) AND (u.role IN ('ADMIN','BILLING') OR hims.mvp_assigned(e.id,u.id)))
 OR (e.status='ADMITTED' AND authority.bill_version<>e.bill_revision) OR (e.status='DISCHARGED' AND NOT EXISTS(SELECT 1 FROM hims.mvp_exceptional_departures d WHERE d.admission_id=e.id AND d.authority_id=authority.id))
 OR (NEW.snapshot->>'documentId')::uuid IS DISTINCT FROM NEW.id OR (NEW.snapshot->>'version')::integer IS DISTINCT FROM NEW.version OR NEW.snapshot->>'sourceHash' IS DISTINCT FROM NEW.source_hash OR NEW.snapshot->>'kind' IS DISTINCT FROM NEW.kind
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact source-bound exceptional paper authority required';END IF;
 SELECT * INTO prior FROM hims.discharge_documents WHERE admission_id=e.id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(prior.version,0)+1 OR NEW.replaces_document_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable document predecessor required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER mvp_exception_document BEFORE INSERT ON hims.discharge_documents FOR EACH ROW WHEN(NEW.snapshot->'exception' IS NOT NULL AND NEW.snapshot->'exception'<>'null'::jsonb) EXECUTE FUNCTION hims.guard_mvp_exception_document();

-- The same cash ledger settles a pinned ordinary or exceptional obligation after exit.
CREATE FUNCTION hims.mvp_delay_allocation_amendment(episode uuid,decision uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT m.id FROM hims.mvp_exceptional_departures departure
 JOIN hims.mvp_exception_events authority ON authority.id=departure.authority_id
 JOIN hims.insurance_cases c ON c.admission_id=departure.admission_id AND c.id=(authority.payload->>'sourceId')::uuid
 JOIN hims.insurance_decisions d ON d.case_id=c.id AND d.id=decision
 JOIN hims.post_discharge_amendments m ON m.admission_id=departure.admission_id AND m.kind='INSURANCE_DECISION' AND m.source_id=c.id AND m.result_id=d.id
 JOIN hims.admin_exceptions a ON a.id=m.exception_id AND a.admission_id=m.admission_id AND a.type='POST_DISCHARGE_CORRECTION' AND a.disposition='AMEND' AND a.correction_kind='INSURANCE_DECISION' AND a.source_id=c.id
 WHERE departure.admission_id=episode AND authority.type='INSURANCE_DELAY' AND (authority.payload->'financial'->'responsibility'->>'allocationComplete')::boolean IS DISTINCT FROM true
 AND d.id=(SELECT id FROM hims.insurance_decisions WHERE case_id=c.id ORDER BY case_version DESC LIMIT 1)
 AND a.signed_at>=departure.departed_at AND m.signed_at>=a.signed_at AND d.recorded_at>=a.signed_at
 ORDER BY m.signed_at DESC,m.id DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION hims.guard_mvp_closed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; f hims.mvp_events; a hims.mvp_exception_events; accepted numeric; received numeric; binding hims.mvp_receivable_receipts; current_financial jsonb; amendment uuid; original_net numeric; all_cash numeric;
BEGIN
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.workflow_version<>2 OR e.status<>'DISCHARGED' THEN RETURN NEW;END IF;
 SELECT * INTO binding FROM hims.mvp_receivable_receipts WHERE receipt_id=NEW.id;
 current_financial=hims.mvp_current_responsibility(e.id);
 IF (current_financial->'responsibility'->>'allocationComplete')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current verified complete party allocation required before receivable collection';END IF;
 SELECT ev.* INTO f FROM hims.departures d JOIN hims.mvp_events ev ON ev.id=d.mvp_finance_id WHERE d.admission_id=e.id;
 IF f.id IS NOT NULL THEN
  IF NEW.party<>'INSURER' OR binding.finance_id IS DISTINCT FROM f.id OR binding.exception_authority_id IS NOT NULL OR binding.allocation_amendment_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original ordinary insurer receivable required';END IF;
  accepted=(f.payload->'financial'->'responsibility'->>'insurerPaise')::numeric;
 ELSE
  SELECT ev.* INTO a FROM hims.mvp_exceptional_departures d JOIN hims.mvp_exception_events ev ON ev.id=d.authority_id WHERE d.admission_id=e.id;
  IF a.id IS NULL OR binding.exception_authority_id IS DISTINCT FROM a.id OR binding.finance_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original exceptional party authority required';END IF;
  IF (a.payload->'financial'->'responsibility'->>'allocationComplete')::boolean IS TRUE THEN
   IF binding.allocation_amendment_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete original responsibility retains its original collection source';END IF;
   accepted=(a.payload->'financial'->'responsibility'->>CASE WHEN NEW.party='PATIENT' THEN 'patientPaise' ELSE 'insurerPaise' END)::numeric;
  ELSE
   amendment=hims.mvp_delay_allocation_amendment(e.id,(current_financial->>'decisionId')::uuid);
   IF a.type<>'INSURANCE_DELAY' OR amendment IS NULL OR binding.allocation_amendment_id IS DISTINCT FROM amendment THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact current Admin-authorized post-exit allocation amendment required';END IF;
   accepted=(current_financial->'responsibility'->>CASE WHEN NEW.party='PATIENT' THEN 'patientPaise' ELSE 'insurerPaise' END)::numeric;
   original_net=(a.payload->'bill'->>'netPaise')::numeric;
   SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)),0) INTO all_cash FROM hims.receipts r WHERE r.admission_id=e.id;
   IF original_net IS NULL OR all_cash>original_net THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Later allocation collection cannot exceed original net after all retained cash';END IF;
  END IF;
 END IF;
 IF accepted IS NULL OR accepted<0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original retained party responsibility is required';END IF;
 accepted=least(accepted,(current_financial->'responsibility'->>CASE WHEN NEW.party='PATIENT' THEN 'patientPaise' ELSE 'insurerPaise' END)::numeric);
 SELECT coalesce(sum(r.amount_paise-coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds x WHERE x.receipt_id=r.id),0)),0) INTO received FROM hims.receipts r WHERE r.admission_id=e.id AND r.party=NEW.party;
 IF NEW.kind<>'PAYMENT' OR NEW.evidence_id IS NULL OR accepted IS NULL OR received>accepted OR binding.admission_id IS DISTINCT FROM e.id OR binding.recorded_by IS DISTINCT FROM NEW.actor_id
 OR NOT EXISTS(SELECT 1 FROM hims.staff_user u WHERE u.id=binding.recorded_by AND u.role IN ('ADMIN','BILLING') AND NOT coalesce(u.banned,false))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual post-exit receipt must settle only its original party obligation with current Billing evidence';END IF;RETURN NEW;
END $$;

-- A NULL login Doctor on an MVP episode must never bypass old professional-authority guards.
CREATE FUNCTION hims.guard_legacy_clinical_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb=to_jsonb(NEW); episode uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 episode=(r->>'admission_id')::uuid;
 IF episode IS NULL THEN
  IF r ? 'order_id' THEN SELECT admission_id INTO episode FROM hims.clinical_orders WHERE id=(r->>'order_id')::uuid;
  ELSIF r ? 'note_id' THEN SELECT admission_id INTO episode FROM hims.clinical_rounds WHERE id=(r->>'note_id')::uuid;
  ELSIF r ? 'report_id' THEN SELECT admission_id INTO episode FROM hims.lab_reports WHERE id=(r->>'report_id')::uuid;
  ELSIF r ? 'transfer_order_id' THEN SELECT admission_id INTO episode FROM hims.transfer_orders WHERE id=(r->>'transfer_order_id')::uuid;
  END IF;
 END IF;
 IF episode IS NOT NULL THEN
  PERFORM 1 FROM hims.admissions WHERE id=episode FOR UPDATE;
  IF EXISTS(SELECT 1 FROM hims.admissions WHERE id=episode AND workflow_version<>1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy chart, Doctor-login and native department sources require a version 1 episode';END IF;
 END IF;RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['clinical_rounds','clinical_addenda','clinical_orders','clinical_task_events','clinical_summaries','care_tasks','care_occurrences','care_billing_events','nursing_observations','medication_administrations','nursing_consumables','nursing_addenda','lab_samples','lab_processing','lab_reports','lab_report_addenda','lab_dispositions','pharmacy_movements','pharmacy_preparations','exception_evidence','transfer_orders','transfer_order_cancellations'] LOOP
  EXECUTE format('CREATE TRIGGER aa_mvp_legacy_workflow BEFORE INSERT ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.guard_legacy_clinical_workflow()',t);
 END LOOP;
END $$;
