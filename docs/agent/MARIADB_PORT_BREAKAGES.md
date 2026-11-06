> Historical early inventory. Current verified state: [MARIADB_PORT_STATUS.md](MARIADB_PORT_STATUS.md).

# MariaDB port: breakage inventory after the data-layer foundation

Generated after converting `web/src/server/schema/*`, the per-domain `*schema.ts` files, `db.ts`, `auth.ts`, `drizzle.config.ts` and adding `locks.ts` (branch `codex/mariadb-port`). Baseline before the foundation: 0 `tsc` errors. After: **252** errors in 46 files, none in schema, db, auth, locks or config files.

**tsc only sees a fraction of the work.** Raw `sql` template strings are untyped, so the pattern inventory (section 2: a grep over `web/src`, `web/scripts`, `web/tests`; `drizzle/` and `drizzle-maria/` excluded) is the real worklist. Counts are regex hits, so treat them as an upper bound. Suggested agent split: groups A to H below (by directory), each owning its files for every pattern.

## 1. tsc errors by file

Total 252. Error kinds: rows 76, implicit any (follow-on) 19, returning 92, assignability 59, onConflict 6.

### A. admissions + billing (28 errors, 4 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/src/server/billing/commands.ts` | 12 | returning 8, rows 3, onConflict 1 |
| `web/src/server/admissions/commands.ts` | 11 | onConflict 3, rows 5, returning 3 |
| `web/src/server/billing/room-charges.ts` | 3 | rows 1, returning 2 |
| `web/src/server/admissions/transfer-authority.ts` | 2 | rows 1, implicit any (follow-on) 1 |

### B. clinical + nursing + lab + pharmacy (28 errors, 4 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/src/server/clinical/commands.ts` | 8 | returning 7, onConflict 1 |
| `web/src/server/nursing/commands.ts` | 8 | returning 8 |
| `web/src/server/lab/commands.ts` | 7 | returning 6, onConflict 1 |
| `web/src/server/pharmacy/commands.ts` | 5 | returning 5 |

### C. discharge + documents (65 errors, 9 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/src/server/discharge/exceptions.ts` | 18 | rows 9, implicit any (follow-on) 2, returning 7 |
| `web/src/server/discharge/exception-physical.ts` | 14 | rows 9, returning 5 |
| `web/src/server/documents/snapshot.ts` | 9 | rows 8, implicit any (follow-on) 1 |
| `web/src/server/discharge/dependencies.ts` | 8 | rows 1, implicit any (follow-on) 7 |
| `web/src/server/discharge/commands.ts` | 5 | rows 1, returning 4 |
| `web/src/server/discharge/exception-corrections.ts` | 5 | rows 1, returning 4 |
| `web/src/server/discharge/exception-workspace.ts` | 4 | rows 2, implicit any (follow-on) 2 |
| `web/src/server/documents/commands.ts` | 1 | rows 1 |
| `web/src/server/documents/mvp.ts` | 1 | rows 1 |

### D. mvp + insurance (44 errors, 9 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/src/server/mvp/commands.ts` | 9 | rows 3, returning 6 |
| `web/src/server/insurance/commands.ts` | 8 | returning 8 |
| `web/src/server/mvp/exceptions.ts` | 8 | returning 5, rows 3 |
| `web/src/server/insurance/paperwork-commands.ts` | 5 | returning 5 |
| `web/src/server/mvp/workspace.ts` | 5 | rows 5 |
| `web/src/server/mvp/staff.ts` | 3 | returning 3 |
| `web/src/server/mvp/transfers.ts` | 3 | returning 2, rows 1 |
| `web/src/server/mvp/dependencies.ts` | 2 | rows 2 |
| `web/src/server/insurance/documents.ts` | 1 | returning 1 |

### E. server root + app (16 errors, 5 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/src/app/(staff)/mvp/[admissionId]/page.tsx` | 5 | implicit any (follow-on) 5 |
| `web/src/server/overview.ts` | 4 | rows 4 |
| `web/src/server/readiness.ts` | 4 | rows 3, implicit any (follow-on) 1 |
| `web/src/server/settings.ts` | 2 | returning 2 |
| `web/src/server/audit.ts` | 1 | returning 1 |

### H. tests/ (71 errors, 15 files)

| File | Errors | Main kinds |
|---|---|---|
| `web/tests/integration/transfer.test.ts` | 16 | assignability 16 |
| `web/tests/integration/exceptions.test.ts` | 9 | assignability 9 |
| `web/tests/support/inpatient-journey-fixture.ts` | 9 | rows 9 |
| `web/tests/integration/care.test.ts` | 8 | assignability 8 |
| `web/tests/integration/lab.test.ts` | 7 | assignability 7 |
| `web/tests/integration/discharge.test.ts` | 4 | assignability 4 |
| `web/tests/integration/transfer-temporal.test.ts` | 4 | assignability 4 |
| `web/tests/integration/database.test.ts` | 3 | assignability 3 |
| `web/tests/integration/final-review.test.ts` | 3 | assignability 3 |
| `web/tests/integration/pharmacy.test.ts` | 3 | assignability 3 |
| `web/tests/integration/billing.test.ts` | 1 | rows 1 |
| `web/tests/integration/documents.test.ts` | 1 | assignability 1 |
| `web/tests/integration/insurance.test.ts` | 1 | assignability 1 |
| `web/tests/support/auth-fixture-entry.ts` | 1 | rows 1 |
| `web/tests/support/final-review-browser-fixture.ts` | 1 | rows 1 |

