-- Append-only seals and their invalidation reasons. All source commands own the admission lock.
CREATE FUNCTION hims.invalidate_clearances(episode uuid, first_gate text, changed_kind text, changed_ids jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM hims.admissions WHERE id=episode FOR UPDATE;
 INSERT INTO hims.clearance_invalidations(seal_id,change_kind,changed_record_ids)
 SELECT s.id,changed_kind,changed_ids FROM hims.clearance_seals s
 WHERE s.admission_id=episode AND array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],s.gate)>=array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],first_gate)
 AND NOT EXISTS(SELECT 1 FROM hims.clearance_invalidations i WHERE i.seal_id=s.id)
 ON CONFLICT(seal_id) DO NOTHING;
END $$;
CREATE FUNCTION hims.invalidate_clearance_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb=to_jsonb(NEW); episode uuid; first_gate text=TG_ARGV[0]; category text;
BEGIN
 episode=(r->>'admission_id')::uuid;
 IF episode IS NULL THEN
  IF r ? 'charge_id' THEN SELECT c.admission_id,c.category INTO episode,category FROM hims.charges c WHERE c.id=(r->>'charge_id')::uuid;
  ELSIF r ? 'receipt_id' THEN SELECT admission_id INTO episode FROM hims.receipts WHERE id=(r->>'receipt_id')::uuid;
  ELSIF r ? 'allocation_id' THEN SELECT c.admission_id INTO episode FROM hims.receipt_allocations a JOIN hims.receipts c ON c.id=a.receipt_id WHERE a.id=(r->>'allocation_id')::uuid;
  ELSIF r ? 'note_id' THEN SELECT admission_id INTO episode FROM hims.clinical_rounds WHERE id=(r->>'note_id')::uuid;
  ELSIF r ? 'order_id' THEN SELECT admission_id INTO episode FROM hims.clinical_orders WHERE id=(r->>'order_id')::uuid;
  ELSIF r ? 'report_id' THEN SELECT admission_id INTO episode FROM hims.lab_reports WHERE id=(r->>'report_id')::uuid;
  ELSIF r ? 'shift_id' THEN SELECT admission_id INTO episode FROM hims.nursing_shifts WHERE id=(r->>'shift_id')::uuid;
  ELSIF r ? 'case_id' THEN SELECT admission_id INTO episode FROM hims.insurance_cases WHERE id=(r->>'case_id')::uuid;
  END IF;
 END IF;
 IF episode IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME IN ('charges','care_billing_events') THEN category=r->>'category'; END IF;
 IF category='medicine' THEN first_gate='PHARMACY'; ELSIF category='consumable' THEN first_gate='NURSING'; END IF;
 IF TG_TABLE_NAME='nursing_addenda' AND r->>'record_type'='MAR' THEN first_gate='PHARMACY'; END IF;
 IF TG_TABLE_NAME='insurance_events' AND r->>'kind'<>'POLICY' THEN RETURN NEW; END IF;
 PERFORM hims.invalidate_clearances(episode,first_gate,TG_TABLE_NAME,jsonb_build_array(r->>'id'));
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clearance_seals','clearance_invalidations','room_vacations','departures','bed_turnovers','bed_turnover_completions','receipt_refunds','allocation_cancellations','self_pay_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history()',t||'_immutable',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['clinical_rounds','clinical_addenda','clinical_orders','clinical_task_events','clinical_summaries','transfer_orders','admission_transfers','lab_reports','lab_report_addenda','lab_dispositions'] LOOP
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source(''DOCTOR'')',t||'_clearance',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['pharmacy_movements','pharmacy_preparations','medication_administrations'] LOOP
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source(''PHARMACY'')',t||'_clearance',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['nursing_shifts','nursing_shift_ends','nursing_observations','nursing_consumables','nursing_addenda'] LOOP
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source(''NURSING'')',t||'_clearance',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['charges','charge_reversals','charge_finalizations','receipts','receipt_allocations','receipt_refunds','allocation_cancellations','self_pay_reviews','insurance_events','insurance_decisions','insurance_conversions','insurance_transfer_resolutions','transfer_insurance_tasks','room_vacations'] LOOP
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON hims.%I FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source(''BILLING'')',t||'_clearance',t);
 END LOOP;
