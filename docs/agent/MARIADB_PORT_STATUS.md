# MariaDB port: verified status (branch `codex/mariadb-port`, 7 November 2026)

Supersedes the early inventory in [MARIADB_PORT_BREAKAGES.md](MARIADB_PORT_BREAKAGES.md) (kept as history). Design
decisions: [conventions](MARIADB_PORT_CONVENTIONS.md) and [gaps](MARIADB_PORT_GAPS.md). Hosting: [Hostinger
deployment](../HOSTINGER_DEPLOYMENT.md). Nothing here changes the local PostgreSQL database, the `main` /
`codex/hims-development` branches, or any non-HIMS site.

## Checks run against MariaDB 11.8 (local `hims_test`, synthetic data only)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 32 unused-variable warnings in ported tests |
| Unit tests | 187 / 187 |
| Integration tests (`npm run test:integration`) | 173 / 174; the one failure needs a one-time root grant (below) |
| Browser tests (`npm run test:e2e`, Chromium, built app on port 3100) | 81 / 81 |
| Backup and restore (`npm run test:recovery`) | verified: 98 tables, 2,459 rows, 334 triggers, 9 routines, 6 views, 4 protected files identical after `mariadb-dump` restore |
| `npm audit` | 0 vulnerabilities (Next.js 16.4.5, zod 4.6.7) |
| GitHub Actions on this branch | not run yet (workflow ported to a `mariadb:11.8` service container) |

### The one open integration failure

`pilot-readiness.test.ts > reports unavailable when the runtime cannot record actual money` revokes and re-grants the
runtime account's `INSERT` as the test owner, so the owner needs `GRANT OPTION` on `hims_test`. The setup script and CI
now grant it. An existing local installation needs this once, run as the MariaDB administrator:

```sql
GRANT ALL ON hims_test.* TO 'hims_test_owner'@'127.0.0.1' WITH GRANT OPTION;
```

## Real defects the checks found and fixed during hosting

- Readiness query used `"'"`, which `ANSI_QUOTES` reads as a column name (live `/api/health/ready` was unavailable).
- Readiness could not see triggers with a restricted account: migration `0006_trigger_inventory.sql` adds a definer-rights
  function `hims_installed_triggers()`.
- `LIMIT` inside `IN (subquery)` in the Nurse workspace queue (MariaDB does not support it).
- A leftover PostgreSQL `interval '30 days'` in the discharge workspace query.
- Admission pages failed to load `@react-pdf/renderer` on Hostinger until dependencies were relinked at start-up.
- Recovery restored only 4 of 6 views because `mariadb-dump` restores views alphabetically over placeholder tables;
  views are now replayed from their definitions in dependency order.

## Behaviour that differs from PostgreSQL (tests were adapted, not weakened)

- `information_schema.INNODB_LOCK_WAITS` stays empty and `INNODB_TRX` never reports `LOCK WAIT` on 11.8. `TestClient`
  detects waiting sessions from `SHOW ENGINE INNODB STATUS` instead.
- InnoDB snapshot isolation (default on in 11.8) raises error 1020 where PostgreSQL raised `40001`; a raw trigger-driven
  writer that waited behind a committed change can also be refused with 1020. The refusal is safe (nothing is written) and
  `repeatable read` cases still require a serialization failure.
- SERIALIZABLE turns plain reads into shared locks, so one test reads its baseline from another session.
- PostgreSQL deferred constraint triggers have no equivalent. The commit-time rules run as explicit checks in
  `src/server/deferred-checks.ts` inside every command that can break them. Raw SQL that bypasses the application is not
  checked at `COMMIT`; tests call the same check functions explicitly.
- `jsonb` key re-ordering no longer happens: MariaDB stores JSON text exactly, so stored review inputs re-encode to the
  recorded review hash.
- The PostgreSQL "additive migration preflight" check has no counterpart: the baseline creates the guard triggers with the
  tables.
- `LOCK TABLES` replaces `LOCK TABLE ... ACCESS EXCLUSIVE` in the loading-state browser test.

## Not done

- No commit has been made; the whole port is working-tree changes on `codex/mariadb-port`.
- Real hospital data, backups/retention, TLS policy and provider decisions remain open owner decisions.