## 2. Pattern inventory (grep hits and files with counts)

Headlines: .returning(): 128 hits / 31 files; tx.execute() result shape: 674 hits / 68 files; pg_advisory_xact_lock becomes acquireTxLock: 70 hits / 29 files; hashtextextended(): 40 hits / 15 files; jsonb operators and functions: 23 hits / 11 files; Row locking clauses: 12 hits / 6 files; ON CONFLICT becomes ON DUPLICATE KEY UPDATE: 7 hits / 5 files; tstzrange and range operators: 6 hits / 3 files; Isolation level and read-only snapshot transactions: 28 hits / 11 files; PostgreSQL error codes: 94 hits / 46 files; PostgreSQL casts: 267 hits / 36 files; Time and UUID functions: 98 hits / 33 files; Array and aggregate functions: 349 hits / 95 files; PostgreSQL catalog and privilege introspection: 75 hits / 15 files; hims. schema prefix inside SQL text: 1039 hits / 60 files; Direct pg, pg-core and LangGraph Postgres imports: 92 hits / 27 files; Connection URLs, roles, PostgreSQL tools: 300 hits / 57 files.

### `.returning()` (MySQL core has no RETURNING)

31 files, 128 hits. Drizzle's MySQL builders do not offer `.returning()`. Generate UUIDs in the app (`crypto.randomUUID()`) before inserting so the id is known, then re-select by key; use raw `INSERT ... RETURNING` (MariaDB 10.5+) through `tx.execute(sql...)` where one round trip matters. For UPDATE: `SELECT ... FOR UPDATE`, update, re-select.

Files: `tests/support/auth-fixture-entry.ts` (11), `src/server/billing/commands.ts` (9), `src/server/clinical/commands.ts` (8), `src/server/insurance/commands.ts` (8), `src/server/nursing/commands.ts` (8), `src/server/discharge/exceptions.ts` (7), `src/server/admissions/commands.ts` (6), `src/server/lab/commands.ts` (6), `src/server/mvp/commands.ts` (6), `src/server/mvp/exceptions.ts` (6), `tests/integration/final-review-native.test.ts` (6), `src/server/discharge/commands.ts` (5), `src/server/discharge/exception-physical.ts` (5), `src/server/insurance/paperwork-commands.ts` (5), `src/server/pharmacy/commands.ts` (5), `src/server/discharge/exception-corrections.ts` (4), `tests/integration/exceptions.test.ts` (4), `src/server/mvp/staff.ts` (3), `src/server/billing/room-charges.ts` (2), `src/server/mvp/transfers.ts` (2), `src/server/settings.ts` (2), `src/app/(staff)/discharge/page.tsx` (1), `src/server/audit.ts` (1), `src/server/insurance/documents.ts` (1), `tests/e2e/exceptions.spec.ts` (1), `tests/integration/discharge.test.ts` (1), `tests/integration/documents.test.ts` (1), `tests/integration/lab.test.ts` (1), `tests/integration/mvp-services.test.ts` (1), `tests/integration/mvp-workflow.test.ts` (1), `tests/support/documents-long-stay.ts` (1)

### `tx.execute()` result shape (`.rows` becomes an array)

68 files, 674 hits. node-postgres returned `{ rows }`. drizzle mysql2 `execute` returns `[rows, fields]` for SELECT and `[ResultSetHeader, undefined]` for INSERT/UPDATE. Replace `.rows` with `(await tx.execute(...))[0]`, ideally through one shared helper. Date columns in raw results are `YYYY-MM-DD HH:MM:SS.ffffff` UTC strings; BIGINT and DECIMAL are strings; JSON is a string.

