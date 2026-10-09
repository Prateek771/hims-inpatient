-- Preserve factual evidence in both insertion orders; never repair signed history.
LOCK TABLE hims.room_vacations, hims.nursing_shift_ends IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM hims.room_vacations v JOIN hims.nursing_shift_ends e ON e.shift_id=v.shift_id
    WHERE e.ended_at<v.vacated_at
  ) THEN RAISE EXCEPTION 'Existing vacancy falls outside recorded attendance; attributable correction is required before migration'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION hims.guard_vacancy_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
  SELECT admission_id INTO episode FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  -- Same owning-admission order as the staff commands. The value is unchanged, but
  -- both writers create an MVCC version: stale repeatable-read/serializable writers
  -- fail rather than inspecting an obsolete opposite-source snapshot after a lock wait.
  UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=episode;
  IF TG_TABLE_NAME='nursing_shift_ends' AND EXISTS (
    SELECT 1 FROM hims.room_vacations WHERE shift_id=NEW.shift_id AND vacated_at>NEW.ended_at
  ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shift end cannot precede recorded physical bed vacancy'; END IF;
  -- Existing room_vacation_physical_guard checks the opposite direction after this lock.
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_vacancy_guard BEFORE INSERT ON hims.room_vacations
  FOR EACH ROW EXECUTE FUNCTION hims.guard_vacancy_attendance();
CREATE TRIGGER attendance_vacancy_guard BEFORE INSERT ON hims.nursing_shift_ends
  FOR EACH ROW EXECUTE FUNCTION hims.guard_vacancy_attendance();
