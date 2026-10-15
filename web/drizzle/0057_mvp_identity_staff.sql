-- Additive identity and staff operations. Existing accounts, identifiers and clinical evidence stay intact.
CREATE TABLE hims.doctor_directory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hims.doctor_directory_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id uuid NOT NULL REFERENCES hims.doctor_directory(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150), specialty text,
 active boolean NOT NULL, version integer NOT NULL CHECK(version>0), reason text NOT NULL CHECK(length(btrim(reason))>=3),
 recorded_by text NOT NULL REFERENCES hims.staff_user(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL, request_payload text NOT NULL,
 UNIQUE(doctor_id,version), UNIQUE(recorded_by,request_id)
);
CREATE TABLE hims.availability_coordinators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nurse_id text NOT NULL REFERENCES hims.staff_user(id), backup_nurse_id text REFERENCES hims.staff_user(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, version integer NOT NULL UNIQUE CHECK(version>0),
 reason text NOT NULL CHECK(length(btrim(reason))>=3), recorded_by text NOT NULL REFERENCES hims.staff_user(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL, request_payload text NOT NULL,
 CHECK(ends_at>starts_at), CHECK(backup_nurse_id IS NULL OR backup_nurse_id<>nurse_id), UNIQUE(recorded_by,request_id)
);
CREATE TABLE hims.doctor_availability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id uuid NOT NULL REFERENCES hims.doctor_directory(id),
 coordinator_id uuid NOT NULL REFERENCES hims.availability_coordinators(id), status text NOT NULL CHECK(status IN ('AVAILABLE','OT','LEAVE','OFF_DUTY')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, expected_return timestamptz,
 remarks text NOT NULL CHECK(length(btrim(remarks))>=3), version integer NOT NULL CHECK(version>0),
 recorded_by text NOT NULL REFERENCES hims.staff_user(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL, request_payload text NOT NULL,
 CHECK(ends_at>starts_at), CHECK(expected_return IS NULL OR expected_return>=starts_at), UNIQUE(doctor_id,version), UNIQUE(recorded_by,request_id)
);
CREATE INDEX doctor_directory_recorder_idx ON hims.doctor_directory_versions(recorded_by);
CREATE INDEX availability_coordinator_nurse_idx ON hims.availability_coordinators(nurse_id);
CREATE INDEX availability_coordinator_backup_idx ON hims.availability_coordinators(backup_nurse_id);
CREATE INDEX doctor_availability_coordinator_idx ON hims.doctor_availability(coordinator_id);

ALTER TABLE hims.admissions ALTER COLUMN admitting_doctor_id DROP NOT NULL;
ALTER TABLE hims.admissions ALTER COLUMN clinician_assessment DROP NOT NULL;
ALTER TABLE hims.admissions ADD COLUMN external_doctor_id uuid REFERENCES hims.doctor_directory(id);
CREATE INDEX admissions_external_doctor_idx ON hims.admissions(external_doctor_id);
ALTER TABLE hims.admissions ADD CONSTRAINT admission_version_doctor_identity CHECK (
 (workflow_version=1 AND admitting_doctor_id IS NOT NULL AND clinician_assessment IS NOT NULL AND external_doctor_id IS NULL)
 OR (workflow_version=2 AND external_doctor_id IS NOT NULL AND admitting_doctor_id IS NULL AND clinician_assessment IS NULL)
);

CREATE FUNCTION hims.guard_mvp_staff_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE coordinator hims.availability_coordinators; actor_role text; latest integer;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(729104211);
 SELECT role INTO actor_role FROM hims.staff_user WHERE id=NEW.recorded_by AND NOT coalesce(banned,false) FOR SHARE;
 IF actor_role IS NULL OR NEW.recorded_at>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active attributable staff required'; END IF;
 IF TG_TABLE_NAME='doctor_directory_versions' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('doctor-directory:'||NEW.doctor_id::text,0));
  SELECT coalesce(max(version),0) INTO latest FROM hims.doctor_directory_versions WHERE doctor_id=NEW.doctor_id;
  IF actor_role<>'ADMIN' OR NEW.version<>latest+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current Admin and next Doctor directory version required'; END IF;
 ELSIF TG_TABLE_NAME='availability_coordinators' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('availability-coordinator',0));
  SELECT coalesce(max(version),0) INTO latest FROM hims.availability_coordinators;
  IF actor_role<>'ADMIN' OR NEW.version<>latest+1
   OR NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.nurse_id AND role='NURSE' AND NOT coalesce(banned,false))
   OR (NEW.backup_nurse_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hims.staff_user WHERE id=NEW.backup_nurse_id AND role='NURSE' AND NOT coalesce(banned,false)))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Admin must designate active Nurse responsibility and backup'; END IF;
 ELSE
  -- The shared staff/roster lock and directory lock match the command lock order.
  PERFORM pg_advisory_xact_lock(hashtextextended('availability-coordinator',0));
  SELECT * INTO coordinator FROM hims.availability_coordinators WHERE starts_at<=clock_timestamp() AND ends_at>clock_timestamp() ORDER BY version DESC LIMIT 1;
  PERFORM pg_advisory_xact_lock(hashtextextended('doctor-directory:'||NEW.doctor_id::text,0));
  SELECT coalesce(max(version),0) INTO latest FROM hims.doctor_availability WHERE doctor_id=NEW.doctor_id;
  IF actor_role<>'NURSE' OR coordinator.id IS NULL OR NEW.coordinator_id IS DISTINCT FROM coordinator.id
   OR (NEW.recorded_by IS DISTINCT FROM coordinator.nurse_id AND NEW.recorded_by IS DISTINCT FROM coordinator.backup_nurse_id)
   OR NEW.starts_at<coordinator.starts_at OR NEW.ends_at>coordinator.ends_at OR NEW.version<>latest+1
   OR NOT coalesce((SELECT active FROM hims.doctor_directory_versions WHERE doctor_id=NEW.doctor_id ORDER BY version DESC LIMIT 1),false)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current designated Nurse and active Doctor availability version required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hims.preserve_mvp_staff_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Staff directory and availability history is append only'; END $$;
CREATE TRIGGER doctor_directory_immutable BEFORE UPDATE OR DELETE ON hims.doctor_directory FOR EACH ROW EXECUTE FUNCTION hims.preserve_mvp_staff_history();
CREATE TRIGGER doctor_directory_version_immutable BEFORE UPDATE OR DELETE ON hims.doctor_directory_versions FOR EACH ROW EXECUTE FUNCTION hims.preserve_mvp_staff_history();
CREATE TRIGGER doctor_directory_version_authority BEFORE INSERT ON hims.doctor_directory_versions FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_staff_event();
CREATE TRIGGER availability_coordinator_immutable BEFORE UPDATE OR DELETE ON hims.availability_coordinators FOR EACH ROW EXECUTE FUNCTION hims.preserve_mvp_staff_history();
CREATE TRIGGER availability_coordinator_authority BEFORE INSERT ON hims.availability_coordinators FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_staff_event();
CREATE TRIGGER doctor_availability_immutable BEFORE UPDATE OR DELETE ON hims.doctor_availability FOR EACH ROW EXECUTE FUNCTION hims.preserve_mvp_staff_history();
CREATE TRIGGER doctor_availability_authority BEFORE INSERT ON hims.doctor_availability FOR EACH ROW EXECUTE FUNCTION hims.guard_mvp_staff_event();