Files: `tests/integration/exceptions.test.ts` (83), `tests/integration/discharge.test.ts` (52), `tests/integration/pharmacy.test.ts` (34), `tests/integration/paperwork.test.ts` (32), `tests/integration/transfer.test.ts` (29), `src/server/discharge/exceptions.ts` (27), `tests/integration/transfer-temporal.test.ts` (27), `tests/integration/final-review.test.ts` (24), `tests/integration/documents.test.ts` (22), `src/server/discharge/exception-physical.ts` (21), `tests/integration/care.test.ts` (18), `tests/integration/lab.test.ts` (18), `src/server/documents/snapshot.ts` (17), `tests/integration/billing.test.ts` (17), `tests/integration/mvp-workflow.test.ts` (17), `scripts/recovery.mjs` (16), `src/server/admissions/commands.ts` (15), `src/server/billing/commands.ts` (12), `tests/integration/overview.test.ts` (11), `tests/support/inpatient-journey-fixture.ts` (11), `src/server/mvp/workspace.ts` (10), `tests/integration/admission.test.ts` (10), `src/server/overview.ts` (8), `tests/integration/insurance.test.ts` (8), `tests/integration/mvp-staff.test.ts` (8), `src/server/discharge/commands.ts` (7), `src/server/mvp/commands.ts` (7), `tests/integration/mvp-transfer.test.ts` (7), `src/server/documents/pdf.tsx` (6), `src/server/readiness.ts` (6), `tests/integration/final-review-native.test.ts` (6), `src/app/(staff)/insurance/page.tsx` (5), `src/server/discharge/exception-workspace.ts` (5), `src/server/mvp/dependencies.ts` (5), `src/server/mvp/exceptions.ts` (5), `src/server/mvp/staff.ts` (5), `tests/integration/access.test.ts` (5), `tests/support/documents-long-stay.ts` (5), `tests/integration/database.test.ts` (4), `src/server/discharge/dependencies.ts` (3), `src/server/documents/mvp.ts` (3), `src/server/locks.ts` (3), `src/server/mvp/transfers.ts` (3), `tests/integration/mvp-self-pay.test.ts` (3), `src/components/discharge-copy.tsx` (2), `src/server/admissions/transfer-authority.ts` (2), `src/server/billing/room-charges.ts` (2), `src/server/discharge/exception-corrections.ts` (2), `src/server/documents/commands.ts` (2), `src/server/insurance/commands.ts` (2), `src/server/pharmacy/commands.ts` (2), `src/server/staff.ts` (2), `tests/support/auth-fixture-entry.ts` (2), `tests/support/final-review-browser-fixture.ts` (2), `src/server/billing/room-worker.ts` (1), `src/server/bootstrap.ts` (1), `src/server/clinical/commands.ts` (1), `src/server/lab/commands.ts` (1), `src/server/settings.ts` (1), `scripts/demo-hospital.mjs` (1), `scripts/migrate.ts` (1), `scripts/paperwork-checkpointer.ts` (1), `tests/e2e/paperwork.spec.ts` (1), `tests/e2e/role-workspaces.spec.ts` (1), `tests/integration/admin-bounds.test.ts` (1), `tests/integration/mvp-medicine.test.ts` (1), `tests/integration/mvp-services.test.ts` (1), `tests/integration/test-database-lifecycle.test.ts` (1)

### `pg_advisory_xact_lock` becomes `acquireTxLock`

29 files, 70 hits. Use `acquireTxLock(tx, key, 'exclusive' | 'shared')` from `web/src/server/locks.ts` (needs the `hims_locks` table from the DDL agent). Keep the original key strings; drop `hashtextextended(key, 0)` wrappers and lock on the key itself.

Files: `src/server/discharge/exceptions.ts` (9), `src/server/billing/commands.ts` (6), `src/server/admissions/commands.ts` (5), `src/server/discharge/commands.ts` (5), `src/server/mvp/staff.ts` (5), `scripts/test-database.ts` (4), `src/server/discharge/exception-physical.ts` (3), `tests/integration/transfer.test.ts` (3), `src/server/insurance/commands.ts` (2), `src/server/insurance/paperwork-commands.ts` (2), `src/server/locks.ts` (2), `src/server/pharmacy/commands.ts` (2), `src/server/staff.ts` (2), `scripts/migrate.ts` (2), `scripts/paperwork-checkpointer.ts` (2), `scripts/recovery.mjs` (2), `tests/integration/discharge.test.ts` (2), `src/server/billing/room-worker.ts` (1), `src/server/bootstrap.ts` (1), `src/server/clinical/commands.ts` (1), `src/server/documents/mvp.ts` (1), `src/server/documents/snapshot.ts` (1), `src/server/lab/commands.ts` (1), `src/server/mvp/commands.ts` (1), `src/server/mvp/transfers.ts` (1), `src/server/settings.ts` (1), `tests/integration/insurance.test.ts` (1), `tests/integration/pharmacy.test.ts` (1), `tests/integration/transfer-temporal.test.ts` (1)

### `hashtextextended()`

15 files, 40 hits. No equivalent. Normally paired with advisory locks (previous item). If the hash value is stored, use `SHA2(key, 256)` or compute it in TypeScript.

Files: `src/server/discharge/exceptions.ts` (9), `src/server/billing/commands.ts` (6), `src/server/mvp/staff.ts` (5), `src/server/discharge/commands.ts` (4), `src/server/admissions/commands.ts` (3), `src/server/discharge/exception-physical.ts` (3), `src/server/insurance/paperwork-commands.ts` (2), `src/server/billing/room-worker.ts` (1), `src/server/documents/mvp.ts` (1), `src/server/documents/snapshot.ts` (1), `src/server/insurance/commands.ts` (1), `src/server/mvp/commands.ts` (1), `src/server/mvp/transfers.ts` (1), `src/server/pharmacy/commands.ts` (1), `tests/integration/paperwork.test.ts` (1)

### jsonb operators and functions

11 files, 23 hits. `->>` becomes `JSON_VALUE(col, '$.path')`; `->` becomes `JSON_QUERY`; `jsonb_build_object` becomes `JSON_OBJECT`; `jsonb_build_array` becomes `JSON_ARRAY`; `@>` becomes `JSON_CONTAINS` or an app-side comparison; `::jsonb` casts are removed. Drizzle parses `json` columns in ORM queries, but raw `execute` results are strings: `JSON.parse` them.

Files: `tests/integration/mvp-workflow.test.ts` (7), `src/server/overview.ts` (4), `scripts/recovery.mjs` (2), `tests/integration/discharge.test.ts` (2), `tests/support/documents-long-stay.ts` (2), `src/server/discharge/dependencies.ts` (1), `src/server/documents/mvp.ts` (1), `src/server/documents/snapshot.ts` (1), `src/server/mvp/workspace.ts` (1), `tests/integration/billing.test.ts` (1), `tests/integration/mvp-self-pay.test.ts` (1)

### Row locking clauses

