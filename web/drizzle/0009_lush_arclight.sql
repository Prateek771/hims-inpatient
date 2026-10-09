CREATE TABLE "hims"."care_billing_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"order_id" uuid,
	"round_id" uuid,
	"category" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" text NOT NULL,
	"unit" text NOT NULL,
	"tariff_version_id" uuid,
	"resolution_reason" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_billing_state" CHECK ("hims"."care_billing_events"."state" in ('UNRESOLVED','READY','POSTED'))
);
--> statement-breakpoint
CREATE TABLE "hims"."care_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."care_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"owner_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_tasks_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."clinical_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"text" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."clinical_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_item" text NOT NULL,
	"details" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_order_kind" CHECK ("hims"."clinical_orders"."kind" in ('MEDICINE','LAB','RADIOLOGY','PROCEDURE','DIET','VITALS'))
);
--> statement-breakpoint
CREATE TABLE "hims"."clinical_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"notes" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."clinical_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"diagnosis" text NOT NULL,
	"course" text NOT NULL,
	"condition" text NOT NULL,
	"follow_up" text NOT NULL,
	"advice" text NOT NULL,
	"prescription" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."clinical_task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_task_status" CHECK ("hims"."clinical_task_events"."status" in ('COMPLETED','STOPPED'))
);
--> statement-breakpoint
CREATE TABLE "hims"."medication_administrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"actual_at" timestamp with time zone NOT NULL,
	"actual_dose" text NOT NULL,
	"dose_unit" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medication_administrations_occurrence_id_unique" UNIQUE("occurrence_id"),
	CONSTRAINT "mar_outcome" CHECK ("hims"."medication_administrations"."outcome" in ('GIVEN','HELD','REFUSED')),
	CONSTRAINT "mar_reason" CHECK ("hims"."medication_administrations"."outcome"='GIVEN' or length(trim("hims"."medication_administrations"."reason"))>0)
);
--> statement-breakpoint
CREATE TABLE "hims"."nurse_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"nurse_id" text NOT NULL,
	"authority" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."nursing_consumables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"item_id" text NOT NULL,
	"quantity" text NOT NULL,
	"unit" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."nursing_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"values" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nursing_observations_occurrence_id_unique" UNIQUE("occurrence_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."nursing_shift_ends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"handover" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nursing_shift_ends_shift_id_unique" UNIQUE("shift_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."nursing_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"nurse_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"handover" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."care_billing_events" ADD CONSTRAINT "care_billing_events_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_billing_events" ADD CONSTRAINT "care_billing_events_order_id_clinical_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "hims"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_billing_events" ADD CONSTRAINT "care_billing_events_round_id_clinical_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "hims"."clinical_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_billing_events" ADD CONSTRAINT "care_billing_events_tariff_version_id_setting_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_occurrences" ADD CONSTRAINT "care_occurrences_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_occurrences" ADD CONSTRAINT "care_occurrences_order_id_clinical_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "hims"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_tasks" ADD CONSTRAINT "care_tasks_order_id_clinical_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "hims"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."care_tasks" ADD CONSTRAINT "care_tasks_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_addenda" ADD CONSTRAINT "clinical_addenda_note_id_clinical_rounds_id_fk" FOREIGN KEY ("note_id") REFERENCES "hims"."clinical_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_addenda" ADD CONSTRAINT "clinical_addenda_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_orders" ADD CONSTRAINT "clinical_orders_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_orders" ADD CONSTRAINT "clinical_orders_round_id_clinical_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "hims"."clinical_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_orders" ADD CONSTRAINT "clinical_orders_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_rounds" ADD CONSTRAINT "clinical_rounds_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_rounds" ADD CONSTRAINT "clinical_rounds_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_summaries" ADD CONSTRAINT "clinical_summaries_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_summaries" ADD CONSTRAINT "clinical_summaries_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_task_events" ADD CONSTRAINT "clinical_task_events_order_id_clinical_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "hims"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clinical_task_events" ADD CONSTRAINT "clinical_task_events_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."medication_administrations" ADD CONSTRAINT "medication_administrations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."medication_administrations" ADD CONSTRAINT "medication_administrations_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."medication_administrations" ADD CONSTRAINT "medication_administrations_occurrence_id_care_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "hims"."care_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."medication_administrations" ADD CONSTRAINT "medication_administrations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nurse_assignments" ADD CONSTRAINT "nurse_assignments_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nurse_assignments" ADD CONSTRAINT "nurse_assignments_nurse_id_staff_user_id_fk" FOREIGN KEY ("nurse_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nurse_assignments" ADD CONSTRAINT "nurse_assignments_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_consumables" ADD CONSTRAINT "nursing_consumables_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_consumables" ADD CONSTRAINT "nursing_consumables_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_consumables" ADD CONSTRAINT "nursing_consumables_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_consumables" ADD CONSTRAINT "nursing_consumables_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_consumables" ADD CONSTRAINT "nursing_consumables_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_observations" ADD CONSTRAINT "nursing_observations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_observations" ADD CONSTRAINT "nursing_observations_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_observations" ADD CONSTRAINT "nursing_observations_occurrence_id_care_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "hims"."care_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_observations" ADD CONSTRAINT "nursing_observations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_shift_ends" ADD CONSTRAINT "nursing_shift_ends_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_shift_ends" ADD CONSTRAINT "nursing_shift_ends_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_shifts" ADD CONSTRAINT "nursing_shifts_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_shifts" ADD CONSTRAINT "nursing_shifts_nurse_id_staff_user_id_fk" FOREIGN KEY ("nurse_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nursing_shifts" ADD CONSTRAINT "nursing_shifts_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_billing_episode_idx" ON "hims"."care_billing_events" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "care_billing_order_idx" ON "hims"."care_billing_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "care_billing_round_idx" ON "hims"."care_billing_events" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "care_billing_tariff_idx" ON "hims"."care_billing_events" USING btree ("tariff_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "care_occurrence_identity_idx" ON "hims"."care_occurrences" USING btree ("order_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "care_occurrence_episode_idx" ON "hims"."care_occurrences" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "care_tasks_episode_idx" ON "hims"."care_tasks" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "clinical_addenda_note_idx" ON "hims"."clinical_addenda" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "clinical_orders_episode_idx" ON "hims"."clinical_orders" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "clinical_orders_round_idx" ON "hims"."clinical_orders" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "clinical_rounds_episode_idx" ON "hims"."clinical_rounds" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_summary_version_idx" ON "hims"."clinical_summaries" USING btree ("admission_id","version");--> statement-breakpoint
CREATE INDEX "clinical_task_events_order_idx" ON "hims"."clinical_task_events" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_task_once_idx" ON "hims"."clinical_task_events" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "mar_episode_idx" ON "hims"."medication_administrations" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "mar_shift_idx" ON "hims"."medication_administrations" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nurse_assignment_identity_idx" ON "hims"."nurse_assignments" USING btree ("admission_id","nurse_id");--> statement-breakpoint
CREATE INDEX "nurse_assignment_nurse_idx" ON "hims"."nurse_assignments" USING btree ("nurse_id");--> statement-breakpoint
CREATE INDEX "nursing_consumable_episode_idx" ON "hims"."nursing_consumables" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "nursing_consumable_shift_idx" ON "hims"."nursing_consumables" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "nursing_consumable_stay_idx" ON "hims"."nursing_consumables" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "nursing_consumable_bed_idx" ON "hims"."nursing_consumables" USING btree ("bed_id");--> statement-breakpoint
CREATE INDEX "nursing_observation_episode_idx" ON "hims"."nursing_observations" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "nursing_observation_shift_idx" ON "hims"."nursing_observations" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "nursing_shift_episode_idx" ON "hims"."nursing_shifts" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "nursing_shift_nurse_idx" ON "hims"."nursing_shifts" USING btree ("nurse_id");