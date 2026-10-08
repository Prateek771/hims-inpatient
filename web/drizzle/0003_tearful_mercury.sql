CREATE TABLE "hims"."admission_counters" (
	"hospital_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "admission_counters_hospital_id_year_pk" PRIMARY KEY("hospital_id","year"),
	CONSTRAINT "admission_counter_positive" CHECK ("hims"."admission_counters"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "hims"."admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"ip_code" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"admitting_doctor_id" text NOT NULL,
	"clinician_assessment" jsonb NOT NULL,
	"bed_id" uuid NOT NULL,
	"payment_route" text NOT NULL,
	"expected_stay_days" integer NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_payload" text NOT NULL,
	CONSTRAINT "admissions_ip_code_unique" UNIQUE("ip_code"),
	CONSTRAINT "admission_status" CHECK ("hims"."admissions"."status" in ('PENDING','ADMITTED','CANCELLED','DISCHARGED')),
	CONSTRAINT "admission_route" CHECK ("hims"."admissions"."payment_route" in ('SELF_PAY','INSURED')),
	CONSTRAINT "admission_days" CHECK ("hims"."admissions"."expected_stay_days" between 1 and 365),
	CONSTRAINT "admission_activation_time" CHECK (("hims"."admissions"."status" in ('ADMITTED','DISCHARGED')) = ("hims"."admissions"."admitted_at" is not null)),
	CONSTRAINT "admission_cancel_record" CHECK ("hims"."admissions"."status" <> 'CANCELLED' or ("hims"."admissions"."cancelled_at" is not null and length(trim("hims"."admissions"."cancellation_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "hims"."bed_holds" (
	"bed_id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_holds_admission_id_unique" UNIQUE("admission_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"category_version_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beds_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "hims"."patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uhid" text NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"sex" text NOT NULL,
	"phone" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_by" text NOT NULL,
	CONSTRAINT "patients_uhid_unique" UNIQUE("uhid"),
	CONSTRAINT "patients_sex" CHECK ("hims"."patients"."sex" in ('FEMALE','MALE','OTHER','UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "hims"."room_stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"tariff_version_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "room_stay_boundary" CHECK ("hims"."room_stays"."ended_at" is null or "hims"."room_stays"."ended_at" > "hims"."room_stays"."started_at")
);
--> statement-breakpoint
ALTER TABLE "hims"."admission_counters" ADD CONSTRAINT "admission_counters_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "hims"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_admitting_doctor_id_staff_user_id_fk" FOREIGN KEY ("admitting_doctor_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_holds" ADD CONSTRAINT "bed_holds_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_holds" ADD CONSTRAINT "bed_holds_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."beds" ADD CONSTRAINT "beds_category_version_id_setting_versions_id_fk" FOREIGN KEY ("category_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."patients" ADD CONSTRAINT "patients_registered_by_staff_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD CONSTRAINT "room_stays_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD CONSTRAINT "room_stays_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD CONSTRAINT "room_stays_tariff_version_id_setting_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_retry_idx" ON "hims"."admissions" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_active_admission_idx" ON "hims"."admissions" USING btree ("patient_id") WHERE "hims"."admissions"."status" in ('PENDING','ADMITTED');--> statement-breakpoint
CREATE INDEX "admissions_doctor_idx" ON "hims"."admissions" USING btree ("admitting_doctor_id");--> statement-breakpoint
CREATE INDEX "admissions_bed_idx" ON "hims"."admissions" USING btree ("bed_id");--> statement-breakpoint
CREATE INDEX "admissions_hospital_idx" ON "hims"."admissions" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "beds_category_idx" ON "hims"."beds" USING btree ("category");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "hims"."patients" USING btree ("name");--> statement-breakpoint
CREATE INDEX "room_stays_admission_idx" ON "hims"."room_stays" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "room_stays_bed_idx" ON "hims"."room_stays" USING btree ("bed_id");--> statement-breakpoint
CREATE INDEX "room_stays_tariff_idx" ON "hims"."room_stays" USING btree ("tariff_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_stay_active_admission_idx" ON "hims"."room_stays" USING btree ("admission_id") WHERE "hims"."room_stays"."ended_at" is null;