-- Refuse inconsistent existing history. Never repair or silently shift factual boundaries.
-- The migration runner owns a transaction; block timeline writes through guard installation.
LOCK TABLE hims.room_stays IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM hims.room_stays a JOIN hims.room_stays b
      ON a.bed_id=b.bed_id AND a.id<b.id
    WHERE tstzrange(a.started_at,a.ended_at,'[)') && tstzrange(b.started_at,b.ended_at,'[)')
  ) THEN RAISE EXCEPTION 'Existing physical bed occupancy overlaps; attributable correction is required before migration'; END IF;
END $$;

CREATE FUNCTION hims.guard_physical_bed_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Relevant timeline writes only. Field values remain unchanged; updating this existing
  -- row serializes insert/close operations and also forces stale repeatable-read writers
  -- to fail instead of checking an old snapshot after waiting on a mere row lock.
  UPDATE hims.beds SET active=active WHERE id=NEW.bed_id;
  IF EXISTS (
    SELECT 1 FROM hims.room_stays s
    WHERE s.bed_id=NEW.bed_id AND s.id<>NEW.id
      AND tstzrange(s.started_at,s.ended_at,'[)') && tstzrange(NEW.started_at,NEW.ended_at,'[)')
  ) THEN RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Physical bed room stays cannot overlap'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER physical_bed_timeline_guard
  BEFORE INSERT OR UPDATE OF bed_id, started_at, ended_at ON hims.room_stays
  FOR EACH ROW EXECUTE FUNCTION hims.guard_physical_bed_timeline();
