ALTER TABLE "hims"."pharmacy_preparations" ADD COLUMN "version" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_preparation_version" ON "hims"."pharmacy_preparations" USING btree ("admission_id","version");--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_preparations" ADD CONSTRAINT "pharmacy_preparation_positive" CHECK ("hims"."pharmacy_preparations"."version">0);