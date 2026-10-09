CREATE TABLE "hims"."discharge_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"replaces_document_id" uuid,
	"source_hash" text NOT NULL,
	"hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"storage_key" uuid NOT NULL,
	"pdf_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discharge_document_values" CHECK ("hims"."discharge_documents"."version">0 and "hims"."discharge_documents"."size_bytes">0 and "hims"."discharge_documents"."size_bytes"<=10485760 and "hims"."discharge_documents"."hash"~'^[0-9a-f]{64}$' and "hims"."discharge_documents"."source_hash"~'^[0-9a-f]{64}$' and "hims"."discharge_documents"."pdf_hash"~'^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "hims"."discharge_documents" ADD CONSTRAINT "discharge_documents_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."discharge_documents" ADD CONSTRAINT "discharge_documents_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discharge_document_version" ON "hims"."discharge_documents" USING btree ("admission_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "discharge_document_source" ON "hims"."discharge_documents" USING btree ("admission_id","source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "discharge_document_storage" ON "hims"."discharge_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "discharge_document_creator" ON "hims"."discharge_documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "discharge_document_predecessor" ON "hims"."discharge_documents" USING btree ("replaces_document_id");

-- File metadata and original canonical snapshots are append-only, including owner writes.
CREATE TRIGGER discharge_document_immutable BEFORE UPDATE OR DELETE ON hims.discharge_documents
FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE FUNCTION hims.guard_discharge_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; previous hims.discharge_documents; actor hims.staff_user; departure_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 SELECT * INTO actor FROM hims.staff_user WHERE id=NEW.created_by FOR SHARE;
 IF actor.id IS NULL OR actor.banned OR actor.role NOT IN ('ADMIN','BILLING') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current final-copy delivery staff required';
 END IF;
 SELECT * INTO e FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 IF e.status IS DISTINCT FROM 'DISCHARGED' OR (NEW.snapshot->'admission'->>'id')::uuid IS DISTINCT FROM e.id
 OR (NEW.snapshot->>'documentId')::uuid IS DISTINCT FROM NEW.id
 OR (NEW.snapshot->>'version')::integer IS DISTINCT FROM NEW.version
 OR NEW.snapshot->>'sourceHash' IS DISTINCT FROM NEW.source_hash
 OR (NEW.snapshot->'money'->'bill'->>'revision')::integer IS DISTINCT FROM e.bill_revision
 OR (NEW.snapshot->>'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Coherent actual departure document source required';
 END IF;
 SELECT id INTO departure_id FROM hims.departures WHERE admission_id=e.id;
 IF departure_id IS NOT NULL THEN
  IF NEW.snapshot->'departure'->>'kind'<>'ORDINARY' OR (NEW.snapshot->'departure'->'record'->>'id')::uuid IS DISTINCT FROM departure_id THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original ordinary departure source required';
  END IF;
 ELSE
  SELECT id INTO departure_id FROM hims.exceptional_departures WHERE admission_id=e.id;
  IF departure_id IS NULL OR NEW.snapshot->'departure'->>'kind'<>'EXCEPTIONAL' OR (NEW.snapshot->'departure'->'record'->>'id')::uuid IS DISTINCT FROM departure_id THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original exceptional departure source required';
  END IF;
 END IF;
 SELECT * INTO previous FROM hims.discharge_documents WHERE admission_id=e.id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(previous.version,0)+1 OR NEW.replaces_document_id IS DISTINCT FROM previous.id THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Sequential immutable document predecessor required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discharge_document_source BEFORE INSERT ON hims.discharge_documents
FOR EACH ROW EXECUTE FUNCTION hims.guard_discharge_document();

-- A patient's effective identity can change in a later episode. Share its original row
-- while rendering; native identification insertion obtains the same source exclusively.
CREATE FUNCTION hims.lock_document_identity_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM hims.admissions WHERE id=NEW.admission_id FOR UPDATE;
 PERFORM 1 FROM hims.patients WHERE id=NEW.patient_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER identification_document_source BEFORE INSERT ON hims.patient_identifications
FOR EACH ROW EXECUTE FUNCTION hims.lock_document_identity_source();
