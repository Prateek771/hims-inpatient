-- Correct stored-paise validation and preserve source-bound recovery of an actual move before a later withdrawal.
-- 0054 was applied to synthetic fixtures and remains literal immutable.
CREATE OR REPLACE FUNCTION hims.guard_final_financial_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
   unit_ms=CASE WHEN policy->>'basis'='hour' THEN 3600000 ELSE 86400000 END; rate=(policy->>'amount')::numeric;
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
    IF NOT EXISTS(SELECT 1 FROM (SELECT signed_at FROM hims.departures WHERE admission_id=e.id UNION ALL SELECT signed_at FROM hims.exceptional_departures WHERE admission_id=e.id) d WHERE b.created_at<=d.signed_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed care pricing cannot create new retrospective clinical work'; END IF;
   ELSIF a.correction_kind IN ('LAB_REPORT','LAB_BILLING') THEN
    IF staff_role IS DISTINCT FROM 'LAB' OR b.order_id IS DISTINCT FROM a.source_id OR b.category NOT IN ('lab','radiology') OR NOT EXISTS(SELECT 1 FROM hims.lab_processing WHERE order_id=b.order_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed diagnostic fee requires original performed Lab source'; END IF;
   ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No authority for this closed charge'; END IF;
   SELECT payload INTO policy FROM hims.setting_versions WHERE id=NEW.tariff_version_id AND hospital_id=e.hospital_id;
   IF policy->>'type' IS DISTINCT FROM 'billable-item' OR policy->>'code' IS DISTINCT FROM NEW.item_id OR policy->>'category' IS DISTINCT FROM NEW.category OR policy->>'unit' IS DISTINCT FROM NEW.unit OR NEW.rate_paise IS DISTINCT FROM ((policy->>'amount')::numeric)::bigint OR NEW.amount_paise IS DISTINCT FROM round((policy->>'amount')::numeric*NEW.quantity::numeric)::bigint THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed charge must retain the exact configured rate and original quantity'; END IF;
  END IF;
 ELSIF e.status='DISCHARGED' AND c.category<>'room' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed non-room money requires exact source-bound amendment authority';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hims.guard_transfer_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
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
   OR EXISTS(SELECT 1 FROM hims.transfer_order_cancellations c WHERE c.transfer_order_id=o.id AND NOT (NEW.transferred_at<c.signed_at AND EXISTS(
    SELECT 1 FROM hims.effective_room_stays st JOIN hims.stay_boundary_amendments m ON m.id=st.amendment_id JOIN hims.admin_exceptions x ON x.id=m.exception_id JOIN hims.exception_evidence p ON p.id=m.evidence_id
    WHERE st.id=NEW.old_stay_id AND m.admission_id=e.id AND x.type='DELAYED_TRANSFER' AND x.disposition='TRANSFER' AND x.admission_id=e.id AND x.evidence_ids ? p.id::text AND p.kind='TRANSFER_HANDOVER' AND p.source_id=o.id AND p.actual_at=NEW.transferred_at AND p.signed_by=NEW.signed_by)))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual transfer cannot consume cancelled or superseded authority'; END IF;
 ELSE
  IF NEW.kind<>'TRANSFER_HANDOVER' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM hims.transfer_orders WHERE id=NEW.source_id;
  IF e.status IS DISTINCT FROM 'ADMITTED' OR o.admission_id IS DISTINCT FROM e.id
   OR o.id IS DISTINCT FROM (SELECT id FROM hims.transfer_orders WHERE admission_id=e.id ORDER BY version DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM hims.effective_room_stays WHERE id=o.source_stay_id AND admission_id=e.id AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM hims.transfer_order_cancellations c WHERE c.transfer_order_id=o.id AND NEW.actual_at>=c.signed_at)
   OR EXISTS(SELECT 1 FROM hims.admission_transfers WHERE transfer_order_id=o.id) OR NEW.actual_at<o.signed_at
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Witnessed transfer requires current uncancelled original authority'; END IF;
 END IF;
 RETURN NEW;
END $$;
