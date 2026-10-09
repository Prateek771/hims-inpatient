CREATE TABLE "hims"."pharmacy_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"medicine_id" text NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expires_on" date NOT NULL,
	"unit" text NOT NULL,
	"quantity_scale" integer NOT NULL,
	"barcode" text NOT NULL,
	"available_quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"reorder_threshold" numeric(18, 6),
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_stock_nonnegative" CHECK ("hims"."pharmacy_batches"."available_quantity" >= 0 and ("hims"."pharmacy_batches"."reorder_threshold" is null or "hims"."pharmacy_batches"."reorder_threshold" >= 0) and "hims"."pharmacy_batches"."quantity_scale" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "hims"."pharmacy_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"admission_id" uuid,
	"order_id" uuid,
	"kind" text NOT NULL,
	"purpose" text,
	"quantity" numeric(18, 6) NOT NULL,
	"original_issue_id" uuid,
	"charge_id" uuid,
	"reversal_id" uuid,
	"reference" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_movement_kind" CHECK (("hims"."pharmacy_movements"."kind" = 'RECEIPT' and "hims"."pharmacy_movements"."quantity">0 and "hims"."pharmacy_movements"."admission_id" is null and "hims"."pharmacy_movements"."order_id" is null and "hims"."pharmacy_movements"."original_issue_id" is null and "hims"."pharmacy_movements"."purpose" is null and "hims"."pharmacy_movements"."charge_id" is null and "hims"."pharmacy_movements"."reversal_id" is null) or ("hims"."pharmacy_movements"."kind" = 'ADJUSTMENT' and "hims"."pharmacy_movements"."quantity"<>0 and "hims"."pharmacy_movements"."admission_id" is null and "hims"."pharmacy_movements"."order_id" is null and "hims"."pharmacy_movements"."original_issue_id" is null and "hims"."pharmacy_movements"."purpose" is null and "hims"."pharmacy_movements"."charge_id" is null and "hims"."pharmacy_movements"."reversal_id" is null) or ("hims"."pharmacy_movements"."kind" = 'ISSUE' and "hims"."pharmacy_movements"."quantity"<0 and "hims"."pharmacy_movements"."admission_id" is not null and "hims"."pharmacy_movements"."order_id" is not null and "hims"."pharmacy_movements"."purpose" in ('WARD','TAKE_HOME') and "hims"."pharmacy_movements"."charge_id" is not null and "hims"."pharmacy_movements"."original_issue_id" is null and "hims"."pharmacy_movements"."reversal_id" is null) or ("hims"."pharmacy_movements"."kind" = 'RETURN' and "hims"."pharmacy_movements"."quantity">0 and "hims"."pharmacy_movements"."admission_id" is not null and "hims"."pharmacy_movements"."order_id" is not null and "hims"."pharmacy_movements"."purpose" in ('WARD','TAKE_HOME') and "hims"."pharmacy_movements"."charge_id" is not null and "hims"."pharmacy_movements"."original_issue_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "hims"."pharmacy_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"prescription_version_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_catalog_version_id_setting_versions_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "hims"."setting_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_batch_id_pharmacy_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "hims"."pharmacy_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_order_id_clinical_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "hims"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "hims"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_reversal_id_charge_reversals_id_fk" FOREIGN KEY ("reversal_id") REFERENCES "hims"."charge_reversals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_preparations" ADD CONSTRAINT "pharmacy_preparations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_preparations" ADD CONSTRAINT "pharmacy_preparations_prescription_version_id_clinical_summaries_id_fk" FOREIGN KEY ("prescription_version_id") REFERENCES "hims"."clinical_summaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_preparations" ADD CONSTRAINT "pharmacy_preparations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_batch_identity" ON "hims"."pharmacy_batches" USING btree ("hospital_id","medicine_id","batch_no");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_barcode_identity" ON "hims"."pharmacy_batches" USING btree ("hospital_id","barcode");--> statement-breakpoint
