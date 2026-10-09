CREATE TABLE "hims"."bed_turnover_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turnover_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"evidence" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."bed_turnovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bed_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"vacated_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."clearance_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seal_id" uuid NOT NULL,
	"change_kind" text NOT NULL,
	"changed_record_ids" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."clearance_seals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"gate" text NOT NULL,
	"role" text NOT NULL,
	"review_hash" text NOT NULL,
	"bill_version" integer,
	"predecessor_id" uuid,
	"inputs" jsonb NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "clearance_gate_role" CHECK (("hims"."clearance_seals"."gate"='DOCTOR' and "hims"."clearance_seals"."role"='DOCTOR') or ("hims"."clearance_seals"."gate"='PHARMACY' and "hims"."clearance_seals"."role"='PHARMACY') or ("hims"."clearance_seals"."gate"='NURSING' and "hims"."clearance_seals"."role"='NURSE') or ("hims"."clearance_seals"."gate"='BILLING' and "hims"."clearance_seals"."role" in ('ADMIN','BILLING'))),
	CONSTRAINT "clearance_bill_version" CHECK (("hims"."clearance_seals"."gate"='BILLING') = ("hims"."clearance_seals"."bill_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "hims"."departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"bill_seal_id" uuid NOT NULL,
	"departed_at" timestamp with time zone NOT NULL,
	"bill_version" integer NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."bed_turnover_completions" ADD CONSTRAINT "bed_turnover_completions_turnover_id_bed_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "hims"."bed_turnovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_turnover_completions" ADD CONSTRAINT "bed_turnover_completions_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_turnovers" ADD CONSTRAINT "bed_turnovers_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_turnovers" ADD CONSTRAINT "bed_turnovers_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_turnovers" ADD CONSTRAINT "bed_turnovers_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."bed_turnovers" ADD CONSTRAINT "bed_turnovers_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clearance_invalidations" ADD CONSTRAINT "clearance_invalidations_seal_id_clearance_seals_id_fk" FOREIGN KEY ("seal_id") REFERENCES "hims"."clearance_seals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clearance_seals" ADD CONSTRAINT "clearance_seals_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."clearance_seals" ADD CONSTRAINT "clearance_seals_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."departures" ADD CONSTRAINT "departures_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."departures" ADD CONSTRAINT "departures_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."departures" ADD CONSTRAINT "departures_bill_seal_id_clearance_seals_id_fk" FOREIGN KEY ("bill_seal_id") REFERENCES "hims"."clearance_seals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."departures" ADD CONSTRAINT "departures_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turnover_completed_once" ON "hims"."bed_turnover_completions" USING btree ("turnover_id");--> statement-breakpoint
CREATE INDEX "turnover_completion_signer" ON "hims"."bed_turnover_completions" USING btree ("signed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "turnover_stay_once" ON "hims"."bed_turnovers" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "turnover_bed" ON "hims"."bed_turnovers" USING btree ("bed_id");--> statement-breakpoint
CREATE INDEX "turnover_episode" ON "hims"."bed_turnovers" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "turnover_signer" ON "hims"."bed_turnovers" USING btree ("signed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "clearance_invalidated_once" ON "hims"."clearance_invalidations" USING btree ("seal_id");--> statement-breakpoint
CREATE INDEX "clearance_seal_episode_gate" ON "hims"."clearance_seals" USING btree ("admission_id","gate");--> statement-breakpoint
CREATE INDEX "clearance_seal_signer" ON "hims"."clearance_seals" USING btree ("signed_by");--> statement-breakpoint
CREATE INDEX "clearance_seal_predecessor" ON "hims"."clearance_seals" USING btree ("predecessor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departure_episode_once" ON "hims"."departures" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "departure_stay" ON "hims"."departures" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "departure_seal" ON "hims"."departures" USING btree ("bill_seal_id");--> statement-breakpoint
CREATE INDEX "departure_signer" ON "hims"."departures" USING btree ("signed_by");