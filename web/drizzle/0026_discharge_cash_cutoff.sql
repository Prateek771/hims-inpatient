CREATE TABLE "hims"."allocation_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reviewed_hash" text NOT NULL,
	"reviewed_bill_version" integer NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_cancel_staff" CHECK ("hims"."allocation_cancellations"."actor_type"='staff')
);
--> statement-breakpoint
CREATE TABLE "hims"."receipt_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" text NOT NULL,
	"channel" text NOT NULL,
	"source_reference" text NOT NULL,
	"evidence" text NOT NULL,
	"reason" text NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"reviewed_hash" text NOT NULL,
	"reviewed_bill_version" integer NOT NULL,
	"identity_payload" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount" CHECK ("hims"."receipt_refunds"."amount_paise">0),
	CONSTRAINT "refund_mode" CHECK ("hims"."receipt_refunds"."mode" in ('CASH','CARD','UPI','BANK')),
	CONSTRAINT "refund_staff" CHECK ("hims"."receipt_refunds"."actor_type"='staff')
);
--> statement-breakpoint
CREATE TABLE "hims"."self_pay_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"bill_basis" text NOT NULL,
	"net_paise" bigint NOT NULL,
	"insurer_paise" bigint NOT NULL,
	"patient_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "self_pay_review_amounts" CHECK ("hims"."self_pay_reviews"."net_paise">=0 and "hims"."self_pay_reviews"."insurer_paise">=0 and "hims"."self_pay_reviews"."patient_paise">=0 and "hims"."self_pay_reviews"."insurer_paise"+"hims"."self_pay_reviews"."patient_paise"="hims"."self_pay_reviews"."net_paise")
);
--> statement-breakpoint
CREATE TABLE "hims"."room_vacations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"nursing_seal_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"vacated_at" timestamp with time zone NOT NULL,
	"waiting_location" text NOT NULL,
	"handover" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."allocation_cancellations" ADD CONSTRAINT "allocation_cancellations_allocation_id_receipt_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "hims"."receipt_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipt_refunds" ADD CONSTRAINT "receipt_refunds_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipt_refunds" ADD CONSTRAINT "receipt_refunds_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."receipt_refunds" ADD CONSTRAINT "receipt_refunds_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "hims"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."self_pay_reviews" ADD CONSTRAINT "self_pay_reviews_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_vacations" ADD CONSTRAINT "room_vacations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_vacations" ADD CONSTRAINT "room_vacations_stay_id_room_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_vacations" ADD CONSTRAINT "room_vacations_nursing_seal_id_clearance_seals_id_fk" FOREIGN KEY ("nursing_seal_id") REFERENCES "hims"."clearance_seals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."room_vacations" ADD CONSTRAINT "room_vacations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cancel_once" ON "hims"."allocation_cancellations" USING btree ("allocation_id");--> statement-breakpoint
CREATE INDEX "refund_receipt" ON "hims"."receipt_refunds" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "refund_episode" ON "hims"."receipt_refunds" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_cash_identity" ON "hims"."receipt_refunds" USING btree ("hospital_id","mode","channel","source_reference");--> statement-breakpoint
CREATE INDEX "self_pay_review_episode" ON "hims"."self_pay_reviews" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_vacation_stay_once" ON "hims"."room_vacations" USING btree ("stay_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_vacation_episode_once" ON "hims"."room_vacations" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "room_vacation_nursing_seal" ON "hims"."room_vacations" USING btree ("nursing_seal_id");--> statement-breakpoint
CREATE INDEX "room_vacation_signer" ON "hims"."room_vacations" USING btree ("signed_by");