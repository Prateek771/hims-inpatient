CREATE TABLE "hims"."admin_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"type" text NOT NULL,
	"disposition" text NOT NULL,
	"authority" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"source_id" uuid,
	"correction_kind" text,
	"follow_up_owner_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exception_authority_text" CHECK (length(btrim("hims"."admin_exceptions"."authority"))>=3 and length(btrim("hims"."admin_exceptions"."reason"))>=3 and length(btrim("hims"."admin_exceptions"."evidence"))>=3)
);
--> statement-breakpoint
ALTER TABLE "hims"."admin_exceptions" ADD CONSTRAINT "admin_exceptions_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admin_exceptions" ADD CONSTRAINT "admin_exceptions_follow_up_owner_id_staff_user_id_fk" FOREIGN KEY ("follow_up_owner_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admin_exceptions" ADD CONSTRAINT "admin_exceptions_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exceptions_admission_idx" ON "hims"."admin_exceptions" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "exceptions_owner_idx" ON "hims"."admin_exceptions" USING btree ("follow_up_owner_id");--> statement-breakpoint
CREATE INDEX "exceptions_source_idx" ON "hims"."admin_exceptions" USING btree ("source_id");
--> statement-breakpoint
CREATE TRIGGER admin_exception_immutable BEFORE UPDATE OR DELETE ON hims.admin_exceptions FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE FUNCTION hims.guard_admin_exception() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=NEW.admission_id;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMIN' AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current administrator exception authority required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.follow_up_owner_id AND NOT banned) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Active follow-up owner required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_exception_authority BEFORE INSERT ON hims.admin_exceptions FOR EACH ROW EXECUTE FUNCTION hims.guard_admin_exception();