CREATE INDEX "pharmacy_batch_catalog_idx" ON "hims"."pharmacy_batches" USING btree ("catalog_version_id");--> statement-breakpoint
CREATE INDEX "pharmacy_movement_batch_idx" ON "hims"."pharmacy_movements" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "pharmacy_movement_episode_idx" ON "hims"."pharmacy_movements" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "pharmacy_movement_order_idx" ON "hims"."pharmacy_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pharmacy_return_issue_idx" ON "hims"."pharmacy_movements" USING btree ("original_issue_id");--> statement-breakpoint
CREATE INDEX "pharmacy_charge_idx" ON "hims"."pharmacy_movements" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "pharmacy_reversal_idx" ON "hims"."pharmacy_movements" USING btree ("reversal_id");--> statement-breakpoint
CREATE INDEX "pharmacy_preparation_episode_idx" ON "hims"."pharmacy_preparations" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "pharmacy_preparation_rx_idx" ON "hims"."pharmacy_preparations" USING btree ("prescription_version_id");
--> statement-breakpoint
ALTER TABLE hims.pharmacy_movements ADD CONSTRAINT pharmacy_return_source_fk FOREIGN KEY (original_issue_id) REFERENCES hims.pharmacy_movements(id);
CREATE TRIGGER pharmacy_movements_immutable BEFORE UPDATE OR DELETE ON hims.pharmacy_movements FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE TRIGGER pharmacy_preparations_immutable BEFORE UPDATE OR DELETE ON hims.pharmacy_preparations FOR EACH ROW EXECUTE FUNCTION hims.preserve_transfer_history();
CREATE FUNCTION hims.guard_pharmacy_batch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'available_quantity') IS DISTINCT FROM (to_jsonb(OLD)-'available_quantity') THEN
    RAISE EXCEPTION 'Medicine batch identity is immutable; append a new batch or audited movement';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pharmacy_batch_identity_immutable BEFORE UPDATE ON hims.pharmacy_batches FOR EACH ROW EXECUTE FUNCTION hims.guard_pharmacy_batch_identity();
CREATE FUNCTION hims.validate_pharmacy_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b hims.pharmacy_batches; original_issue hims.pharmacy_movements;
BEGIN
  SELECT * INTO STRICT b FROM hims.pharmacy_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF NEW.quantity <> round(NEW.quantity,b.quantity_scale) THEN RAISE EXCEPTION 'Quantity must use the exact configured stock scale'; END IF;
  IF NEW.kind IN ('ISSUE','RETURN') AND NOT EXISTS (
    SELECT 1 FROM hims.clinical_orders o JOIN hims.charges c ON c.id=NEW.charge_id
    WHERE o.id=NEW.order_id AND o.admission_id=NEW.admission_id AND o.kind='MEDICINE'
      AND o.medicine_item_id=b.medicine_id AND c.admission_id=NEW.admission_id AND c.category='medicine'
      AND c.item_id=b.medicine_id AND c.unit=b.unit
  ) THEN RAISE EXCEPTION 'Pharmacy movement must retain Doctor medicine and economic source identity'; END IF;
  IF NEW.kind='ISSUE' AND NOT EXISTS (SELECT 1 FROM hims.charges c WHERE c.id=NEW.charge_id AND c.source_event_id=NEW.id::text AND c.quantity::numeric=-NEW.quantity) THEN
    RAISE EXCEPTION 'Issue quantity must match its unique original medicine charge';
  END IF;
  IF NEW.kind='RETURN' THEN
    SELECT * INTO STRICT original_issue FROM hims.pharmacy_movements WHERE id=NEW.original_issue_id;
    IF original_issue.kind<>'ISSUE' OR original_issue.batch_id<>NEW.batch_id OR original_issue.admission_id<>NEW.admission_id OR original_issue.order_id<>NEW.order_id OR original_issue.charge_id<>NEW.charge_id OR original_issue.purpose<>NEW.purpose
       OR NEW.quantity + coalesce((SELECT sum(quantity) FROM hims.pharmacy_movements WHERE original_issue_id=original_issue.id),0)>-original_issue.quantity
       OR (NEW.reversal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hims.charge_reversals r WHERE r.id=NEW.reversal_id AND r.charge_id=NEW.charge_id)) THEN
      RAISE EXCEPTION 'Return must retain original issue and cannot exceed its net quantity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pharmacy_movement_source_guard BEFORE INSERT ON hims.pharmacy_movements FOR EACH ROW EXECUTE FUNCTION hims.validate_pharmacy_movement();
CREATE FUNCTION hims.check_pharmacy_stock_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id uuid;
BEGIN
  IF TG_TABLE_NAME='pharmacy_batches' THEN batch_id=NEW.id; ELSE batch_id=NEW.batch_id; END IF;
  IF NOT EXISTS(SELECT 1 FROM hims.pharmacy_batches b WHERE b.id=batch_id AND b.available_quantity=coalesce((SELECT sum(m.quantity) FROM hims.pharmacy_movements m WHERE m.batch_id=b.id),0)) THEN
    RAISE EXCEPTION 'Available stock must equal the append-only movement ledger';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pharmacy_stock_matches_ledger AFTER INSERT OR UPDATE ON hims.pharmacy_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hims.check_pharmacy_stock_ledger();
CREATE CONSTRAINT TRIGGER pharmacy_movement_matches_stock AFTER INSERT ON hims.pharmacy_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hims.check_pharmacy_stock_ledger();
