CREATE TABLE "hims"."nursing_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"text" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nursing_addendum_type" CHECK ("hims"."nursing_addenda"."record_type" in ('MAR','OBSERVATION','SHIFT','CONSUMABLE'))
);
--> statement-breakpoint
ALTER TABLE "hims"."nursing_addenda" ADD CONSTRAINT "nursing_addenda_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_addenda" ADD CONSTRAINT "nursing_addenda_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nursing_addendum_episode_idx" ON "hims"."nursing_addenda" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "nursing_addendum_record_idx" ON "hims"."nursing_addenda" USING btree ("record_id");