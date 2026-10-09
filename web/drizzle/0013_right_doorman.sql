CREATE TABLE "hims"."admission_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"old_stay_id" uuid NOT NULL,
	"new_stay_id" uuid NOT NULL,
	"old_bed_id" uuid NOT NULL,
	"target_bed_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"handover" text NOT NULL,
	"transferred_at" timestamp with time zone NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_transfers_transfer_order_id_unique" UNIQUE("transfer_order_id"),
	CONSTRAINT "admission_transfers_old_stay_id_unique" UNIQUE("old_stay_id"),
	CONSTRAINT "admission_transfers_new_stay_id_unique" UNIQUE("new_stay_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."transfer_insurance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"owner_role" text DEFAULT 'INSURANCE' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_insurance_tasks_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "hims"."transfer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"source_stay_id" uuid NOT NULL,
	"destination_category" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_transfer_order_id_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "hims"."transfer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_old_stay_id_room_stays_id_fk" FOREIGN KEY ("old_stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_new_stay_id_room_stays_id_fk" FOREIGN KEY ("new_stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_old_bed_id_beds_id_fk" FOREIGN KEY ("old_bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_target_bed_id_beds_id_fk" FOREIGN KEY ("target_bed_id") REFERENCES "hims"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_shift_id_nursing_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hims"."nursing_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."admission_transfers" ADD CONSTRAINT "admission_transfers_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_insurance_tasks" ADD CONSTRAINT "transfer_insurance_tasks_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_insurance_tasks" ADD CONSTRAINT "transfer_insurance_tasks_transfer_id_admission_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "hims"."admission_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_orders" ADD CONSTRAINT "transfer_orders_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_orders" ADD CONSTRAINT "transfer_orders_source_stay_id_room_stays_id_fk" FOREIGN KEY ("source_stay_id") REFERENCES "hims"."room_stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."transfer_orders" ADD CONSTRAINT "transfer_orders_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_transfers_episode_idx" ON "hims"."admission_transfers" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "transfer_insurance_tasks_episode_idx" ON "hims"."transfer_insurance_tasks" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "transfer_orders_episode_idx" ON "hims"."transfer_orders" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "transfer_orders_stay_idx" ON "hims"."transfer_orders" USING btree ("source_stay_id");
--> statement-breakpoint
CREATE FUNCTION hims.preserve_transfer_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Transfer history is immutable; append attributable correction evidence'; END $$;
CREATE TRIGGER transfer_orders_immutable BEFORE UPDATE OR DELETE ON hims.transfer_orders FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER admission_transfers_immutable BEFORE UPDATE OR DELETE ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER transfer_insurance_tasks_immutable BEFORE UPDATE OR DELETE ON hims.transfer_insurance_tasks FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();

CREATE FUNCTION hims.preserve_room_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'Closed room boundary is immutable; use attributable correction';
  END IF;
  IF NEW.admission_id IS DISTINCT FROM OLD.admission_id OR NEW.bed_id IS DISTINCT FROM OLD.bed_id OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.tariff_version_id IS DISTINCT FROM OLD.tariff_version_id OR NEW.posted_paise < OLD.posted_paise OR (OLD.last_reconciled_at IS NOT NULL AND (NEW.last_reconciled_at IS NULL OR NEW.last_reconciled_at < OLD.last_reconciled_at)) THEN
    RAISE EXCEPTION 'Room source, tariff pin and committed cursor are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER room_boundary_preserved BEFORE UPDATE ON hims.room_stays FOR EACH ROW EXECUTE FUNCTION hims.preserve_room_boundary();

CREATE FUNCTION hims.validate_transfer_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hims.room_stays previous_stay JOIN hims.room_stays next_stay ON next_stay.id=NEW.new_stay_id
    JOIN hims.transfer_orders o ON o.id=NEW.transfer_order_id
    JOIN hims.nursing_shifts s ON s.id=NEW.shift_id
    WHERE previous_stay.id=NEW.old_stay_id AND previous_stay.admission_id=NEW.admission_id AND next_stay.admission_id=NEW.admission_id
    AND o.admission_id=NEW.admission_id AND o.source_stay_id=previous_stay.id AND s.admission_id=NEW.admission_id AND s.nurse_id=NEW.signed_by
    AND previous_stay.bed_id=NEW.old_bed_id AND next_stay.bed_id=NEW.target_bed_id AND previous_stay.bed_id<>next_stay.bed_id
    AND previous_stay.ended_at=NEW.transferred_at AND next_stay.started_at=NEW.transferred_at
  ) THEN RAISE EXCEPTION 'Transfer must retain exact adjacent stays and episode/signature provenance'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exact_transfer_boundary BEFORE INSERT ON hims.admission_transfers FOR EACH ROW EXECUTE FUNCTION hims.validate_transfer_boundary();
