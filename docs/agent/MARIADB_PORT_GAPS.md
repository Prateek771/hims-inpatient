
# Tables layer (`web/drizzle-maria/0001_tables.sql`)

Every PostgreSQL table, index, UNIQUE, PRIMARY KEY, CHECK and FOREIGN KEY is translated in the schema; nothing in this layer needs an app-side substitute. The three partial indexes are implemented in the schema (below), so they are informational, not open gaps.

## Partial indexes (implemented with invisible generated columns)
| PostgreSQL index | Rule | MariaDB implementation |
|---|---|---|
| `mvp_medicine_charge_once` | one `CHARGE` source per `charge_id` | virtual invisible `mvp_medicine_sources.charge_id__chg = IF(kind='CHARGE', charge_id, NULL)`, UNIQUE index of the same name |
| `patient_active_admission_idx` | one `PENDING`/`ADMITTED` admission per patient | virtual invisible `admissions.patient_id__active`, UNIQUE index of the same name |
| `pharmacy_receipt_source_once` | one `RECEIPT` per `(batch_id, reference)` | virtual invisible `pharmacy_movements.reference__receipt VARCHAR(500)`, UNIQUE `(batch_id, reference__receipt)` |

Duplicates surface as errno 1062 (`ER_DUP_ENTRY`) on the helper index name. Do not list the helper columns in ORM select/insert maps.

## Behaviour differences the later layers and the app must know
- `now()` and `clock_timestamp()` defaults are both statement-time `UTC_TIMESTAMP(6)`; PostgreSQL `now()` was fixed per transaction and `clock_timestamp()` advanced within it. Triggers or app code relying on strictly increasing timestamps inside one transaction must set them explicitly.
- Indexed, FK and unique `text` columns are `VARCHAR(255)` (LangGraph tables 64 to 128); PostgreSQL accepted any length, so the app must reject longer values. Affected user-entered columns include `receipts.source_reference`, `receipt_refunds.source_reference`, `mvp_external_services.external_bill_reference` / `external_line_reference` / `department_issuer`, `mvp_medicine_sources.reference`, `patients.name`, `beds.label`.
- A `RECEIPT` pharmacy movement with a reference over 500 characters fails with errno 1406 rather than CHECK errno 4025.
- `pharmacy_receipt_reference_canonical` (whitespace-trim canonical check) relies on `NO_BACKSLASH_ESCAPES` being unset in `sql_mode`; the connection pool must not set it.
- Regex CHECKs add `INSTR(col, CHAR(10)) = 0` because PCRE `$` matches before a final newline (PostgreSQL `$` does not).
- JSON columns keep the text as submitted (jsonb normalised it); do not compare or hash JSON columns by text expecting jsonb semantics.
- `uuid()` yields version-1 (time-based) UUIDs instead of version-4 (random).

# Helper functions layer (`web/drizzle-maria/0002_helpers.sql`)

All 8 non-trigger functions are ported as stored FUNCTIONs (void ones return TINYINT 1) and tested in a scratch database (97 assertions plus 2 trigger call tests). Nothing is unported; the items below are behaviour differences callers must know.