6 files, 12 hits. `FOR UPDATE` works. `FOR NO KEY UPDATE` becomes `FOR UPDATE`; `FOR SHARE` / `FOR KEY SHARE` become `LOCK IN SHARE MODE`. `SKIP LOCKED` works on MariaDB 10.6+.

Files: `tests/integration/discharge.test.ts` (4), `tests/integration/transfer-temporal.test.ts` (3), `tests/integration/transfer.test.ts` (2), `src/server/locks.ts` (1), `tests/integration/care.test.ts` (1), `tests/integration/insurance.test.ts` (1)

### `ON CONFLICT` becomes `ON DUPLICATE KEY UPDATE`

5 files, 7 hits. `.onConflictDoNothing()` becomes `.onDuplicateKeyUpdate({ set: { id: sql`id` } })` (plain `.ignore()` also hides unrelated errors). `.onConflictDoUpdate({ target, set })` becomes `.onDuplicateKeyUpdate({ set })`. In raw SQL, `ON CONFLICT (...) DO ...` becomes `ON DUPLICATE KEY UPDATE col = VALUES(col)`. MariaDB fires on any unique key, not just the named target: check which unique keys the table has.

Files: `src/server/admissions/commands.ts` (3), `src/server/billing/commands.ts` (1), `src/server/clinical/commands.ts` (1), `src/server/lab/commands.ts` (1), `src/server/mvp/dependencies.ts` (1)

### `tstzrange` and range operators

3 files, 6 hits. Replace with explicit comparisons (`a_start < b_end AND a_end > b_start`, NULL end as +infinity via `COALESCE`). Exclusion constraints become triggers or app transaction checks (record in `MARIADB_PORT_GAPS.md`).

Files: `src/server/discharge/exception-physical.ts` (2), `tests/integration/mvp-transfer.test.ts` (2), `tests/integration/transfer-temporal.test.ts` (2)

### Isolation level and read-only snapshot transactions

11 files, 28 hits. Session default is READ COMMITTED (set by `db.ts`). Snapshot reads use `db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' })`, which the MySQL driver supports. Raw `SET TRANSACTION ...` issued after the first statement is rejected by MariaDB.

Files: `src/server/overview.ts` (6), `src/server/mvp/commands.ts` (3), `src/server/mvp/workspace.ts` (3), `scripts/demo-hospital.mjs` (3), `scripts/recovery.mjs` (3), `tests/integration/discharge.test.ts` (3), `tests/integration/exceptions.test.ts` (2), `tests/integration/transfer-temporal.test.ts` (2), `src/app/(staff)/clinical/page.tsx` (1), `src/app/(staff)/nursing/page.tsx` (1), `src/server/db.ts` (1)

### PostgreSQL error codes

46 files, 94 hits. `23505` becomes errno 1062 (`ER_DUP_ENTRY`); `23503` becomes 1451/1452; `23514` (CHECK) becomes 4025; `P0001` (RAISE) becomes 1644 (SIGNAL, text in `sqlMessage`); `40001`/`40P01` become 1213 (deadlock) / 1205 (lock wait timeout). mysql2 errors carry `errno`, `code`, `sqlState`, `sqlMessage`; drizzle wraps them in `DrizzleQueryError` with the original in `cause`. Add one shared `isDuplicateKey(error)` helper.

Files: `tests/integration/exceptions.test.ts` (10), `tests/integration/mvp-workflow.test.ts` (7), `tests/integration/discharge.test.ts` (5), `tests/integration/final-review.test.ts` (5), `src/server/admissions/commands.ts` (4), `tests/integration/pharmacy.test.ts` (4), `src/server/billing/commands.ts` (3), `src/server/clinical/commands.ts` (3), `tests/integration/mvp-services.test.ts` (3), `src/app/(staff)/exceptions/page.tsx` (2), `src/app/(staff)/nursing/page.tsx` (2), `src/app/(staff)/pharmacy/actions.ts` (2), `src/components/admission-forms.tsx` (2), `src/server/discharge/exception-physical.ts` (2), `src/server/documents/commands.ts` (2), `src/server/settings.ts` (2), `tests/integration/database.test.ts` (2), `tests/integration/final-review-native.test.ts` (2), `tests/integration/mvp-staff.test.ts` (2), `tests/integration/mvp-transfer.test.ts` (2), `tests/integration/paperwork.test.ts` (2), `tests/support/auth-fixture-entry.ts` (2), `src/app/(staff)/admin/settings/page.tsx` (1), `src/app/(staff)/admin/staff/page.tsx` (1), `src/app/(staff)/billing/page.tsx` (1), `src/app/(staff)/clinical/page.tsx` (1), `src/app/(staff)/discharge/page.tsx` (1), `src/app/(staff)/documents/page.tsx` (1), `src/app/(staff)/documents/[documentId]/page.tsx` (1), `src/app/(staff)/documents/[documentId]/print/page.tsx` (1), `src/app/(staff)/documents/[documentId]/verify/page.tsx` (1), `src/app/(staff)/insurance/page.tsx` (1), `src/app/(staff)/lab/page.tsx` (1), `src/app/(staff)/lab/samples/[sampleId]/label/page.tsx` (1), `src/app/(staff)/mvp/[admissionId]/page.tsx` (1), `src/app/(staff)/patients/[admissionId]/page.tsx` (1), `src/app/(staff)/pharmacy/page.tsx` (1), `src/components/mvp-transfers.tsx` (1), `src/server/mvp/transfers.ts` (1), `src/server/overview.ts` (1), `src/server/protected-storage.ts` (1), `scripts/bootstrap-local-database.mjs` (1), `tests/e2e/billing.spec.ts` (1), `tests/integration/documents.test.ts` (1), `tests/integration/transfer-temporal.test.ts` (1), `tests/support/restored-verification-entry.ts` (1)

