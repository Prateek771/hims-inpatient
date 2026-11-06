-- Hand-written immediate replacement for the stock/ledger half of the old commit-time rule: a stock update must
-- leave available_quantity equal to the append-only movement ledger. Commands therefore write the movement first.
-- TRIGGER name=pharmacy_stock_matches_ledger_upd table=pharmacy_batches timing=BEFORE event=UPDATE pg_name=50_pharmacy_stock_ledger
DROP TRIGGER IF EXISTS pharmacy_stock_matches_ledger_upd;
CREATE TRIGGER pharmacy_stock_matches_ledger_upd BEFORE UPDATE ON pharmacy_batches FOR EACH ROW
BEGIN
  IF NOT (NEW.available_quantity <=> OLD.available_quantity)
     AND NEW.available_quantity <> COALESCE((SELECT SUM(m.quantity) FROM pharmacy_movements m WHERE m.batch_id = NEW.id), 0) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Available stock must equal the append-only movement ledger';
  END IF;
END
-- END TRIGGER
-- TRIGGER name=lg_checkpoint_blobs_immutable_upd table=lg_checkpoint_blobs timing=BEFORE event=UPDATE pg_name=50_lg_immutable
DROP TRIGGER IF EXISTS lg_checkpoint_blobs_immutable_upd;
CREATE TRIGGER lg_checkpoint_blobs_immutable_upd BEFORE UPDATE ON lg_checkpoint_blobs FOR EACH ROW
BEGIN
  -- The checkpointer's INSERT ... ON DUPLICATE KEY UPDATE no-op is allowed; changing stored values is not.
  IF NOT (NEW.type <=> OLD.type AND NEW.`blob` <=> OLD.`blob`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkpoint blobs are append-only';
  END IF;
END
-- END TRIGGER
-- TRIGGER name=lg_checkpoint_blobs_immutable_del table=lg_checkpoint_blobs timing=BEFORE event=DELETE pg_name=50_lg_immutable
DROP TRIGGER IF EXISTS lg_checkpoint_blobs_immutable_del;
CREATE TRIGGER lg_checkpoint_blobs_immutable_del BEFORE DELETE ON lg_checkpoint_blobs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkpoint blobs are append-only';
END
-- END TRIGGER
-- TRIGGER name=lg_checkpoints_immutable_del table=lg_checkpoints timing=BEFORE event=DELETE pg_name=50_lg_immutable
DROP TRIGGER IF EXISTS lg_checkpoints_immutable_del;
CREATE TRIGGER lg_checkpoints_immutable_del BEFORE DELETE ON lg_checkpoints FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkpoints are retained';
END
-- END TRIGGER
-- TRIGGER name=lg_checkpoint_writes_immutable_del table=lg_checkpoint_writes timing=BEFORE event=DELETE pg_name=50_lg_immutable
DROP TRIGGER IF EXISTS lg_checkpoint_writes_immutable_del;
CREATE TRIGGER lg_checkpoint_writes_immutable_del BEFORE DELETE ON lg_checkpoint_writes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkpoint writes are retained';
END
-- END TRIGGER
