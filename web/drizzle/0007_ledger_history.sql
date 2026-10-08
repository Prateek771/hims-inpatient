CREATE FUNCTION hims.preserve_billing_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Billing history is immutable; append a linked correction'; END $$;
CREATE TRIGGER charges_immutable BEFORE UPDATE OR DELETE ON hims.charges FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER charge_finalizations_immutable BEFORE UPDATE OR DELETE ON hims.charge_finalizations FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER charge_reversals_immutable BEFORE UPDATE OR DELETE ON hims.charge_reversals FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON hims.receipts FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER receipt_allocations_immutable BEFORE UPDATE OR DELETE ON hims.receipt_allocations FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER billing_requests_immutable BEFORE UPDATE OR DELETE ON hims.billing_requests FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
ALTER TABLE hims.admissions ADD CONSTRAINT admission_revisions_positive CHECK (version > 0 AND bill_revision > 0);
