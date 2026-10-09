-- Branch before resolving the table-specific NEW.ended_at field.
CREATE OR REPLACE FUNCTION hims.guard_vacancy_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
  SELECT admission_id INTO episode FROM hims.nursing_shifts WHERE id=NEW.shift_id;
  UPDATE hims.admissions SET bill_revision=bill_revision WHERE id=episode;
  IF TG_TABLE_NAME='nursing_shift_ends' THEN
    IF EXISTS (
      SELECT 1 FROM hims.room_vacations WHERE shift_id=NEW.shift_id AND vacated_at>NEW.ended_at
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shift end cannot precede recorded physical bed vacancy'; END IF;
  END IF;
  RETURN NEW;
END $$;
