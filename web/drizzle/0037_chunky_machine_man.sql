CREATE TABLE "hims"."patient_identifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date,
	"age_years_at_registration" integer,
	"sex" text NOT NULL,
	"phone" text,
	"evidence" text NOT NULL,
	"reason" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "identified_patient_age" CHECK (("hims"."patient_identifications"."date_of_birth" is not null) <> ("hims"."patient_identifications"."age_years_at_registration" is not null)),
	CONSTRAINT "identified_patient_values" CHECK ("hims"."patient_identifications"."sex" in ('FEMALE','MALE','OTHER','UNKNOWN') and ("hims"."patient_identifications"."age_years_at_registration" is null or "hims"."patient_identifications"."age_years_at_registration" between 0 and 130) and "hims"."patient_identifications"."version">0)
);
--> statement-breakpoint
ALTER TABLE "hims"."patients" DROP CONSTRAINT "patient_age_identity";--> statement-breakpoint
ALTER TABLE "hims"."patients" ADD COLUMN "identity_status" text DEFAULT 'KNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "hims"."patients" ADD COLUMN "identity_provenance" text;--> statement-breakpoint
ALTER TABLE "hims"."patient_identifications" ADD CONSTRAINT "patient_identifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "hims"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."patient_identifications" ADD CONSTRAINT "patient_identifications_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."patient_identifications" ADD CONSTRAINT "patient_identifications_exception_id_admin_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "hims"."admin_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."patient_identifications" ADD CONSTRAINT "patient_identifications_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_identification_version" ON "hims"."patient_identifications" USING btree ("patient_id","version");--> statement-breakpoint
CREATE INDEX "identification_episode" ON "hims"."patient_identifications" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "identification_authority" ON "hims"."patient_identifications" USING btree ("exception_id");--> statement-breakpoint
ALTER TABLE "hims"."patients" ADD CONSTRAINT "patient_identity_provenance" CHECK ("hims"."patients"."identity_status" in ('KNOWN','TEMPORARY') and ("hims"."patients"."identity_status"='KNOWN' or length(btrim("hims"."patients"."identity_provenance"))>=3));--> statement-breakpoint
ALTER TABLE "hims"."patients" ADD CONSTRAINT "patient_age_identity" CHECK ((("hims"."patients"."date_of_birth" is not null) <> ("hims"."patients"."age_years_at_registration" is not null)) or ("hims"."patients"."identity_status"='TEMPORARY' and "hims"."patients"."date_of_birth" is null and "hims"."patients"."age_years_at_registration" is null));--> statement-breakpoint
CREATE VIEW hims.effective_patients AS
 SELECT p.id,p.uhid,coalesce(i.name,p.name) name,CASE WHEN i.id IS NULL THEN p.identity_status ELSE 'KNOWN' END identity_status,
 coalesce(i.evidence,p.identity_provenance) identity_provenance,
 CASE WHEN i.id IS NULL THEN p.date_of_birth ELSE i.date_of_birth END date_of_birth,
 CASE WHEN i.id IS NULL THEN p.age_years_at_registration ELSE i.age_years_at_registration END age_years_at_registration,
 coalesce(i.sex,p.sex) sex,CASE WHEN i.id IS NULL THEN p.phone ELSE i.phone END phone,p.registered_at,p.registered_by,i.id identity_amendment_id
 FROM hims.patients p LEFT JOIN LATERAL (SELECT * FROM hims.patient_identifications x WHERE x.patient_id=p.id ORDER BY version DESC LIMIT 1) i ON true;
CREATE FUNCTION hims.guard_patient_identification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e hims.admissions; x hims.admin_exceptions;
BEGIN
 UPDATE hims.admissions SET version=version WHERE id=NEW.admission_id RETURNING * INTO e;
 PERFORM pg_advisory_xact_lock(hashtextextended('patient-identification:'||NEW.patient_id::text,0));
 SELECT * INTO x FROM hims.admin_exceptions WHERE id=NEW.exception_id;
 IF e.patient_id IS DISTINCT FROM NEW.patient_id OR x.admission_id IS DISTINCT FROM e.id OR x.type<>'URGENT_ADMISSION' OR x.disposition<>'ACTIVATE' OR NOT EXISTS(SELECT 1 FROM hims.patients WHERE id=NEW.patient_id AND identity_status='TEMPORARY') OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.signed_by AND role='ADMISSION' AND coalesce(banned,false)=false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attributable admission-desk identification requires original urgent authority'; END IF;
 IF NEW.version<>coalesce((SELECT max(version) FROM hims.patient_identifications WHERE patient_id=NEW.patient_id),0)+1 OR NEW.date_of_birth>CURRENT_DATE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Identity version or date is invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_identification_source BEFORE INSERT ON hims.patient_identifications FOR EACH ROW EXECUTE FUNCTION hims.guard_patient_identification();
CREATE TRIGGER patient_identification_immutable BEFORE UPDATE OR DELETE ON hims.patient_identifications FOR EACH ROW EXECUTE FUNCTION hims.preserve_billing_history();
CREATE TRIGGER patient_identification_clearance AFTER INSERT ON hims.patient_identifications FOR EACH ROW EXECUTE FUNCTION hims.invalidate_clearance_source('DOCTOR');
