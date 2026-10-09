CREATE TRIGGER insurance_event_immutable BEFORE UPDATE OR DELETE ON hims.insurance_events FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER insurance_decision_immutable BEFORE UPDATE OR DELETE ON hims.insurance_decisions FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER insurance_document_immutable BEFORE UPDATE OR DELETE ON hims.insurance_documents FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER insurance_conversion_immutable BEFORE UPDATE OR DELETE ON hims.insurance_conversions FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER insurance_transfer_resolution_immutable BEFORE UPDATE OR DELETE ON hims.insurance_transfer_resolutions FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE FUNCTION hims.guard_insurance_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c hims.insurance_cases; source_case uuid;
BEGIN
 SELECT * INTO c FROM hims.insurance_cases WHERE id=NEW.case_id;
 PERFORM 1 FROM hims.admissions WHERE id=c.admission_id FOR UPDATE;
 IF TG_TABLE_NAME='insurance_documents' THEN
  IF NEW.replaces_document_id IS NOT NULL THEN
   SELECT case_id INTO source_case FROM hims.insurance_documents WHERE id=NEW.replaces_document_id;
   IF source_case IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'Document replacement requires same case'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='insurance_decisions' THEN
  SELECT case_id INTO source_case FROM hims.insurance_events WHERE id=NEW.policy_event_id AND kind='POLICY';
  IF source_case IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'Decision requires same-case external policy evidence'; END IF;
 ELSIF TG_TABLE_NAME='insurance_transfer_resolutions' THEN
  IF NOT EXISTS(SELECT 1 FROM hims.transfer_insurance_tasks WHERE id=NEW.task_id AND admission_id=c.admission_id) THEN RAISE EXCEPTION 'Transfer resolution requires same episode'; END IF;
  IF NEW.decision_id IS NOT NULL THEN SELECT case_id INTO source_case FROM hims.insurance_decisions WHERE id=NEW.decision_id;
  ELSE SELECT case_id INTO source_case FROM hims.insurance_conversions WHERE id=NEW.conversion_id; END IF;
  IF source_case IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'Transfer resolution requires same-case evidence'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER insurance_document_source BEFORE INSERT ON hims.insurance_documents FOR EACH ROW EXECUTE FUNCTION hims.guard_insurance_source();
CREATE TRIGGER insurance_decision_source BEFORE INSERT ON hims.insurance_decisions FOR EACH ROW EXECUTE FUNCTION hims.guard_insurance_source();
CREATE TRIGGER insurance_resolution_source BEFORE INSERT ON hims.insurance_transfer_resolutions FOR EACH ROW EXECUTE FUNCTION hims.guard_insurance_source();
