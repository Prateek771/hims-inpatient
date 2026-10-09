-- Receipt source is the immutable physical batch plus qualified book/vendor/document/line reference.
-- Lock the cutover before inspecting history. Duplicates must be reviewed; never repair/delete them here.
LOCK TABLE hims.pharmacy_movements IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hims.pharmacy_movements WHERE kind='RECEIPT'
    GROUP BY batch_id,reference HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Duplicate physical pharmacy receipt sources; review retained history before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_receipt_source_once" ON "hims"."pharmacy_movements" USING btree ("batch_id","reference") WHERE "hims"."pharmacy_movements"."kind" = 'RECEIPT';--> statement-breakpoint
ALTER TABLE "hims"."pharmacy_movements" ADD CONSTRAINT "pharmacy_receipt_reference_canonical" CHECK ("hims"."pharmacy_movements"."kind" <> 'RECEIPT' or ("hims"."pharmacy_movements"."reference" = btrim("hims"."pharmacy_movements"."reference", chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) and length("hims"."pharmacy_movements"."reference") between 3 and 500));