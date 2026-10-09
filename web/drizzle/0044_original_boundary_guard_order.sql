-- Preserve the established immutable-history rejection before the stronger effective overlap check.
-- PostgreSQL runs same-kind triggers alphabetically; no guard is removed or changed.
ALTER TRIGGER room_boundary_preserved ON hims.room_stays RENAME TO immutable_room_boundary_preserved;