### PostgreSQL casts (`::type`)

36 files, 267 hits. Remove or convert: `::text` to `CAST(x AS CHAR)`, `::int`/`::bigint` to `CAST(x AS SIGNED)`, `::numeric` to `CAST(x AS DECIMAL(p,s))`, `::uuid` dropped, `::date` to `DATE(x)`, `::timestamptz` dropped.

Files: `tests/integration/exceptions.test.ts` (39), `tests/integration/discharge.test.ts` (27), `tests/integration/paperwork.test.ts` (22), `src/server/discharge/exception-workspace.ts` (16), `tests/integration/documents.test.ts` (16), `tests/integration/pharmacy.test.ts` (14), `tests/integration/lab.test.ts` (12), `tests/integration/final-review.test.ts` (11), `tests/integration/mvp-workflow.test.ts` (11), `tests/integration/admission.test.ts` (10), `tests/integration/billing.test.ts` (10), `tests/integration/transfer-temporal.test.ts` (10), `tests/integration/transfer.test.ts` (7), `scripts/recovery.mjs` (6), `tests/integration/care.test.ts` (5), `tests/integration/mvp-transfer.test.ts` (5), `src/server/mvp/workspace.ts` (4), `src/server/overview.ts` (4), `src/server/pharmacy/commands.ts` (4), `tests/integration/insurance.test.ts` (4), `tests/integration/mvp-services.test.ts` (4), `tests/integration/database.test.ts` (3), `tests/support/inpatient-journey-fixture.ts` (3), `src/server/discharge/dependencies.ts` (2), `src/server/discharge/exception-physical.ts` (2), `scripts/bootstrap-local-database.mjs` (2), `tests/integration/access.test.ts` (2), `tests/integration/mvp-self-pay.test.ts` (2), `tests/integration/mvp-staff.test.ts` (2), `tests/support/documents-long-stay.ts` (2), `src/server/billing/room-charges.ts` (1), `src/server/mvp/commands.ts` (1), `src/server/mvp/transfers.ts` (1), `tests/e2e/paperwork.spec.ts` (1), `tests/integration/mvp-medicine.test.ts` (1), `tests/integration/overview.test.ts` (1)

### Time and UUID functions

33 files, 98 hits. `now()`, `clock_timestamp()`, `current_timestamp` become `UTC_TIMESTAMP(6)`; `gen_random_uuid()` becomes `uuid()`. Prefer passing `new Date()` or `crypto.randomUUID()` from the app when TypeScript also needs the value.

Files: `tests/support/inpatient-journey-fixture.ts` (15), `scripts/demo-hospital.ts` (8), `tests/integration/documents.test.ts` (8), `tests/integration/exceptions.test.ts` (7), `tests/integration/billing.test.ts` (6), `tests/e2e/insurance.spec.ts` (4), `tests/integration/mvp-staff.test.ts` (4), `tests/integration/transfer.test.ts` (4), `src/server/clinical/commands.ts` (3), `src/server/schema/columns.ts` (3), `tests/e2e/billing.spec.ts` (3), `tests/integration/care.test.ts` (3), `tests/integration/transfer-temporal.test.ts` (3), `src/server/admissions/commands.ts` (2), `src/server/mvp/staff.ts` (2), `tests/e2e/admission.spec.ts` (2), `tests/e2e/role-workspaces.spec.ts` (2), `tests/integration/discharge.test.ts` (2), `tests/integration/mvp-services.test.ts` (2), `tests/integration/paperwork.test.ts` (2), `src/server/billing/room-charges.ts` (1), `src/server/discharge/commands.ts` (1), `scripts/migrate.ts` (1), `tests/e2e/approved-role-ui.spec.ts` (1), `tests/e2e/mvp.spec.ts` (1), `tests/e2e/pharmacy.spec.ts` (1), `tests/e2e/staff-access.spec.ts` (1), `tests/integration/admission.test.ts` (1), `tests/integration/final-review-native.test.ts` (1), `tests/integration/final-review.test.ts` (1), `tests/integration/lab.test.ts` (1), `tests/support/auth-fixture-entry.ts` (1), `tests/support/documents-browser-fixture.ts` (1)

### Array and aggregate functions

95 files, 349 hits. `array_agg` becomes `JSON_ARRAYAGG`; `string_agg` becomes `GROUP_CONCAT(... SEPARATOR ...)`; `= ANY(array)` becomes `IN (...)` with `sql.join`; `ILIKE` becomes `LIKE`; `generate_series`, `date_trunc`, `AT TIME ZONE`, `extract(epoch ...)` become sequence tables, `DATE_FORMAT`, `CONVERT_TZ`, `UNIX_TIMESTAMP`; `FILTER (WHERE ...)` becomes `SUM(CASE WHEN ...)`.