- **`DO fn(...)` swallows errors.** In MariaDB the `DO` statement turns a SIGNAL raised inside the function into a warning (verified at top level and inside a trigger: the triggering INSERT succeeds). The PL/pgSQL `PERFORM hims.mvp_finance_guard(...)` / `assert_planned_exit_instruction` / `invalidate_clearances` calls MUST be written `SET @ignored = fn(...);`, which raises errno 1644 correctly.
- Original ERRCODE `23514` is not carried by SIGNAL (`SQLSTATE '45000'`, errno 1644); messages are identical.
- **JSON booleans in `JSON_VALUE`:** a JSON `true`/`false` reads back as `'1'`/`'0'`, a JSON string `"true"` as `'true'`. `(x->>'flag')::boolean` becomes `JSON_VALUE(x,'$.flag') IN ('true','1')`. `mvp_current_responsibility` emits real JSON `true`/`false` for `stale` and `allocationComplete`.
- **`JSON_OBJECT` and routine variables:** numeric routine variables are emitted as strings unless wrapped in an expression (`v + 0`); bare literals/columns are fine. Trigger authors building JSON from `DECLARE`d variables must watch this. Booleans: `JSON_EXTRACT('[true]','$[0]')`.
- **`mvp_economic_basis` hash fidelity:** the string is built with `JSON_QUOTE` instead of `to_json`. Identical for all characters except that control characters below 0x20 are escaped with uppercase hex (`\u001F`) where PostgreSQL uses lowercase (`\u001f`); only matters for a `source_event_id` containing such characters (the TypeScript `economicBasis` also uses JSON.stringify, i.e. lowercase). It temporarily raises `group_concat_max_len` (restored before returning) so the hash is never computed from truncated text. Verified equal to an independent JavaScript computation of the PostgreSQL formula.
- **UUID ordering:** native `UUID` sorts by time segments, not bytes. Every order/tie-break on a uuid in these functions uses `CAST(id AS CHAR)` to keep PostgreSQL's byte order; trigger authors should do the same wherever `ORDER BY ... id` decides a result.
- Numeric work uses `DECIMAL(38,0)` (all money is integral paise) instead of unbounded `numeric`; `least()`/`greatest()` NULL-ignoring behaviour of PostgreSQL is reproduced with `COALESCE`.
- Functions are `SQL SECURITY INVOKER` (single Hostinger user). `mvp_finance_guard` reads view `effective_room_vacations`; apply order 0001, 0002, 0003 works because bodies resolve at call time.
- `mvp_current_responsibility` returns the same object keys as before but key order and spacing differ (jsonb sorted keys); consumers use `JSON_VALUE`/paths, never text equality.

# Trigger group T1 (`web/drizzle-maria/triggers/T1.sql`, generated by `T1.gen.mjs`, tested by `T1.test.mjs`)

63 of the 67 PostgreSQL triggers in this group are ported as 63 MariaDB triggers (all `BEFORE INSERT`; PostgreSQL had no UPDATE/DELETE events here). Every `RAISE EXCEPTION` keeps its message text (SQLSTATE `45000`, errno 1644; ERRCODE `23514` is not carried, so tests/app that matched `code: "23514"` must match errno 1644 plus the message). The 4 CONSTRAINT TRIGGERs below cannot exist in MariaDB and move into the app's final transaction step.

## Deferred CONSTRAINT TRIGGER: `pharmacy_movement_matches_stock` and `pharmacy_stock_matches_ledger` (function `check_pharmacy_stock_ledger`)
- **Rule:** for every pharmacy batch touched in the transaction, `pharmacy_batches.available_quantity` must equal `SUM(pharmacy_movements.quantity)` for that batch (0 when it has no movements). Message: `Available stock must equal the append-only movement ledger`. PostgreSQL checked it at COMMIT (deferred), once for each inserted movement (`batch_id`), each inserted batch (`id`) and each updated batch (`id`), so intermediate states inside the transaction were allowed.
- **Detection query** (returns the violating batch ids; any row means reject and roll back):
```sql
SELECT b.id FROM pharmacy_batches b
WHERE b.id IN (:touched_batch_ids)
  AND NOT EXISTS (SELECT 1 FROM pharmacy_batches x
                  WHERE x.id = b.id
                    AND x.available_quantity = COALESCE((SELECT SUM(m.quantity) FROM pharmacy_movements m WHERE m.batch_id = x.id), 0));
```
- **When the app must run it:** at the end of every pharmacy command (receipt, adjustment, issue, return, any batch insert, any `UPDATE pharmacy_batches SET available_quantity`) after the last write and before `COMMIT`, with the ids of all batches written in that transaction. Take the batch rows `FOR UPDATE` earlier in the command so concurrent commands cannot interleave between check and commit. Tested in `T1.test.mjs` (balanced, unbalanced, no-movement batch).

## Deferred CONSTRAINT TRIGGER: `closed_charge_result` and `closed_reversal_result` (function `guard_final_financial_result`)
- **Rule:** a `charges` row or a `charge_reversals` row inserted with `correction_exception_id IS NOT NULL` (a financial effect on a discharged episode) must, by COMMIT, be backed by a persisted `post_discharge_amendments` row that names the same exception and the same actor. Message: `Closed financial effect must commit its exact persisted attributable amendment`. It was deferred because the amendment row is inserted after the charge/reversal it describes.
  - Reversal: amendment `kind='REVERSE_CHARGE'`, `source_id = reversal.charge_id`, `result_id = reversal.id`, `signed_by = reversal.actor_id`.
  - Charge: amendment `kind = exception.correction_kind`, `source_id = exception.source_id`, `signed_by = charge.actor_id`, and either (`kind='CARE_BILLING'` and `result_id` text = `charge.source_event_id`) or (`kind IN ('LAB_REPORT','LAB_BILLING')` and `result_id` is a `lab_reports` row of the order `exception.source_id`).
