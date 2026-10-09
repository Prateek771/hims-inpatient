CREATE OR REPLACE FUNCTION hims.guard_lab_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o hims.clinical_orders; c hims.charges; r hims.charge_reversals;
BEGIN
 SELECT * INTO o FROM hims.clinical_orders WHERE id=NEW.order_id;
 PERFORM 1 FROM hims.admissions WHERE id=o.admission_id FOR UPDATE;
 IF o.kind NOT IN ('LAB','RADIOLOGY') OR o.admission_id<>NEW.admission_id OR NOT EXISTS(SELECT 1 FROM hims.clinical_task_events WHERE id=NEW.stop_event_id AND order_id=o.id AND status='STOPPED') THEN RAISE EXCEPTION 'Disposition requires actual stopped diagnostic source'; END IF;
 IF EXISTS(SELECT 1 FROM hims.lab_samples WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM hims.lab_processing WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM hims.lab_reports WHERE order_id=o.id) THEN RAISE EXCEPTION 'Performed diagnostic work cannot be cancelled as unperformed'; END IF;
 SELECT ch.* INTO c FROM hims.charges ch JOIN hims.care_billing_events b ON b.id::text=ch.source_event_id WHERE b.order_id=o.id;
 IF c.id IS NOT NULL THEN
  IF c.initial_status<>'PENDING' OR EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=c.id) THEN RAISE EXCEPTION 'Only original pending source can receive unperformed disposition'; END IF;
  IF c.amount_paise>0 THEN
   SELECT * INTO r FROM hims.charge_reversals WHERE id=NEW.reversal_id;
   IF r.id IS NULL OR r.charge_id<>c.id OR r.amount_paise<>c.amount_paise OR (SELECT coalesce(sum(amount_paise),0) FROM hims.charge_reversals WHERE charge_id=c.id)<>c.amount_paise THEN RAISE EXCEPTION 'Disposition must reverse the exact original source amount'; END IF;
  ELSIF NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'Zero-price source needs no fake reversal'; END IF;
 ELSIF NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'Disposition cannot reverse a missing source'; END IF;
 RETURN NEW;
END $$;