Files: `src/server/overview.ts` (24), `tests/integration/overview.test.ts` (20), `src/app/(staff)/nursing/page.tsx` (19), `src/server/billing/commands.ts` (16), `src/server/mvp/workspace.ts` (14), `src/app/(staff)/clinical/page.tsx` (11), `tests/support/auth-fixture-entry.ts` (11), `src/app/(staff)/billing/page.tsx` (9), `tests/e2e/billing.spec.ts` (9), `tests/integration/documents.test.ts` (9), `src/server/pharmacy/commands.ts` (8), `tests/integration/care.test.ts` (8), `src/components/mvp-exceptions.tsx` (7), `src/app/(staff)/exceptions/page.tsx` (6), `src/app/(staff)/insurance/page.tsx` (6), `src/components/mvp-financial-corrections.tsx` (6), `tests/e2e/mvp.spec.ts` (6), `tests/integration/paperwork.test.ts` (6), `src/app/(staff)/mvp/[admissionId]/page.tsx` (5), `src/components/exception-forms.tsx` (5), `src/components/mvp-workspace.tsx` (5), `src/server/clinical/commands.ts` (5), `tests/integration/admission.test.ts` (5), `src/app/(staff)/lab/page.tsx` (4), `src/app/(staff)/pharmacy/page.tsx` (4), `src/server/admissions/commands.ts` (4), `tests/e2e/discharge.spec.ts` (4), `tests/e2e/insurance.spec.ts` (4), `tests/integration/discharge.test.ts` (4), `src/app/(staff)/admissions/page.tsx` (3), `src/app/(staff)/discharge/page.tsx` (3), `src/components/mvp-workspace-summary.tsx` (3), `src/server/billing/room-charges.ts` (3), `src/server/insurance/paperwork-commands.ts` (3), `scripts/recovery.mjs` (3), `tests/e2e/transfer.spec.ts` (3), `tests/integration/billing.test.ts` (3), `tests/integration/mvp-services.test.ts` (3), `tests/integration/transfer.test.ts` (3), `src/app/(staff)/admin/beds/page.tsx` (2), `src/app/(staff)/availability/page.tsx` (2), `src/components/care-forms.tsx` (2), `src/components/mvp-transfers.tsx` (2), `src/components/searchable-select.tsx` (2), `src/components/settings-forms.tsx` (2), `src/server/documents/model.ts` (2), `scripts/bootstrap-local-database.mjs` (2), `tests/e2e/admission.spec.ts` (2), `tests/e2e/approved-role-ui.spec.ts` (2), `tests/e2e/care.spec.ts` (2), `tests/e2e/lab.spec.ts` (2), `tests/e2e/staff-access.spec.ts` (2), `tests/integration/exceptions.test.ts` (2), `tests/integration/final-review.test.ts` (2), `tests/integration/lab.test.ts` (2), `tests/integration/mvp-medicine.test.ts` (2), `tests/integration/pharmacy.test.ts` (2), `tests/support/inpatient-journey-fixture.ts` (2), `src/app/(staff)/documents/page.tsx` (1), `src/app/(staff)/documents/[documentId]/page.tsx` (1), `src/app/(staff)/history/page.tsx` (1), `src/app/(staff)/mvp/[admissionId]/actions.ts` (1), `src/app/api/insurance/cases/[caseId]/documents/route.ts` (1), `src/components/admission-forms.tsx` (1), `src/components/insurance-paperwork.tsx` (1), `src/components/staff-forms.tsx` (1), `src/lib/hospital-time.ts` (1), `src/lib/mvp-medicine-lines.ts` (1), `src/lib/mvp-paper-status.ts` (1), `src/server/billing/statement.ts` (1), `src/server/bootstrap.ts` (1), `src/server/discharge/commands.ts` (1), `src/server/insurance/paperwork-graph.ts` (1), `src/server/insurance/paperwork-http.ts` (1), `src/server/lab/commands.ts` (1), `src/server/mvp/dependencies.ts` (1), `src/server/mvp/exceptions.ts` (1), `src/server/mvp/staff.ts` (1), `src/server/mvp/transfers.ts` (1), `src/server/readiness.ts` (1), `scripts/demo-hospital.mjs` (1), `scripts/demo-hospital.ts` (1), `scripts/migrate.ts` (1), `tests/e2e/documents.spec.ts` (1), `tests/e2e/exceptions.spec.ts` (1), `tests/e2e/final-review.spec.ts` (1), `tests/e2e/pharmacy.spec.ts` (1), `tests/e2e/role-workspaces.spec.ts` (1), `tests/integration/access.test.ts` (1), `tests/integration/insurance.test.ts` (1), `tests/integration/mvp-staff.test.ts` (1), `tests/support/documents-browser-fixture.ts` (1), `tests/support/final-review-browser-fixture.ts` (1), `tests/support/mvp-workflow-fixture.ts` (1), `tests/unit/mvp-transfer-timeline.test.ts` (1)

### PostgreSQL catalog and privilege introspection

15 files, 75 hits. `pg_class`, `has_*_privilege`, `current_user` and role checks have no equivalent (single Hostinger user). `src/server/readiness.ts` needs rewriting around `information_schema` and a trigger-presence check, and its `PgTable`/`getTableConfig` import changed to `drizzle-orm/mysql-core`.

