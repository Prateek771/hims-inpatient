CREATE TABLE "hims"."billing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."charge_finalizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."charge_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reversal_amount" CHECK ("hims"."charge_reversals"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "hims"."charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"source_event_id" text NOT NULL,
	"source_payload" text NOT NULL,
	"category" text NOT NULL,
	"item_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" text NOT NULL,
	"unit" text NOT NULL,
	"tariff_version_id" uuid NOT NULL,
	"rate_paise" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"initial_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_amount" CHECK ("hims"."charges"."amount_paise" > 0 and "hims"."charges"."rate_paise" >= 0),
	CONSTRAINT "charge_status" CHECK ("hims"."charges"."initial_status" in ('PENDING','FINAL')),
	CONSTRAINT "charge_actor" CHECK (("hims"."charges"."actor_type"='staff' and length(trim("hims"."charges"."actor_id"))>0) or ("hims"."charges"."actor_type"='system' and "hims"."charges"."actor_id"='room-charge' and "hims"."charges"."category"='room'))
);
--> statement-breakpoint
CREATE TABLE "hims"."receipt_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_amount" CHECK ("hims"."receipt_allocations"."amount_paise">0)
);
--> statement-breakpoint
CREATE TABLE "hims"."receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"party" text NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" text NOT NULL,
	"channel" text NOT NULL,
	"source_reference" text NOT NULL,
	"reference" text NOT NULL,
	"evidence_id" text,
	"identity_payload" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_amount" CHECK ("hims"."receipts"."amount_paise">0),
	CONSTRAINT "receipt_party_kind" CHECK (("hims"."receipts"."party"='PATIENT' and "hims"."receipts"."kind" in ('DEPOSIT','TOP_UP','PAYMENT')) or ("hims"."receipts"."party"='INSURER' and "hims"."receipts"."kind"='PAYMENT')),
	CONSTRAINT "receipt_mode" CHECK ("hims"."receipts"."mode" in ('CASH','CARD','UPI','BANK')),
	CONSTRAINT "receipt_human" CHECK ("hims"."receipts"."actor_type"='staff' and length(trim("hims"."receipts"."actor_id"))>0)
);
--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD COLUMN "bill_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD COLUMN "deposit_version_id" uuid;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD COLUMN "posted_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hims"."charge_finalizations" ADD CONSTRAINT "charge_finalizations_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "hims"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."charge_reversals" ADD CONSTRAINT "charge_reversals_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "hims"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."charges" ADD CONSTRAINT "charges_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."charges" ADD CONSTRAINT "charges_tariff_version_id_setting_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "hims"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipts" ADD CONSTRAINT "receipts_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipts" ADD CONSTRAINT "receipts_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_request_actor_key" ON "hims"."billing_requests" USING btree ("actor_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_finalize_once" ON "hims"."charge_finalizations" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "charge_reversal_idx" ON "hims"."charge_reversals" USING btree ("charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_source_unique" ON "hims"."charges" USING btree ("admission_id","source_event_id");--> statement-breakpoint
CREATE INDEX "charges_admission_idx" ON "hims"."charges" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "receipt_allocation_idx" ON "hims"."receipt_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_cash_identity" ON "hims"."receipts" USING btree ("hospital_id","mode","channel","source_reference");--> statement-breakpoint
CREATE INDEX "receipts_admission_idx" ON "hims"."receipts" USING btree ("admission_id");--> statement-breakpoint
ALTER TABLE "hims"."admissions" ADD CONSTRAINT "admissions_deposit_version_id_setting_versions_id_fk" FOREIGN KEY ("deposit_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD CONSTRAINT "room_stay_posted_positive" CHECK ("hims"."room_stays"."posted_paise" >= 0);--> statement-breakpoint
ALTER TABLE "hims"."room_stays" ADD CONSTRAINT "room_stay_cursor_boundary" CHECK ("hims"."room_stays"."last_reconciled_at" is null or ("hims"."room_stays"."last_reconciled_at" >= "hims"."room_stays"."started_at" and ("hims"."room_stays"."ended_at" is null or "hims"."room_stays"."last_reconciled_at" <= "hims"."room_stays"."ended_at")));