-- LangGraph checkpointer library migration versions 0-4 (the lg_* tables themselves are in 0001_tables.sql).
-- The paperwork command code refuses to run unless exactly these versions are recorded.
INSERT IGNORE INTO lg_checkpoint_migrations (v) VALUES (0), (1), (2), (3), (4);

-- Well-known lock rows exist from the start so concurrent first use cannot race on creating them
-- (see src/server/locks.ts). Other lock keys are created on demand.
INSERT IGNORE INTO hims_locks (lock_key) VALUES ('729104211'), ('availability-coordinator');