Files: `src/server/readiness.ts` (26), `scripts/recovery.mjs` (22), `tests/e2e/role-workspaces.spec.ts` (4), `scripts/demo-hospital.mjs` (3), `scripts/migrate.ts` (3), `scripts/paperwork-checkpointer.ts` (3), `scripts/test-database.ts` (3), `tests/e2e/paperwork.spec.ts` (3), `tests/integration/paperwork.test.ts` (2), `scripts/bootstrap-local-database.mjs` (1), `tests/integration/documents.test.ts` (1), `tests/integration/exceptions.test.ts` (1), `tests/integration/test-database-lifecycle.test.ts` (1), `tests/support/auth-fixture-entry.ts` (1), `tests/support/documents-long-stay.ts` (1)

### `hims.` schema prefix inside SQL text

60 files, 1039 hits. Drop the `hims.` prefix everywhere (also quoted `"hims"`). Mostly mechanical; many hits are SQL fixtures and test truncation helpers.

Files: `scripts/migrate.ts` (108), `tests/integration/exceptions.test.ts` (91), `tests/integration/discharge.test.ts` (82), `tests/integration/paperwork.test.ts` (56), `src/server/discharge/dependencies.ts` (42), `tests/integration/pharmacy.test.ts` (41), `tests/integration/documents.test.ts` (38), `tests/integration/overview.test.ts` (37), `src/server/discharge/exception-workspace.ts` (36), `src/server/mvp/workspace.ts` (36), `tests/integration/billing.test.ts` (34), `tests/integration/transfer-temporal.test.ts` (32), `tests/integration/transfer.test.ts` (29), `src/server/overview.ts` (26), `tests/integration/final-review.test.ts` (26), `tests/integration/mvp-workflow.test.ts` (26), `src/server/discharge/exception-corrections.ts` (24), `src/server/admissions/commands.ts` (20), `src/server/discharge/exceptions.ts` (18), `tests/integration/admission.test.ts` (18), `tests/integration/database.test.ts` (15), `tests/integration/lab.test.ts` (15), `src/server/discharge/exception-physical.ts` (14), `tests/integration/care.test.ts` (13), `tests/integration/mvp-staff.test.ts` (12), `tests/integration/mvp-transfer.test.ts` (12), `tests/integration/insurance.test.ts` (11), `src/server/billing/commands.ts` (9), `src/server/documents/snapshot.ts` (9), `scripts/recovery.mjs` (9), `tests/integration/final-review-native.test.ts` (9), `tests/integration/mvp-services.test.ts` (8), `tests/support/inpatient-journey-fixture.ts` (8), `tests/e2e/paperwork.spec.ts` (7), `tests/support/documents-long-stay.ts` (7), `src/server/mvp/dependencies.ts` (6), `tests/integration/access.test.ts` (5), `tests/integration/pilot-readiness.test.ts` (5), `src/server/mvp/commands.ts` (4), `src/server/mvp/exceptions.ts` (4), `src/server/mvp/transfers.ts` (4), `src/server/discharge/commands.ts` (3), `scripts/demo-hospital.ts` (3), `tests/integration/admin-bounds.test.ts` (3), `tests/integration/mvp-self-pay.test.ts` (3), `src/server/billing/room-charges.ts` (2), `src/server/documents/commands.ts` (2), `src/server/documents/mvp.ts` (2), `scripts/demo-hospital.mjs` (2), `tests/e2e/role-workspaces.spec.ts` (2), `tests/unit/login-identifier.test.ts` (2), `src/components/login-identifier.ts` (1), `src/server/admissions/transfer-authority.ts` (1), `src/server/bootstrap-entry.ts` (1), `src/server/bootstrap.ts` (1), `scripts/paperwork-checkpointer.ts` (1), `scripts/test-database.ts` (1), `tests/integration/mvp-medicine.test.ts` (1), `tests/support/final-review-browser-fixture.ts` (1), `tests/unit/paperwork-import.test.ts` (1)

### Direct `pg`, pg-core and LangGraph Postgres imports

27 files, 92 hits. Files that still import `pg`, `drizzle-orm/node-postgres`, `drizzle-orm/pg-core` or `@langchain/langgraph-checkpoint-postgres`. `scripts/migrate*.ts`, `scripts/test-database.ts` and the paperwork checkpointer need the MariaDB migrator and the custom `lg_checkpoint*` saver. `pg` stays in package.json until these are done.

Files: `tests/integration/discharge.test.ts` (9), `tests/integration/exceptions.test.ts` (9), `tests/integration/care.test.ts` (8), `tests/integration/final-review.test.ts` (6), `tests/integration/lab.test.ts` (6), `tests/integration/transfer-temporal.test.ts` (6), `tests/integration/transfer.test.ts` (6), `tests/integration/pharmacy.test.ts` (5), `scripts/test-database.ts` (4), `tests/integration/documents.test.ts` (4), `tests/integration/insurance.test.ts` (4), `src/server/insurance/paperwork-commands.ts` (3), `scripts/migrate-cli.ts` (2), `scripts/paperwork-checkpointer.ts` (2), `scripts/recovery.mjs` (2), `tests/e2e/paperwork.spec.ts` (2), `tests/e2e/role-workspaces.spec.ts` (2), `tests/integration/paperwork.test.ts` (2), `tests/support/restored-verification-entry.ts` (2), `src/server/db.ts` (1), `src/server/insurance/paperwork-graph.ts` (1), `src/server/readiness.ts` (1), `scripts/bootstrap-local-database.mjs` (1), `scripts/demo-hospital.mjs` (1), `scripts/migrate.ts` (1), `tests/integration/database.test.ts` (1), `tests/support/documents-long-stay.ts` (1)