- **Detection queries** (any returned row means reject and roll back):
```sql
-- charges
SELECT ch.id FROM charges ch
WHERE ch.id IN (:inserted_charge_ids) AND ch.correction_exception_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id
                  WHERE a.id = ch.correction_exception_id AND m.kind = a.correction_kind AND m.source_id = a.source_id
                    AND m.signed_by = ch.actor_id
                    AND ((m.kind = 'CARE_BILLING' AND CAST(m.result_id AS CHAR) = ch.source_event_id)
                      OR (m.kind IN ('LAB_REPORT','LAB_BILLING')
                          AND EXISTS (SELECT 1 FROM lab_reports r WHERE r.id = m.result_id AND r.order_id = a.source_id))));
-- reversals
SELECT cr.id FROM charge_reversals cr
WHERE cr.id IN (:inserted_reversal_ids) AND cr.correction_exception_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_exceptions a JOIN post_discharge_amendments m ON m.exception_id = a.id
                  WHERE a.id = cr.correction_exception_id AND m.kind = 'REVERSE_CHARGE' AND m.source_id = cr.charge_id
                    AND m.result_id = cr.id AND m.signed_by = cr.actor_id);
```
- **When the app must run it:** in the post-discharge amendment command, after the charge/reversal row AND its `post_discharge_amendments` row (and, for `LAB_REPORT`/`LAB_BILLING`, the lab report) are written, immediately before `COMMIT`. Tested in `T1.test.mjs`.