END $$;
CREATE TRIGGER care_source_clearance AFTER INSERT OR UPDATE ON hims.care_billing_events FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('BILLING');
-- Cursor-only updates do not change money; actual room charge rows invalidate Billing.
CREATE TRIGGER room_source_clearance AFTER INSERT OR UPDATE OF started_at,ended_at,bed_id,tariff_version_id ON hims.room_stays FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('BILLING');
CREATE FUNCTION hims.guard_discharge_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; s hims.clearance_seals; st hims.room_stays; r hims.receipts; a hims.receipt_allocations;
BEGIN
 IF TG_TABLE_NAME='allocation_cancellations' THEN
  SELECT * INTO a FROM hims.receipt_allocations WHERE id=NEW.allocation_id;
  SELECT * INTO r FROM hims.receipts WHERE id=a.receipt_id;
  SELECT * INTO e FROM hims.admissions WHERE id=r.admission_id FOR UPDATE;
 ELSIF TG_TABLE_NAME='receipt_refunds' THEN
  SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
  SELECT * INTO r FROM hims.receipts WHERE id=NEW.receipt_id;
  IF r.admission_id IS DISTINCT FROM e.id OR r.hospital_id IS DISTINCT FROM NEW.hospital_id THEN RAISE EXCEPTION 'Refund must link this admission original receipt'; END IF;
  IF NEW.refunded_at>clock_timestamp() OR NEW.refunded_at<r.created_at THEN RAISE EXCEPTION 'Refund actual time outside receipt history'; END IF;
  IF NEW.amount_paise+coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds WHERE receipt_id=r.id),0)>r.amount_paise THEN RAISE EXCEPTION 'Refund exceeds original receipt'; END IF;
  IF r.kind<>'PAYMENT' AND NEW.amount_paise+coalesce((SELECT sum(amount_paise) FROM hims.receipt_refunds WHERE receipt_id=r.id),0)+coalesce((SELECT sum(x.amount_paise) FROM hims.receipt_allocations x WHERE x.receipt_id=r.id AND NOT EXISTS(SELECT 1 FROM hims.allocation_cancellations c WHERE c.allocation_id=x.id)),0)>r.amount_paise THEN RAISE EXCEPTION 'Cancel allocated deposit before refund'; END IF;
 ELSE
  SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 END IF;
 IF TG_TABLE_NAME='clearance_seals' THEN
  IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role=NEW.role AND coalesce(banned,false)=false) THEN RAISE EXCEPTION 'Current actual seal role required'; END IF;
  IF NEW.gate<>'DOCTOR' THEN
   SELECT * INTO s FROM hims.clearance_seals WHERE id=NEW.predecessor_id;
   IF s.admission_id IS DISTINCT FROM e.id OR array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],s.gate) IS DISTINCT FROM array_position(ARRAY['DOCTOR','PHARMACY','NURSING','BILLING'],NEW.gate)-1 OR EXISTS(SELECT 1 FROM hims.clearance_invalidations WHERE seal_id=s.id) THEN RAISE EXCEPTION 'Current same-episode predecessor required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('room_vacations','departures') THEN
  SELECT * INTO st FROM hims.room_stays WHERE id=NEW.stay_id;
  IF st.admission_id IS DISTINCT FROM e.id THEN RAISE EXCEPTION 'Same episode stay required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clearance_source_guard BEFORE INSERT ON hims.clearance_seals FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_sources();
CREATE TRIGGER vacation_source_guard BEFORE INSERT ON hims.room_vacations FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_sources();
CREATE TRIGGER departure_source_guard BEFORE INSERT ON hims.departures FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_sources();
CREATE TRIGGER refund_source_guard BEFORE INSERT ON hims.receipt_refunds FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_sources();
CREATE TRIGGER allocation_cancel_source_guard BEFORE INSERT ON hims.allocation_cancellations FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_sources();