### Connection URLs, roles, PostgreSQL tools

57 files, 300 hits. `postgres://`, `hims_runtime`, `hims_owner`, `hims_test_runtime`, `OWNER_DATABASE_URL`, `psql`, `pg_dump`, `pg_restore`. `src/server/synthetic-runtime.ts` (checks the `postgres:` protocol, user `hims_test_runtime`, database name pattern) must be updated for `mysql://`, otherwise `db.ts` throws whenever `HIMS_SYNTHETIC_TEST_RUN` is set.

Files: `scripts/recovery.mjs` (36), `tests/unit/database-guards.test.ts` (27), `tests/unit/synthetic-runtime.test.ts` (14), `scripts/bootstrap-local-database.mjs` (11), `tests/integration/overview.test.ts` (11), `tests/integration/pharmacy.test.ts` (10), `tests/unit/pilot-configuration.test.ts` (10), `scripts/test-database-guard.ts` (9), `tests/unit/recovery-guards.test.ts` (9), `tests/integration/pilot-readiness.test.ts` (8), `tests/integration/billing.test.ts` (7), `tests/unit/migration-import.test.ts` (7), `scripts/migrate.ts` (6), `scripts/paperwork-checkpointer.ts` (6), `tests/integration/access.test.ts` (6), `tests/integration/exceptions.test.ts` (6), `tests/integration/transfer-temporal.test.ts` (6), `tests/integration/transfer.test.ts` (6), `src/server/db.ts` (5), `tests/integration/mvp-staff.test.ts` (5), `tests/unit/demo-hospital-guard.test.ts` (5), `tests/unit/paperwork-import.test.ts` (5), `tests/integration/admin-bounds.test.ts` (4), `tests/integration/care.test.ts` (4), `tests/integration/final-review-native.test.ts` (4), `tests/integration/mvp-transfer.test.ts` (4), `tests/integration/test-database-lifecycle.test.ts` (4), `tests/support/documents-long-stay.ts` (4), `tests/unit/room-worker-import.test.ts` (4), `src/server/synthetic-runtime.ts` (3), `tests/integration/discharge.test.ts` (3), `tests/integration/documents.test.ts` (3), `tests/integration/final-review.test.ts` (3), `tests/integration/insurance.test.ts` (3), `tests/integration/lab.test.ts` (3), `tests/integration/mvp-workflow.test.ts` (3), `tests/integration/paperwork.test.ts` (3), `tests/support/auth-fixture-entry.ts` (3), `src/server/protected-storage.ts` (2), `src/server/readiness.ts` (2), `scripts/bootstrap-admin.mjs` (2), `scripts/demo-hospital-guard.ts` (2), `scripts/demo-hospital.mjs` (2), `scripts/migrate-cli.ts` (2), `tests/integration/mvp-medicine.test.ts` (2), `tests/integration/mvp-self-pay.test.ts` (2), `tests/integration/mvp-services.test.ts` (2), `tests/unit/bootstrap-security.test.ts` (2), `tests/unit/database-lazy.test.ts` (2), `src/server/insurance/paperwork-commands.ts` (1), `scripts/auth-fixtures.mjs` (1), `scripts/paperwork-checkpointer-cli.ts` (1), `scripts/test-database.ts` (1), `tests/e2e/paperwork.spec.ts` (1), `tests/e2e/role-workspaces.spec.ts` (1), `tests/integration/admission.test.ts` (1), `tests/support/restored-verification-entry.ts` (1)

## 3. Other known porting items (invisible to tsc and the greps)

- Dates in raw `tx.execute` results are UTC strings (drizzle forces string type-casting); in ORM queries they are `Date`. PostgreSQL returned `Date` for `timestamptz` in both. Check raw SELECTs that feed `new Date(...)`, `.toISOString()` or JSON output.
- Partial unique indexes (`patient_active_admission_idx`, `pharmacy_receipt_source_once`) are not expressible in the TypeScript schema; they must exist in `web/drizzle-maria/` as unique indexes over generated columns. Comments mark the spots.
- `text` columns that are indexed, unique, primary or foreign keys became `varchar(255)` through the `key()` helper in `schema/columns.ts`; `mode`, `channel`, `department_issuer` use 64, `kind`/`actor_type`/`gate` use 16, `role` 32, to keep multi-column unique indexes under the 3072-byte InnoDB key limit. The DDL author should match these lengths and use `utf8mb4_bin` for case-sensitive identifiers (`uhid`, `ip_code`, `barcode`).
- CHECK constraints now use `char_length(trim(x))` (PostgreSQL `length(btrim(x))` counted characters) and `REGEXP '(?-i)^...$'` (PostgreSQL `~` is case-sensitive). The pharmacy receipt-reference rule (no leading or trailing Unicode whitespace) became a PCRE `NOT REGEXP` class; verify it on MariaDB.
- Views (`effective_*`) are declared with `.existing()`; the DDL agent owns their definitions.
- `web/drizzle.config.ts` now points at `./drizzle-maria` (dialect mysql); do not run `npm run db:generate` casually.
- `hims_locks(lock_key VARCHAR(255) PRIMARY KEY)` must exist before `acquireTxLock` is used.
- `drizzle-kit export --dialect mysql` generated DDL from the new schema without errors, but it was not executed against a scratch MariaDB database in this phase.
