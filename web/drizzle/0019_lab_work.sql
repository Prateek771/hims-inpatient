CREATE TABLE hims.lab_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES hims.clinical_orders(id),
 admission_id uuid NOT NULL REFERENCES hims.admissions(id), patient_id uuid NOT NULL REFERENCES hims.patients(id),
 barcode text NOT NULL UNIQUE CHECK (barcode ~ '^SMP-[A-F0-9]{32}$'),
 signed_by text NOT NULL REFERENCES hims.staff_user(id), signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_samples_episode_idx ON hims.lab_samples(admission_id);
CREATE TABLE hims.lab_processing (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES hims.clinical_orders(id),
 admission_id uuid NOT NULL REFERENCES hims.admissions(id), sample_id uuid REFERENCES hims.lab_samples(id),
 signed_by text NOT NULL REFERENCES hims.staff_user(id), signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_processing_episode_idx ON hims.lab_processing(admission_id);
CREATE TABLE hims.lab_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES hims.clinical_orders(id),
 admission_id uuid NOT NULL REFERENCES hims.admissions(id), sample_id uuid REFERENCES hims.lab_samples(id),
 result text NOT NULL CHECK(length(btrim(result)) BETWEEN 1 AND 5000),
 signed_by text NOT NULL REFERENCES hims.staff_user(id), signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_reports_episode_idx ON hims.lab_reports(admission_id);
CREATE TABLE hims.lab_report_addenda (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES hims.lab_reports(id),
 text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 5000), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 signed_by text NOT NULL REFERENCES hims.staff_user(id), signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_addenda_report_idx ON hims.lab_report_addenda(report_id);
CREATE TABLE hims.lab_dispositions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES hims.clinical_orders(id),
 admission_id uuid NOT NULL REFERENCES hims.admissions(id), stop_event_id uuid NOT NULL REFERENCES hims.clinical_task_events(id),
 reversal_id uuid REFERENCES hims.charge_reversals(id), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 signed_by text NOT NULL REFERENCES hims.staff_user(id), signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_dispositions_episode_idx ON hims.lab_dispositions(admission_id);
CREATE FUNCTION hims.guard_lab_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF TG_TABLE_NAME='lab_reports' THEN
   SELECT * INTO p FROM hims.lab_processing WHERE order_id=o.id;
   IF p.id IS NULL OR NEW.sample_id IS DISTINCT FROM p.sample_id THEN RAISE EXCEPTION 'Actual processing is required before reporting'; END IF;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM hims.lab_dispositions WHERE order_id=o.id) THEN RAISE EXCEPTION 'Unperformed diagnostic order was disposed'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hims.guard_lab_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o hims.clinical_orders; c hims.charges; r hims.charge_reversals;
BEGIN
 SELECT * INTO o FROM hims.clinical_orders WHERE id=NEW.order_id;
 PERFORM 1 FROM hims.admissions WHERE id=o.admission_id FOR UPDATE;
 IF o.kind NOT IN ('LAB','RADIOLOGY') OR o.admission_id<>NEW.admission_id OR NOT EXISTS(SELECT 1 FROM hims.clinical_task_events WHERE id=NEW.stop_event_id AND order_id=o.id AND status='STOPPED') THEN RAISE EXCEPTION 'Disposition requires actual stopped diagnostic source'; END IF;
 IF EXISTS(SELECT 1 FROM hims.lab_samples WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM hims.lab_processing WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM hims.lab_reports WHERE order_id=o.id) THEN RAISE EXCEPTION 'Performed diagnostic work cannot be cancelled as unperformed'; END IF;
 SELECT ch.* INTO c FROM hims.charges ch JOIN hims.care_billing_events b ON b.id=ch.source_event_id WHERE b.order_id=o.id;
 IF c.id IS NOT NULL THEN
  IF c.initial_status<>'PENDING' OR EXISTS(SELECT 1 FROM hims.charge_finalizations WHERE charge_id=c.id) THEN RAISE EXCEPTION 'Only original pending source can receive unperformed disposition'; END IF;
  IF c.amount_paise>0 THEN
   SELECT * INTO r FROM hims.charge_reversals WHERE id=NEW.reversal_id;
   IF r.id IS NULL OR r.charge_id<>c.id OR r.amount_paise<>c.amount_paise OR (SELECT coalesce(sum(amount_paise),0) FROM hims.charge_reversals WHERE charge_id=c.id)<>c.amount_paise THEN RAISE EXCEPTION 'Disposition must reverse the exact original source amount'; END IF;
  ELSIF NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'Zero-price source needs no fake reversal'; END IF;
 ELSIF NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'Disposition cannot reverse a missing source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_samples_source BEFORE INSERT ON hims.lab_samples FOR EACH ROW EXECUTE FUNCTION hims.guard_lab_source();
CREATE TRIGGER lab_processing_source BEFORE INSERT ON hims.lab_processing FOR EACH ROW EXECUTE FUNCTION hims.guard_lab_source();
CREATE TRIGGER lab_reports_source BEFORE INSERT ON hims.lab_reports FOR EACH ROW EXECUTE FUNCTION hims.guard_lab_source();
CREATE TRIGGER lab_disposition_source BEFORE INSERT ON hims.lab_dispositions FOR EACH ROW EXECUTE FUNCTION hims.guard_lab_disposition();
CREATE TRIGGER lab_samples_immutable BEFORE UPDATE OR DELETE ON hims.lab_samples FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER lab_processing_immutable BEFORE UPDATE OR DELETE ON hims.lab_processing FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER lab_reports_immutable BEFORE UPDATE OR DELETE ON hims.lab_reports FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER lab_addenda_immutable BEFORE UPDATE OR DELETE ON hims.lab_report_addenda FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER lab_dispositions_immutable BEFORE UPDATE OR DELETE ON hims.lab_dispositions FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
