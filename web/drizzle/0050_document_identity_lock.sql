-- Keep identity serialization without granting UPDATE on original patient history.
CREATE OR REPLACE FUNCTION hims.lock_document_identity_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended('document-identity:'||NEW.patient_id::text,0));
 RETURN NEW;
END $$;
