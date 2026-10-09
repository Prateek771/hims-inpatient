CREATE OR REPLACE FUNCTION hims.guard_lab_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o hims.clinical_orders; e hims.admissions; s hims.lab_samples; p hims.lab_processing;
BEGIN
 SELECT * INTO o FROM hims.clinical_orders WHERE id=NEW.order_id;
 SELECT * INTO e FROM hims.admissions WHERE id=o.admission_id FOR UPDATE;
 IF o.kind NOT IN ('LAB','RADIOLOGY') OR NEW.admission_id<>o.admission_id THEN RAISE EXCEPTION 'Diagnostic order/episode mismatch'; END IF;
 IF TG_TABLE_NAME='lab_samples' THEN
  IF o.kind<>'LAB' OR NEW.patient_id<>e.patient_id OR EXISTS(SELECT 1 FROM hims.clinical_task_events WHERE order_id=o.id AND status='STOPPED') THEN RAISE EXCEPTION 'Sample patient/order mismatch or stopped source'; END IF;
 ELSE
  SELECT * INTO s FROM hims.lab_samples WHERE order_id=o.id;
  IF (o.kind='LAB' AND (s.id IS NULL OR NEW.sample_id IS DISTINCT FROM s.id)) OR (o.kind='RADIOLOGY' AND NEW.sample_id IS NOT NULL) THEN RAISE EXCEPTION 'Diagnostic sample binding mismatch'; END IF;
  IF TG_TABLE_NAME='lab_processing' AND EXISTS(SELECT 1 FROM hims.clinical_task_events WHERE order_id=o.id AND status='STOPPED') THEN RAISE EXCEPTION 'Doctor-stopped work cannot begin processing'; END IF;
  IF TG_TABLE_NAME='lab_reports' THEN
   SELECT * INTO p FROM hims.lab_processing WHERE order_id=o.id;
   IF p.id IS NULL OR NEW.sample_id IS DISTINCT FROM p.sample_id THEN RAISE EXCEPTION 'Actual processing is required before reporting'; END IF;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM hims.lab_dispositions WHERE order_id=o.id) THEN RAISE EXCEPTION 'Unperformed diagnostic order was disposed'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE hims.lab_samples ALTER COLUMN signed_at SET DEFAULT clock_timestamp();
ALTER TABLE hims.lab_processing ALTER COLUMN signed_at SET DEFAULT clock_timestamp();
ALTER TABLE hims.lab_reports ALTER COLUMN signed_at SET DEFAULT clock_timestamp();
ALTER TABLE hims.lab_report_addenda ALTER COLUMN signed_at SET DEFAULT clock_timestamp();
ALTER TABLE hims.lab_dispositions ALTER COLUMN signed_at SET DEFAULT clock_timestamp();
