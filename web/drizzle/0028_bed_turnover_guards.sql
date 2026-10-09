CREATE FUNCTION hims.guard_bed_turnover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t hims.bed_turnovers; s hims.room_stays;
BEGIN
 IF TG_TABLE_NAME='bed_holds' THEN
  PERFORM 1 FROM hims.beds WHERE id=NEW.bed_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM hims.bed_turnovers b LEFT JOIN hims.bed_turnover_completions c ON c.turnover_id=b.id WHERE b.bed_id=NEW.bed_id AND (c.id IS NULL OR c.completed_at>NEW.held_at)) THEN RAISE EXCEPTION 'Actual housekeeping completion required before bed reuse'; END IF;
 ELSIF TG_TABLE_NAME='bed_turnovers' THEN
  SELECT * INTO s FROM hims.room_stays WHERE id=NEW.stay_id;
  IF s.bed_id IS DISTINCT FROM NEW.bed_id OR s.admission_id IS DISTINCT FROM NEW.admission_id OR s.ended_at IS DISTINCT FROM NEW.vacated_at THEN RAISE EXCEPTION 'Turnover must reference the actual closed physical stay'; END IF;
 ELSE
  SELECT * INTO t FROM hims.bed_turnovers WHERE id=NEW.turnover_id;
  PERFORM 1 FROM hims.beds WHERE id=t.bed_id FOR UPDATE;
  IF NEW.completed_at<t.vacated_at OR NEW.completed_at>clock_timestamp() THEN RAISE EXCEPTION 'Cleaning completion must follow actual bed vacancy'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bed_hold_turnover_guard BEFORE INSERT ON hims.bed_holds FOR EACH ROW EXECUTE FUNCTION hims.guard_bed_turnover();
CREATE TRIGGER bed_turnover_source_guard BEFORE INSERT ON hims.bed_turnovers FOR EACH ROW EXECUTE FUNCTION hims.guard_bed_turnover();
CREATE TRIGGER bed_turnover_completion_guard BEFORE INSERT ON hims.bed_turnover_completions FOR EACH ROW EXECUTE FUNCTION hims.guard_bed_turnover();