## T1 trigger notes the app and later layers must know
- **Shared settings lock.** `pg_advisory_xact_lock_shared(729104211)` inside `aa_mvp_legacy_workflow_*` and `discharge_document_source` became `INSERT IGNORE INTO hims_locks ... '729104211'` plus `SELECT ... LOCK IN SHARE MODE` on that row. The exclusive takers (bootstrap, staff administration, settings) must use `acquireTxLock(tx, "729104211", "exclusive")` with exactly that key string; a lock row taken by an app in the same transaction before a shared taker will not self-deadlock, but shared-then-exclusive upgrades in one transaction deadlock (errno 1213) just like the helper doc says.
- **Admission row locks.** PostgreSQL's no-op `UPDATE admissions SET version=version/bill_revision=bill_revision WHERE id=... RETURNING *` became `SELECT ... FROM admissions WHERE id=... FOR UPDATE` (same row lock, but it no longer fires admissions UPDATE triggers or bumps the row version; nothing relied on that).
- **`to_jsonb(NEW)` column probing** (`guard_legacy_clinical_workflow`, `guard_effective_attendance`) is resolved per table at generation time; a new table needing these guards needs a new generated block.
- **Timestamps.** `clock_timestamp()` in trigger bodies is `UTC_TIMESTAMP(6)` (statement start). A future-time check compares against the start of the INSERT statement.
- **`discharge_document_source`** parses `snapshot.createdAt` as an ISO UTC string (`...T...Z`, fractional digits kept up to microseconds); an offset form such as `+05:30` would not match. The app writes `Date#toISOString()`.
- **Numeric work in `final_reversal_source`** (room reversal floor): `DECIMAL(30,6)` arithmetic with integer `DIV` instead of unbounded `numeric` `floor(a/b)`; `greatest(0, NULL)` NULL-ignoring behaviour reproduced with `COALESCE`.
- **`allocation_cancel_source_guard`** has no rejecting branch (PostgreSQL's function only locked the admission); it is ported as the lock.
- **JSON membership** `jsonb ? text` on id arrays is `JSON_CONTAINS(arr, JSON_QUOTE(CAST(id AS CHAR)))` (ids compared as canonical lowercase UUID text, as before). `jsonb_array_elements_text` is `JSON_TABLE(... '$[*]' ...)`.
- **Helper calls** use `SET @ignored = assert_planned_exit_instruction(...)` (not `DO`, which swallows the SIGNAL).
- Triggers that call views (`effective_room_stays`, `effective_room_vacations`, `effective_shift_ends`, `effective_vacation_facts`, `effective_bed_turnovers`) need `0003_views.sql` applied.

# Trigger group T3 (`web/drizzle-maria/triggers/T3.sql`)

120 PostgreSQL triggers (20 trigger functions: physical bed/discharge/vacancy guards, post-discharge amendment, room return, stay amendment, transfer withdrawal, clearance and MVP invalidation, document identity lock, pharmacy movement and transfer boundary validation, three append-only `preserve_*` families) became 178 MariaDB triggers (one per event). **No CONSTRAINT TRIGGER belongs to this group** (the 7 deferred ones use T1/T2 functions), so nothing is deferred to the app from T3.

- **`UPDATE OF <cols>` fires on value change, not on mention.** `physical_bed_timeline_guard` (room_stays: bed_id, started_at, ended_at) and `room_source_clearance` (room_stays: started_at, ended_at, bed_id, tariff_version_id) run on UPDATE only when one listed column's value changed. An `UPDATE ... SET ended_at = ended_at` no longer invalidates seals.
- **Row-lock idiom.** `UPDATE admissions SET bill_revision = bill_revision` / `UPDATE beds SET active = active` became `SELECT ... FOR UPDATE` (no write, no row triggers). Locks are held to COMMIT as before.
- **Advisory lock.** `lock_document_identity_source` takes `hims_locks` key `document-identity:<patient_id>` (same key shape as `acquireTxLock`); the app command must use the same key if it also locks.
- **`ON CONFLICT DO NOTHING` became `INSERT IGNORE`** in the invalidation triggers (`ON DUPLICATE KEY UPDATE` would fire the BEFORE UPDATE immutability triggers). `INSERT IGNORE` also downgrades data errors to warnings on those inserts.
- **KNOWN INTEGRATION ISSUE in `0002_helpers.sql`:** `invalidate_clearances` uses `ON DUPLICATE KEY UPDATE seal_id = clearance_invalidations.seal_id` (and the same for `mvp_invalidations`). Re-invalidating an already invalidated seal/event fires `clearance_invalidations_immutable_upd` / `mvp_invalidations_immutable_upd` and fails with "Billing history is immutable; append a linked correction" (PostgreSQL did `NOT EXISTS ... ON CONFLICT DO NOTHING`). Fix in the helper: `INSERT IGNORE` (or `AND NOT EXISTS (...)`) instead of `ON DUPLICATE KEY UPDATE`. `T3.test.mjs` has a test that fails until this is fixed.
- Helper calls inside triggers use `SET v_ignored = invalidate_clearances(...)` (a `DO` would swallow the SIGNAL).
- **Range overlap.** `tstzrange(a,b,'[)') && tstzrange(c,d,'[)')` is an explicit comparison with NULL end = unbounded and empty ranges overlapping nothing; PostgreSQL additionally raised when lower > upper, MariaDB does not.
- **Error codes.** `ERRCODE 23514 / 23P01` are not carried (SQLSTATE 45000, errno 1644, identical messages). `SELECT ... INTO STRICT` failures in `validate_pharmacy_movement` signal `query returned no rows`.
- **Append-only guarantees** (`*_immutable`, `preserve_*`) are triggers and do not depend on grants. `TRUNCATE` and `DROP` bypass row triggers; with a single database user nothing prevents them.
- **JSON containment.** `jsonb ? text` on `admin_exceptions.evidence_ids` is `JSON_CONTAINS(col, JSON_QUOTE(uuid_text))` (array-of-strings only, which is the stored shape).

# Trigger group T2 (`web/drizzle-maria/triggers/T2.sql`, tested by `T2.test.mjs`)

28 PostgreSQL triggers (21 trigger functions, `guard_mvp_closed_receipt` .. `guard_pharmacy_batch_identity`) became 25 MariaDB triggers (one per event, none needed splitting) plus the 3 deferred CONSTRAINT TRIGGERs below. Everything else is inside the trigger bodies; each rejection keeps the original message text under SQLSTATE `45000` / errno 1644 (the PostgreSQL `ERRCODE 23514` is not carried).

Each check below is one `SELECT` that returns a row per violating row, with the original `RAISE EXCEPTION` message in `message`. **Zero rows means the rule holds.** The app runs it with the ids of the rows it inserted in the current transaction (replace `<ids>` with a bound id list) as the last statement before `COMMIT`, and rolls back with the returned message when any row comes back. `T2.test.mjs` extracts these exact blocks from this file and runs them against accepted and violating fixtures, so the text here is the tested text. The checks call the same stored functions as the triggers (`0002_helpers.sql`).

## Deferred CONSTRAINT TRIGGER: `mvp_external_charge_pair` (function `guard_mvp_external_pair`)
- **Rule:** AFTER INSERT on `charges` (only categories `consultation`, `procedure`, `consumable`, `lab`, `radiology`), checked at COMMIT: when the admission has `workflow_version = 2`, the charge must have its atomic external performed-service source, an `mvp_external_services` row with `charge_id = charge.id`, `id = charge.source_event_id` (as text), the same `admission_id` and `recorded_by = charge.actor_id`. Message: `Version 2 service charges require their atomic external performed-service source`.
- **Why deferred:** the charge is inserted first (the BEFORE trigger `mvp_external_source` on `mvp_external_services` reads the charge), the service row second, so the pair only exists at the end of the transaction.
- **When the app must run it:** in the external performed-service command, after both the `charges` row and the `mvp_external_services` row are inserted, with the new charge id. Run it for any other path that inserts a charge in those five categories for a version 2 admission (there should be none).

```sql
-- T2-CHECK external_charge_pair
SELECT c.id AS charge_id,
       'Version 2 service charges require their atomic external performed-service source' AS message
FROM charges c
JOIN admissions a ON a.id = c.admission_id AND a.workflow_version = 2
WHERE c.id IN (<ids>)
  AND c.category IN ('consultation', 'procedure', 'consumable', 'lab', 'radiology')
  AND NOT EXISTS (SELECT 1 FROM mvp_external_services s
                  WHERE s.charge_id = c.id
                    AND (CAST(s.id AS CHAR) COLLATE utf8mb4_nopad_bin) = c.source_event_id
                    AND s.admission_id = c.admission_id
                    AND s.recorded_by = c.actor_id)
```

## Deferred CONSTRAINT TRIGGER: `mvp_transfer_effects` (function `guard_mvp_transfer_effects`)
- **Rule:** AFTER INSERT on `admission_transfers`, checked at COMMIT, for transfers with `mvp_authority_id IS NOT NULL`: (1) a `bed_turnovers` row exists for the same admission, `stay_id = old_stay_id`, `bed_id = old_bed_id`, `vacated_at = transferred_at`; and (2) when the admission's `payment_route = 'INSURED'`, a `transfer_insurance_tasks` row exists for `(admission_id, transfer_id = transfer.id)`. Message: `Actual transfer must retain source-bed turnover and required external insurance follow-up`.
- **Why deferred:** the turnover and the insurance follow-up task are inserted after the transfer row.
- **When the app must run it:** in the MVP transfer command, after the `admission_transfers`, `bed_turnovers` and (for insured admissions) `transfer_insurance_tasks` inserts, with the new transfer id.

```sql
-- T2-CHECK transfer_effects
SELECT t.id AS transfer_id,
       'Actual transfer must retain source-bed turnover and required external insurance follow-up' AS message
FROM admission_transfers t
WHERE t.id IN (<ids>)
  AND t.mvp_authority_id IS NOT NULL
  AND (NOT EXISTS (SELECT 1 FROM bed_turnovers b
                   WHERE b.admission_id = t.admission_id AND b.stay_id = t.old_stay_id
                     AND b.bed_id = t.old_bed_id AND b.vacated_at = t.transferred_at)
       OR (EXISTS (SELECT 1 FROM admissions a WHERE a.id = t.admission_id AND a.payment_route = 'INSURED')
           AND NOT EXISTS (SELECT 1 FROM transfer_insurance_tasks k
                           WHERE k.admission_id = t.admission_id AND k.transfer_id = t.id)))
```

## Deferred CONSTRAINT TRIGGER: `mvp_closed_receipt` (function `guard_mvp_closed_receipt`)
- **Rule:** AFTER INSERT on `receipts`, checked at COMMIT. It applies only when the admission has `workflow_version = 2` and `status = 'DISCHARGED'` (any other state passes). The receipt must settle only its original party obligation with current Billing evidence, using the `mvp_receivable_receipts` binding row of the receipt:
  1. `mvp_current_responsibility(admission).responsibility.allocationComplete` must be true.
  2. If the departure has an ordinary finance event (`departures.mvp_finance_id`): the receipt party must be `INSURER`, the binding's `finance_id` must be that event, and the binding must have no `exception_authority_id` and no `allocation_amendment_id`; the accepted amount is the finance event's `financial.responsibility.insurerPaise`.
  3. Otherwise there must be an exceptional departure whose authority event equals the binding's `exception_authority_id`, and the binding must have no `finance_id`. If that authority's `financial.responsibility.allocationComplete` is true, the binding must have no `allocation_amendment_id` and the accepted amount is the authority's `patientPaise` / `insurerPaise` for the receipt party. If it is not complete, the authority type must be `INSURANCE_DELAY`, `mvp_delay_allocation_amendment(admission, current decisionId)` must be non-null and equal the binding's `allocation_amendment_id`, the accepted amount is the current `patientPaise` / `insurerPaise`, and all retained cash on the admission (receipts minus refunds, both parties) must not exceed the authority's `bill.netPaise`.
  4. The accepted amount must be non-negative and is capped at the current party amount (`LEAST`); the party's retained cash (receipts minus refunds) must not exceed it; the receipt must be `kind = 'PAYMENT'` with an `evidence_id`; the binding must belong to the admission and be recorded by `receipts.actor_id`, who must be an active `ADMIN` or `BILLING` user.
  Messages, in the order of the checks: `Current verified complete party allocation required before receivable collection`, `Original ordinary insurer receivable required`, `Original exceptional party authority required`, `Complete original responsibility retains its original collection source`, `Exact current Admin-authorized post-exit allocation amendment required`, `Later allocation collection cannot exceed original net after all retained cash`, `Original retained party responsibility is required`, `Actual post-exit receipt must settle only its original party obligation with current Billing evidence`. The query returns the first failing message per receipt.
- **Why deferred:** the `mvp_receivable_receipts` binding row is inserted after the receipt (the binding references the receipt).
- **When the app must run it:** in the post-exit receivable collection command, after the `receipts` row and its `mvp_receivable_receipts` row are inserted, with the new receipt id. This is the only place the original-obligation rule is enforced: a receipt on a discharged MVP admission inserted by any other path must be checked the same way.

```sql
-- T2-CHECK closed_receipt
SELECT w.receipt_id, w.message
FROM (
  SELECT j.receipt_id,
    CASE
      WHEN NOT COALESCE(JSON_VALUE(j.cf, '$.responsibility.allocationComplete') IN ('true', '1'), 0)
        THEN 'Current verified complete party allocation required before receivable collection'
      WHEN j.f_id IS NOT NULL AND (j.party <> 'INSURER' OR NOT (j.b_finance <=> j.f_id) OR j.b_exception IS NOT NULL OR j.b_amendment IS NOT NULL)
        THEN 'Original ordinary insurer receivable required'
      WHEN j.f_id IS NULL AND (j.a_id IS NULL OR NOT (j.b_exception <=> j.a_id) OR j.b_finance IS NOT NULL)
        THEN 'Original exceptional party authority required'
      WHEN j.f_id IS NULL AND j.a_complete AND j.b_amendment IS NOT NULL
        THEN 'Complete original responsibility retains its original collection source'
      WHEN j.f_id IS NULL AND NOT j.a_complete AND (j.a_type <> 'INSURANCE_DELAY' OR j.amendment IS NULL OR NOT (j.b_amendment <=> j.amendment))
        THEN 'Exact current Admin-authorized post-exit allocation amendment required'
      WHEN j.f_id IS NULL AND NOT j.a_complete AND (j.orig_net IS NULL OR j.all_cash > j.orig_net)
        THEN 'Later allocation collection cannot exceed original net after all retained cash'
      WHEN j.accepted IS NULL OR j.accepted < 0
        THEN 'Original retained party responsibility is required'
      WHEN j.kind <> 'PAYMENT' OR j.evidence_id IS NULL OR j.received > LEAST(j.accepted, COALESCE(j.current_party, j.accepted))
           OR NOT (j.b_admission <=> j.admission_id) OR NOT (j.b_by <=> j.actor_id)
           OR NOT EXISTS (SELECT 1 FROM staff_user u WHERE u.id = j.b_by AND u.role IN ('ADMIN', 'BILLING') AND u.banned = 0)
        THEN 'Actual post-exit receipt must settle only its original party obligation with current Billing evidence'
    END AS message
  FROM (
    SELECT i.*,
      COALESCE(JSON_VALUE(i.a_payload, '$.financial.responsibility.allocationComplete') IN ('true', '1'), 0) AS a_complete,
      CAST(JSON_VALUE(i.cf, CONCAT('$.responsibility.', IF(i.party = 'PATIENT', 'patientPaise', 'insurerPaise'))) AS DECIMAL(38,0)) AS current_party,
      CASE WHEN i.f_id IS NOT NULL THEN CAST(JSON_VALUE(i.f_payload, '$.financial.responsibility.insurerPaise') AS DECIMAL(38,0))
           WHEN COALESCE(JSON_VALUE(i.a_payload, '$.financial.responsibility.allocationComplete') IN ('true', '1'), 0)
             THEN CAST(JSON_VALUE(i.a_payload, CONCAT('$.financial.responsibility.', IF(i.party = 'PATIENT', 'patientPaise', 'insurerPaise'))) AS DECIMAL(38,0))
           ELSE CAST(JSON_VALUE(i.cf, CONCAT('$.responsibility.', IF(i.party = 'PATIENT', 'patientPaise', 'insurerPaise'))) AS DECIMAL(38,0))
      END AS accepted,
      CAST(JSON_VALUE(i.a_payload, '$.bill.netPaise') AS DECIMAL(38,0)) AS orig_net,
      CASE WHEN i.f_id IS NULL AND NOT COALESCE(JSON_VALUE(i.a_payload, '$.financial.responsibility.allocationComplete') IN ('true', '1'), 0)
           THEN mvp_delay_allocation_amendment(i.admission_id, JSON_VALUE(i.cf, '$.decisionId')) END AS amendment,
      (SELECT COALESCE(SUM(r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0)), 0)
         FROM receipts r WHERE r.admission_id = i.admission_id) AS all_cash,
      (SELECT COALESCE(SUM(r.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM receipt_refunds x WHERE x.receipt_id = r.id), 0)), 0)
         FROM receipts r WHERE r.admission_id = i.admission_id AND r.party = i.party) AS received
    FROM (
      SELECT rc.id AS receipt_id, rc.admission_id, rc.party, rc.kind, rc.evidence_id, rc.actor_id,
             mvp_current_responsibility(rc.admission_id) AS cf,
             b.finance_id AS b_finance, b.exception_authority_id AS b_exception, b.allocation_amendment_id AS b_amendment,
             b.admission_id AS b_admission, b.recorded_by AS b_by,
             (SELECT ev.id FROM departures d JOIN mvp_events ev ON ev.id = d.mvp_finance_id WHERE d.admission_id = rc.admission_id LIMIT 1) AS f_id,
             (SELECT ev.payload FROM departures d JOIN mvp_events ev ON ev.id = d.mvp_finance_id WHERE d.admission_id = rc.admission_id LIMIT 1) AS f_payload,
             (SELECT ev.id FROM mvp_exceptional_departures d JOIN mvp_exception_events ev ON ev.id = d.authority_id WHERE d.admission_id = rc.admission_id LIMIT 1) AS a_id,
             (SELECT ev.`type` FROM mvp_exceptional_departures d JOIN mvp_exception_events ev ON ev.id = d.authority_id WHERE d.admission_id = rc.admission_id LIMIT 1) AS a_type,
             (SELECT ev.payload FROM mvp_exceptional_departures d JOIN mvp_exception_events ev ON ev.id = d.authority_id WHERE d.admission_id = rc.admission_id LIMIT 1) AS a_payload
      FROM receipts rc
      JOIN admissions e ON e.id = rc.admission_id AND e.workflow_version = 2 AND e.status = 'DISCHARGED'
      LEFT JOIN mvp_receivable_receipts b ON b.receipt_id = rc.id
      WHERE rc.id IN (<ids>)
    ) i
  ) j
) w
WHERE w.message IS NOT NULL
```
