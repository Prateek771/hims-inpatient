DROP INDEX "hims"."discharge_document_source";--> statement-breakpoint
CREATE INDEX "discharge_document_source" ON "hims"."discharge_documents" USING btree ("admission_id","source_hash");