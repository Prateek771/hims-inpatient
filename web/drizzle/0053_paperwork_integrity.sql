-- Domain history is insert-only at runtime. Native guards bind material effects to the exact reviewed proposal.
CREATE FUNCTION hims.guard_paperwork_packet() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, hims AS $$
DECLARE proposal hims.paperwork_proposals; review hims.paperwork_reviews; run hims.paperwork_runs;
BEGIN
 SELECT * INTO proposal FROM hims.paperwork_proposals WHERE id=NEW.proposal_id;
 SELECT * INTO review FROM hims.paperwork_reviews WHERE id=NEW.review_id;
 SELECT * INTO run FROM hims.paperwork_runs WHERE id=NEW.run_id;
 IF proposal.run_id IS DISTINCT FROM NEW.run_id OR review.run_id IS DISTINCT FROM NEW.run_id
 OR proposal.revision IS DISTINCT FROM review.revision OR review.decision IS DISTINCT FROM 'ACCEPT'
 OR NEW.packet IS DISTINCT FROM proposal.packet OR NEW.recorded_by IS DISTINCT FROM review.recorded_by
 OR run.pending_review_id IS DISTINCT FROM review.id OR run.status IS DISTINCT FROM 'PROCESSING' THEN
  RAISE EXCEPTION 'Packet requires its exact pending human acceptance' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paperwork_packet_guard BEFORE INSERT ON hims.paperwork_packets FOR EACH ROW EXECUTE FUNCTION hims.guard_paperwork_packet();
CREATE FUNCTION hims.guard_paperwork_followup() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, hims AS $$
DECLARE packet hims.paperwork_packets;
BEGIN
 SELECT * INTO packet FROM hims.paperwork_packets WHERE id=NEW.packet_id;
 IF packet.run_id IS DISTINCT FROM NEW.run_id OR packet.recorded_by IS DISTINCT FROM NEW.owner_id
 OR NEW.recorded_by IS DISTINCT FROM packet.recorded_by OR NEW.action IS DISTINCT FROM (packet.packet->>'staffNextAction') THEN
  RAISE EXCEPTION 'Follow-up requires its reviewed packet and accountable staff owner' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paperwork_followup_guard BEFORE INSERT ON hims.paperwork_followups FOR EACH ROW EXECUTE FUNCTION hims.guard_paperwork_followup();
REVOKE ALL ON FUNCTION hims.guard_paperwork_packet(), hims.guard_paperwork_followup() FROM PUBLIC;
