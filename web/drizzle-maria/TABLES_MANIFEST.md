# Tables manifest for `0001_tables.sql`

Source: `tmp/port/pg-final-schema.sql` (95 tables), translated to MariaDB 11.8. Column lists below keep the PostgreSQL order. Counts: 95 translated tables + 2 helpers (`hims_locks`, `hims_migrations`) = 97 tables; 172 `CREATE [UNIQUE] INDEX` statements (3 were partial, see below); 43 UNIQUE constraints; 95 primary keys; 271 foreign keys (2 `ON DELETE CASCADE`); 107 translated CHECKs plus 4 added boolean `IN (0, 1)` checks (MariaDB adds 28 more implicit `JSON_VALID` checks for JSON columns).

File layout: helper tables, then `CREATE TABLE IF NOT EXISTS` (columns, PK, UNIQUE, CHECK), then `CREATE [UNIQUE] INDEX IF NOT EXISTS`, then `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY IF NOT EXISTS (...)`. The file is idempotent (applied twice against a scratch database with no errors and unchanged object counts).

## Translation judgement calls
1. **Collation.** Every table is `utf8mb4` with `utf8mb4_nopad_bin`: PostgreSQL `text` equality is case-sensitive and trailing-space-sensitive, and `~` is case-sensitive. The default `uca1400_ai_ci` would make UNIQUE keys, FK joins and REGEXP checks case-insensitive; `utf8mb4_bin` (PAD SPACE) would make `'a' = 'a '`. Consequence: `ORDER BY` on text uses code-point order, and case-insensitive searches must use `LOWER()` or an explicit `COLLATE` (as in PostgreSQL).
2. **uuid** -> native `UUID`, `DEFAULT uuid()` (MariaDB generates version-1 time-based values; PostgreSQL `gen_random_uuid()` was v4). The `UUID` type rejects non-UUID strings (errno 1292), as PostgreSQL did.
3. **Timestamps.** `timestamp with time zone` -> `DATETIME(6)` holding UTC. `DEFAULT now()` and `DEFAULT clock_timestamp()` both become `DEFAULT (UTC_TIMESTAMP(6))`. Difference: PostgreSQL `now()` was transaction start time and `clock_timestamp()` wall-clock time; `UTC_TIMESTAMP(6)` is the statement start time. 91 columns default this way; code that needs distinct wall-clock times within one statement or transaction must set the value explicitly.
4. **text sizing.** `text` -> `TEXT` unless the column is in a PK, UNIQUE, any index, or either side of a FK, then `VARCHAR(255)`. FK-linked columns share one length. MariaDB counts characters, so values longer than 255 characters in those columns now fail in strict mode (they were unbounded in PostgreSQL); the app should validate length. LangGraph tables use tighter lengths so composite primary keys fit the 3072-byte key limit: `thread_id` 128, `checkpoint_ns` 64, `checkpoint_id` / `parent_checkpoint_id` / `task_id` 64, `channel` 128, `version` 128. Columns not indexed stay `TEXT` and hold the full PostgreSQL range.
5. **boolean** -> `TINYINT(1)` plus a named `<table>_<col>_bool CHECK (col IN (0, 1))` to keep PostgreSQL's two-value domain (4 columns).
6. **jsonb** -> `JSON` (LONGTEXT + `JSON_VALID`, `utf8mb4_bin`). Unlike jsonb, the text is stored as written (no key reordering, whitespace or duplicate-key normalisation), so text equality or hashing of JSON columns can differ from PostgreSQL. Default `'{}'::jsonb` -> `DEFAULT '{}'`. No jsonb-operator CHECKs existed in the source.
7. **Other types.** `numeric(18,6)` -> `DECIMAL(18,6)`; `integer` -> `INT`; `bigint` -> `BIGINT`; `date` -> `DATE`; `bytea` -> `LONGBLOB`. Default `'0'::numeric` -> `DEFAULT 0`; `false/true` -> `0/1`; `'X'::text` -> `'X'`.
8. **CHECK translation.** `x = ANY (ARRAY[...])` -> `x IN (...)`; `x <> ALL (ARRAY[...])` -> `x NOT IN (...)`; `length()` -> `CHAR_LENGTH()` (characters, as in PostgreSQL); `btrim(x)` / `TRIM(BOTH FROM x)` -> `TRIM(x)` (both strip spaces only); `x::numeric` -> `CAST(x AS DECIMAL(18,6))`; `::text` casts dropped.
9. **Regex checks.** `col ~ 'pat'` -> `(col REGEXP 'pat' AND INSTR(col, CHAR(10)) = 0)`. PCRE `$` also matches before a final newline and PostgreSQL `$` does not, so the newline guard is needed (tested: 64 hex characters plus a trailing LF is rejected). `\.` was rewritten as `[.]` (quantity check). Case sensitivity comes from the `_bin` collation (uppercase hex is rejected by `[0-9a-f]`).
10. **pharmacy_receipt_reference_canonical.** `reference = btrim(reference, <23 chr() whitespace values>)` has no MariaDB equivalent (`TRIM` removes only one literal string). It is rewritten as `reference NOT REGEXP '^[ws]|[ws]\\z'` over the same set (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). The pattern uses `\\x{..}` and `\\z` inside the SQL string, so `NO_BACKSLASH_ESCAPES` must be OFF (the default, and the Hostinger setting). Tested: leading/trailing space, tab, LF, NBSP, U+3000, BOM are rejected; interior NBSP is accepted.
11. **Partial unique indexes (3)** use `VIRTUAL INVISIBLE` generated columns appended to the table (hidden from `SELECT *` and plain `INSERT`): `mvp_medicine_sources.charge_id__chg = IF(kind='CHARGE', charge_id, NULL)` with UNIQUE `mvp_medicine_charge_once`; `admissions.patient_id__active = IF(status IN ('PENDING','ADMITTED'), patient_id, NULL)` with UNIQUE `patient_active_admission_idx`; `pharmacy_movements.reference__receipt = IF(kind='RECEIPT', reference, NULL)` (VARCHAR(500)) with UNIQUE `pharmacy_receipt_source_once (batch_id, reference__receipt)`. NULLs are distinct in unique indexes, so non-matching rows are exempt. Accept/reject tested for each. Side effect: a RECEIPT row with a reference over 500 characters fails with errno 1406 instead of CHECK errno 4025; either way it is rejected. ORMs must not select or write the helper columns.
12. **Foreign keys** are added after all tables and indexes with `ADD CONSTRAINT <name> FOREIGN KEY IF NOT EXISTS (...)`; all 271 PostgreSQL names are unique per database, so none were renamed. No ON UPDATE actions existed; the default action is NO ACTION as before. MariaDB checks FKs row by row (PostgreSQL checked non-deferrable FKs at statement end); none were DEFERRABLE. InnoDB auto-created 91 supporting indexes named after their FK where no suitable index existed.
13. **Names kept.** Constraint and index names are unchanged from PostgreSQL (including auto names such as `availability_coordinators_check1`). `*_pkey` names are dropped because MariaDB names every primary key `PRIMARY`. UNIQUE constraints become `CONSTRAINT name UNIQUE (...)` and create an index of that name.
14. **Column quoting.** All identifiers are backtick-quoted because several collide with keywords (`year`, `value`, `values`, `text`, `type`, `mode`).
15. **Helper tables.** `hims_locks(lock_key VARCHAR(255) PK)` as in the conventions. `hims_migrations(name VARCHAR(255) PK, checksum CHAR(64) NOT NULL, applied_at DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)))` is my design (the conventions name the table but not its columns); change freely before the migration runner is written.
16. **LangGraph tables** renamed `lg_checkpoint_migrations`, `lg_checkpoints`, `lg_checkpoint_blobs`, `lg_checkpoint_writes`; `blob bytea` -> `LONGBLOB`, `checkpoint jsonb` -> `JSON`; constraint names keep the originals.
17. **Row and key limits.** No table exceeds the 65,535-byte row limit or the 3,072-byte key limit with these sizes (verified by applying the file).
18. **Out of scope here:** functions, triggers, views and the 7 constraint triggers (other agents). Trigger bodies should use the real columns, not the three generated helper columns.

## Table and column mapping

Format: column, PostgreSQL type (with `NOT NULL` / `DEFAULT`), MariaDB type (with default). Rows marked `(none: partial-index helper)` are the three extra generated columns.

### `admin_exceptions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `type` | text NOT NULL | TEXT |
| `disposition` | text NOT NULL | TEXT |
| `authority` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `evidence` | text NOT NULL | TEXT |
| `evidence_ids` | jsonb NOT NULL | JSON |
| `source_id` | uuid | UUID |
| `correction_kind` | text | TEXT |
| `follow_up_owner_id` | text NOT NULL | VARCHAR(255) |
| `snapshot` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `administrative_shift_ends`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `ended_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `evidence` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `admission_counters`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `hospital_id` | uuid NOT NULL | UUID |
| `year` | integer NOT NULL | INTEGER |
| `value` | bigint NOT NULL | BIGINT |

### `admission_transfers`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `transfer_order_id` | uuid | UUID |
| `old_stay_id` | uuid NOT NULL | UUID |
| `new_stay_id` | uuid NOT NULL | UUID |
| `old_bed_id` | uuid NOT NULL | UUID |
| `target_bed_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `handover` | text NOT NULL | TEXT |
| `transferred_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `mvp_authority_id` | uuid | UUID |

### `admissions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `hospital_id` | uuid NOT NULL | UUID |
| `patient_id` | uuid NOT NULL | UUID |
| `ip_code` | text NOT NULL | VARCHAR(255) |
| `status` | text NOT NULL DEFAULT 'PENDING'::text | TEXT DEFAULT 'PENDING' |
| `admitting_doctor_id` | text | VARCHAR(255) |
| `clinician_assessment` | jsonb | JSON |
| `bed_id` | uuid NOT NULL | UUID |
| `payment_route` | text NOT NULL | TEXT |
| `expected_stay_days` | integer NOT NULL | INTEGER |
| `registered_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `admitted_at` | timestamp with time zone | DATETIME(6) |
| `cancelled_at` | timestamp with time zone | DATETIME(6) |
| `cancellation_reason` | text | TEXT |
| `created_by` | text NOT NULL | VARCHAR(255) |
| `request_id` | uuid NOT NULL | UUID |
| `request_payload` | text NOT NULL | TEXT |
| `version` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `bill_revision` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `deposit_version_id` | uuid | UUID |
| `workflow_version` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `external_doctor_id` | uuid | UUID |
| `patient_id__active` | (none: partial-index helper) | UUID VIRTUAL INVISIBLE AS IF(`status` IN ('PENDING', 'ADMITTED'), `patient_id`, NULL) |

### `allocation_cancellations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `allocation_id` | uuid NOT NULL | UUID |
| `reason` | text NOT NULL | TEXT |
| `reviewed_hash` | text NOT NULL | TEXT |
| `reviewed_bill_version` | integer NOT NULL | INTEGER |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `audit_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `actor_type` | text NOT NULL | VARCHAR(255) |
| `actor_id` | text NOT NULL | VARCHAR(255) |
| `source` | text NOT NULL | TEXT |
| `request_id` | text NOT NULL | TEXT |
| `event` | text NOT NULL | TEXT |
| `entity_type` | text NOT NULL | VARCHAR(255) |
| `entity_id` | text NOT NULL | VARCHAR(255) |
| `reason` | text NOT NULL | TEXT |
| `before_version` | integer | INTEGER |
| `after_version` | integer | INTEGER |
| `occurred_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `availability_coordinators`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `nurse_id` | text NOT NULL | VARCHAR(255) |
| `backup_nurse_id` | text | VARCHAR(255) |
| `starts_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `ends_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `version` | integer NOT NULL | INTEGER |
| `reason` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `request_id` | uuid NOT NULL | UUID |
| `request_payload` | text NOT NULL | TEXT |

### `bed_holds`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `bed_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `held_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `bed_turnover_completions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `turnover_id` | uuid NOT NULL | UUID |
| `completed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `evidence` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `bed_turnovers`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `bed_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `vacated_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `beds`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `label` | text NOT NULL | VARCHAR(255) |
| `category` | text NOT NULL | VARCHAR(255) |
| `category_version_id` | uuid NOT NULL | UUID |
| `active` | boolean NOT NULL DEFAULT true | TINYINT(1) DEFAULT 1 |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `billing_requests`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `actor_id` | text NOT NULL | VARCHAR(255) |
| `request_id` | uuid NOT NULL | UUID |
| `action` | text NOT NULL | TEXT |
| `payload` | text NOT NULL | TEXT |
| `result` | jsonb NOT NULL | JSON |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `care_billing_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `order_id` | uuid | UUID |
| `round_id` | uuid | UUID |
| `category` | text NOT NULL | TEXT |
| `item_id` | text NOT NULL | TEXT |
| `quantity` | text NOT NULL | TEXT |
| `unit` | text NOT NULL | TEXT |
| `tariff_version_id` | uuid | UUID |
| `resolution_reason` | text | TEXT |
| `state` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `care_occurrences`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `order_id` | uuid NOT NULL | UUID |
| `scheduled_at` | timestamp with time zone NOT NULL | DATETIME(6) |

### `care_tasks`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `owner_role` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `charge_finalizations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `charge_id` | uuid NOT NULL | UUID |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `charge_reversals`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `charge_id` | uuid NOT NULL | UUID |
| `amount_paise` | bigint NOT NULL | BIGINT |
| `reason` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `correction_exception_id` | uuid | UUID |
| `physical_amendment_id` | uuid | UUID |

### `charges`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `source_event_id` | text NOT NULL | VARCHAR(255) |
| `source_payload` | text NOT NULL | TEXT |
| `category` | text NOT NULL | TEXT |
| `item_id` | text NOT NULL | TEXT |
| `description` | text NOT NULL | TEXT |
| `quantity` | text NOT NULL | TEXT |
| `unit` | text NOT NULL | TEXT |
| `tariff_version_id` | uuid NOT NULL | UUID |
| `rate_paise` | bigint NOT NULL | BIGINT |
| `amount_paise` | bigint NOT NULL | BIGINT |
| `initial_status` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `correction_exception_id` | uuid | UUID |

### `clearance_invalidations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `seal_id` | uuid NOT NULL | UUID |
| `change_kind` | text NOT NULL | TEXT |
| `changed_record_ids` | jsonb NOT NULL | JSON |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `clearance_seals`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `gate` | text NOT NULL | VARCHAR(255) |
| `role` | text NOT NULL | TEXT |
| `review_hash` | text NOT NULL | TEXT |
| `bill_version` | integer | INTEGER |
| `predecessor_id` | uuid | UUID |
| `inputs` | jsonb NOT NULL | JSON |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `clinical_addenda`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `note_id` | uuid NOT NULL | UUID |
| `reason` | text NOT NULL | TEXT |
| `text` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `clinical_orders`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `round_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | TEXT |
| `requested_item` | text NOT NULL | TEXT |
| `details` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `medicine_item_id` | text | TEXT |
| `medicine_catalog_version_id` | uuid | UUID |

### `clinical_rounds`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `notes` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `clinical_summaries`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `version` | integer NOT NULL | INTEGER |
| `diagnosis` | text NOT NULL | TEXT |
| `course` | text NOT NULL | TEXT |
| `condition` | text NOT NULL | TEXT |
| `follow_up` | text NOT NULL | TEXT |
| `advice` | text NOT NULL | TEXT |
| `prescription` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `clinical_task_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `status` | text NOT NULL | VARCHAR(255) |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `departures`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `bill_seal_id` | uuid | UUID |
| `departed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `bill_version` | integer NOT NULL | INTEGER |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `mvp_finance_id` | uuid | UUID |

### `discharge_documents`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `version` | integer NOT NULL | INTEGER |
| `replaces_document_id` | uuid | UUID |
| `source_hash` | text NOT NULL | VARCHAR(255) |
| `hash` | text NOT NULL | TEXT |
| `snapshot` | jsonb NOT NULL | JSON |
| `storage_key` | uuid NOT NULL | UUID |
| `pdf_hash` | text NOT NULL | TEXT |
| `size_bytes` | integer NOT NULL | INTEGER |
| `created_by` | text NOT NULL | VARCHAR(255) |
| `created_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `schema_version` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `kind` | text NOT NULL DEFAULT 'FINAL'::text | TEXT DEFAULT 'FINAL' |

### `doctor_availability`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `doctor_id` | uuid NOT NULL | UUID |
| `coordinator_id` | uuid NOT NULL | UUID |
| `status` | text NOT NULL | TEXT |
| `starts_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `ends_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `expected_return` | timestamp with time zone | DATETIME(6) |
| `remarks` | text NOT NULL | TEXT |
| `version` | integer NOT NULL | INTEGER |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `request_id` | uuid NOT NULL | UUID |
| `request_payload` | text NOT NULL | TEXT |

### `doctor_directory`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `doctor_directory_versions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `doctor_id` | uuid NOT NULL | UUID |
| `name` | text NOT NULL | TEXT |
| `specialty` | text | TEXT |
| `active` | boolean NOT NULL | TINYINT(1) |
| `version` | integer NOT NULL | INTEGER |
| `reason` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `request_id` | uuid NOT NULL | UUID |
| `request_payload` | text NOT NULL | TEXT |

### `exception_evidence`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | TEXT |
| `role` | text NOT NULL | TEXT |
| `shift_id` | uuid | UUID |
| `source_id` | uuid | UUID |
| `actual_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `vacated_at` | timestamp with time zone | DATETIME(6) |
| `notes` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `exception_id` | uuid | UUID |

### `exception_followups`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `exception_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `note` | text NOT NULL | TEXT |
| `owner_id` | text NOT NULL | VARCHAR(255) |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `exceptional_departures`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `physical_evidence_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `departed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `snapshot` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `hospital_settings`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `name` | text NOT NULL | TEXT |
| `timezone` | text NOT NULL DEFAULT 'Asia/Kolkata'::text | TEXT DEFAULT 'Asia/Kolkata' |
| `identity` | jsonb NOT NULL DEFAULT '{}'::jsonb | JSON DEFAULT '{}' |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_cases`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `assigned_staff_id` | text | VARCHAR(255) |
| `version` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `review_revision` | integer NOT NULL DEFAULT 1 | INTEGER DEFAULT 1 |
| `document_set_revision` | integer NOT NULL DEFAULT 0 | INTEGER DEFAULT 0 |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_conversions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `case_version` | integer NOT NULL | INTEGER |
| `reason` | text NOT NULL | TEXT |
| `decision_reference` | text NOT NULL | TEXT |
| `verified_by` | text NOT NULL | TEXT |
| `verified_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `allocation` | jsonb NOT NULL | JSON |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_decisions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `case_version` | integer NOT NULL | INTEGER |
| `policy_event_id` | uuid NOT NULL | UUID |
| `status` | text NOT NULL | TEXT |
| `kind` | text NOT NULL | TEXT |
| `verified_by` | text NOT NULL | TEXT |
| `verified_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `reference` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `approved_paise` | bigint NOT NULL | BIGINT |
| `co_pay_bps` | integer NOT NULL | INTEGER |
| `allocation` | jsonb NOT NULL | JSON |
| `document_ids` | jsonb NOT NULL | JSON |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_documents`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `set_revision` | integer NOT NULL | INTEGER |
| `replaces_document_id` | uuid | UUID |
| `original_name` | text NOT NULL | TEXT |
| `mime` | text NOT NULL | TEXT |
| `size_bytes` | integer NOT NULL | INTEGER |
| `sha256` | text NOT NULL | TEXT |
| `storage_key` | uuid NOT NULL | UUID |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `case_version` | integer NOT NULL | INTEGER |
| `kind` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `payload` | jsonb NOT NULL | JSON |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `insurance_transfer_resolutions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `task_id` | uuid NOT NULL | UUID |
| `decision_id` | uuid | UUID |
| `conversion_id` | uuid | UUID |
| `verified_by` | text NOT NULL | TEXT |
| `verified_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `reference` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lab_dispositions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `stop_event_id` | uuid NOT NULL | UUID |
| `reversal_id` | uuid | UUID |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lab_processing`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `sample_id` | uuid | UUID |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lab_report_addenda`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `report_id` | uuid NOT NULL | UUID |
| `text` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lab_reports`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `sample_id` | uuid | UUID |
| `result` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lab_samples`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `order_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `patient_id` | uuid NOT NULL | UUID |
| `barcode` | text NOT NULL | VARCHAR(255) |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `lg_checkpoint_blobs`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `thread_id` | text NOT NULL | VARCHAR(128) |
| `checkpoint_ns` | text NOT NULL DEFAULT ''::text | VARCHAR(64) DEFAULT '' |
| `channel` | text NOT NULL | VARCHAR(128) |
| `version` | text NOT NULL | VARCHAR(128) |
| `type` | text NOT NULL | TEXT |
| `blob` | bytea | LONGBLOB |

### `lg_checkpoint_migrations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `v` | integer NOT NULL | INTEGER |

### `lg_checkpoint_writes`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `thread_id` | text NOT NULL | VARCHAR(128) |
| `checkpoint_ns` | text NOT NULL DEFAULT ''::text | VARCHAR(64) DEFAULT '' |
| `checkpoint_id` | text NOT NULL | VARCHAR(64) |
| `task_id` | text NOT NULL | VARCHAR(64) |
| `idx` | integer NOT NULL | INTEGER |
| `channel` | text NOT NULL | TEXT |
| `type` | text | TEXT |
| `blob` | bytea NOT NULL | LONGBLOB |

### `lg_checkpoints`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `thread_id` | text NOT NULL | VARCHAR(128) |
| `checkpoint_ns` | text NOT NULL DEFAULT ''::text | VARCHAR(64) DEFAULT '' |
| `checkpoint_id` | text NOT NULL | VARCHAR(64) |
| `parent_checkpoint_id` | text | TEXT |
| `type` | text | TEXT |
| `checkpoint` | jsonb NOT NULL | JSON |
| `metadata` | jsonb NOT NULL DEFAULT '{}'::jsonb | JSON DEFAULT '{}' |

### `medication_administrations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `occurrence_id` | uuid NOT NULL | UUID |
| `actual_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `actual_dose` | text NOT NULL | TEXT |
| `dose_unit` | text NOT NULL | TEXT |
| `outcome` | text NOT NULL | TEXT |
| `reason` | text | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `action` | text NOT NULL | TEXT |
| `check_key` | text | TEXT |
| `status` | text | TEXT |
| `payload` | jsonb NOT NULL | JSON |
| `review_hash` | text NOT NULL | TEXT |
| `bill_version` | integer NOT NULL | INTEGER |
| `clinical_id` | uuid | UUID |
| `checklist_id` | uuid | UUID |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_exception_events`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `action` | text NOT NULL | TEXT |
| `type` | text NOT NULL | TEXT |
| `source_id` | uuid | UUID |
| `payload` | jsonb NOT NULL | JSON |
| `bill_version` | integer NOT NULL | INTEGER |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_exceptional_departures`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `authority_id` | uuid NOT NULL | UUID |
| `clinical_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `departed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `snapshot` | jsonb NOT NULL | JSON |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_external_services`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `charge_id` | uuid NOT NULL | UUID |
| `category` | text NOT NULL | TEXT |
| `item_id` | text NOT NULL | TEXT |
| `quantity` | text NOT NULL | TEXT |
| `unit` | text NOT NULL | TEXT |
| `tariff_version_id` | uuid NOT NULL | UUID |
| `performed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `department_issuer` | text NOT NULL | VARCHAR(255) |
| `external_bill_reference` | text NOT NULL | VARCHAR(255) |
| `external_line_reference` | text NOT NULL | VARCHAR(255) |
| `evidence` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorder_name` | text NOT NULL | TEXT |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_invalidations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `event_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | TEXT |
| `source_id` | text NOT NULL | TEXT |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_medicine_sources`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | VARCHAR(255) |
| `original_id` | uuid | UUID |
| `charge_id` | uuid NOT NULL | UUID |
| `reversal_id` | uuid | UUID |
| `quantity` | text NOT NULL | TEXT |
| `quantity_scale` | integer NOT NULL | INTEGER |
| `evidence` | text NOT NULL | TEXT |
| `reference` | text NOT NULL | VARCHAR(255) |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `charge_id__chg` | (none: partial-index helper) | UUID VIRTUAL INVISIBLE AS IF(`kind` = 'CHARGE', `charge_id`, NULL) |

### `mvp_receivable_receipts`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `finance_id` | uuid | UUID |
| `receipt_id` | uuid NOT NULL | UUID |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `exception_authority_id` | uuid | UUID |
| `allocation_amendment_id` | uuid | UUID |

### `mvp_room_returns`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `vacation_id` | uuid NOT NULL | UUID |
| `authority_id` | uuid NOT NULL | UUID |
| `clinical_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `returned_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `handover` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_transfer_authorities`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `source_stay_id` | uuid NOT NULL | UUID |
| `external_doctor_id` | uuid NOT NULL | UUID |
| `authorizer_name` | text NOT NULL | TEXT |
| `source_time` | timestamp with time zone NOT NULL | DATETIME(6) |
| `destination_category` | text NOT NULL | TEXT |
| `evidence` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `version` | integer NOT NULL | INTEGER |
| `admission_version` | integer NOT NULL | INTEGER |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `mvp_transfer_cancellations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `authority_id` | uuid NOT NULL | UUID |
| `external_doctor_id` | uuid NOT NULL | UUID |
| `authorizer_name` | text NOT NULL | TEXT |
| `source_time` | timestamp with time zone NOT NULL | DATETIME(6) |
| `evidence` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nurse_assignment_revocations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `assignment_id` | uuid NOT NULL | UUID |
| `reason` | text NOT NULL | TEXT |
| `authority` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nurse_assignments`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `nurse_id` | text NOT NULL | VARCHAR(255) |
| `authority` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nursing_addenda`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `record_type` | text NOT NULL | TEXT |
| `record_id` | uuid NOT NULL | UUID |
| `reason` | text NOT NULL | TEXT |
| `text` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nursing_consumables`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `bed_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `used_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `item_id` | text NOT NULL | TEXT |
| `quantity` | text NOT NULL | TEXT |
| `unit` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nursing_observations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `occurrence_id` | uuid NOT NULL | UUID |
| `observed_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `values` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nursing_shift_ends`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `shift_id` | uuid NOT NULL | UUID |
| `ended_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `handover` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `nursing_shifts`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `nurse_id` | text NOT NULL | VARCHAR(255) |
| `started_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `handover` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `paperwork_followups`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `run_id` | uuid NOT NULL | UUID |
| `packet_id` | uuid NOT NULL | UUID |
| `owner_id` | text NOT NULL | VARCHAR(255) |
| `action` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `paperwork_packets`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `run_id` | uuid NOT NULL | UUID |
| `proposal_id` | uuid NOT NULL | UUID |
| `review_id` | uuid NOT NULL | UUID |
| `packet` | jsonb NOT NULL | JSON |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `paperwork_proposals`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `run_id` | uuid NOT NULL | UUID |
| `revision` | integer NOT NULL | INTEGER |
| `packet` | jsonb NOT NULL | JSON |
| `packet_hash` | text NOT NULL | TEXT |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `paperwork_reviews`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `run_id` | uuid NOT NULL | UUID |
| `revision` | integer NOT NULL | INTEGER |
| `decision` | text NOT NULL | TEXT |
| `comment` | text NOT NULL | TEXT |
| `request_id` | uuid NOT NULL | UUID |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `paperwork_runs`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `case_id` | uuid NOT NULL | UUID |
| `source` | jsonb NOT NULL | JSON |
| `source_hash` | text NOT NULL | TEXT |
| `status` | text NOT NULL DEFAULT 'PROCESSING'::text | TEXT DEFAULT 'PROCESSING' |
| `revision` | integer NOT NULL DEFAULT 0 | INTEGER DEFAULT 0 |
| `pending_review_id` | uuid | UUID |
| `recorded_by` | text NOT NULL | VARCHAR(255) |
| `recorded_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `patient_identifications`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `patient_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `version` | integer NOT NULL | INTEGER |
| `name` | text NOT NULL | TEXT |
| `date_of_birth` | date | DATE |
| `age_years_at_registration` | integer | INTEGER |
| `sex` | text NOT NULL | TEXT |
| `phone` | text | TEXT |
| `evidence` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `patients`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `uhid` | text NOT NULL | VARCHAR(255) |
| `name` | text NOT NULL | VARCHAR(255) |
| `date_of_birth` | date | DATE |
| `sex` | text NOT NULL | TEXT |
| `phone` | text | TEXT |
| `registered_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `registered_by` | text NOT NULL | VARCHAR(255) |
| `age_years_at_registration` | integer | INTEGER |
| `identity_status` | text NOT NULL DEFAULT 'KNOWN'::text | TEXT DEFAULT 'KNOWN' |
| `identity_provenance` | text | TEXT |

### `pharmacy_batches`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `hospital_id` | uuid NOT NULL | UUID |
| `medicine_id` | text NOT NULL | VARCHAR(255) |
| `catalog_version_id` | uuid NOT NULL | UUID |
| `batch_no` | text NOT NULL | VARCHAR(255) |
| `expires_on` | date NOT NULL | DATE |
| `unit` | text NOT NULL | TEXT |
| `quantity_scale` | integer NOT NULL | INTEGER |
| `barcode` | text NOT NULL | VARCHAR(255) |
| `available_quantity` | numeric(18,6) NOT NULL DEFAULT '0'::numeric | DECIMAL(18,6) DEFAULT 0 |
| `reorder_threshold` | numeric(18,6) | DECIMAL(18,6) |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `pharmacy_movements`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `batch_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid | UUID |
| `order_id` | uuid | UUID |
| `kind` | text NOT NULL | TEXT |
| `purpose` | text | TEXT |
| `quantity` | numeric(18,6) NOT NULL | DECIMAL(18,6) |
| `original_issue_id` | uuid | UUID |
| `charge_id` | uuid | UUID |
| `reversal_id` | uuid | UUID |
| `reference` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `reference__receipt` | (none: partial-index helper) | VARCHAR(500) VIRTUAL INVISIBLE AS IF(`kind` = 'RECEIPT', `reference`, NULL) |

### `pharmacy_preparations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `prescription_version_id` | uuid NOT NULL | UUID |
| `items` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `version` | integer NOT NULL | INTEGER |

### `post_discharge_amendments`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | TEXT |
| `source_id` | uuid NOT NULL | UUID |
| `result_id` | uuid NOT NULL | UUID |
| `before_snapshot` | jsonb NOT NULL | JSON |
| `after_snapshot` | jsonb NOT NULL | JSON |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `receipt_allocations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `receipt_id` | uuid NOT NULL | UUID |
| `amount_paise` | bigint NOT NULL | BIGINT |
| `reason` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `receipt_refunds`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `hospital_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `receipt_id` | uuid NOT NULL | UUID |
| `amount_paise` | bigint NOT NULL | BIGINT |
| `mode` | text NOT NULL | VARCHAR(255) |
| `channel` | text NOT NULL | VARCHAR(255) |
| `source_reference` | text NOT NULL | VARCHAR(255) |
| `evidence` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `refunded_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `reviewed_hash` | text NOT NULL | TEXT |
| `reviewed_bill_version` | integer NOT NULL | INTEGER |
| `identity_payload` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `receipts`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `hospital_id` | uuid NOT NULL | UUID |
| `admission_id` | uuid NOT NULL | UUID |
| `party` | text NOT NULL | TEXT |
| `kind` | text NOT NULL | TEXT |
| `amount_paise` | bigint NOT NULL | BIGINT |
| `mode` | text NOT NULL | VARCHAR(255) |
| `channel` | text NOT NULL | VARCHAR(255) |
| `source_reference` | text NOT NULL | VARCHAR(255) |
| `reference` | text NOT NULL | TEXT |
| `evidence_id` | text | TEXT |
| `identity_payload` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `room_returns`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `vacation_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `doctor_evidence_id` | uuid NOT NULL | UUID |
| `nurse_evidence_id` | uuid NOT NULL | UUID |
| `returned_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `room_stays`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `bed_id` | uuid NOT NULL | UUID |
| `tariff_version_id` | uuid NOT NULL | UUID |
| `started_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `ended_at` | timestamp with time zone | DATETIME(6) |
| `last_reconciled_at` | timestamp with time zone | DATETIME(6) |
| `posted_paise` | bigint NOT NULL DEFAULT 0 | BIGINT DEFAULT 0 |

### `room_vacations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `nursing_seal_id` | uuid | UUID |
| `shift_id` | uuid NOT NULL | UUID |
| `vacated_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `waiting_location` | text NOT NULL | TEXT |
| `handover` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `mvp_readiness_id` | uuid | UUID |
| `mvp_exception_id` | uuid | UUID |

### `self_pay_reviews`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `bill_basis` | text NOT NULL | TEXT |
| `net_paise` | bigint NOT NULL | BIGINT |
| `insurer_paise` | bigint NOT NULL | BIGINT |
| `patient_paise` | bigint NOT NULL | BIGINT |
| `reason` | text NOT NULL | TEXT |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `setting_versions`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `hospital_id` | uuid NOT NULL | UUID |
| `kind` | text NOT NULL | VARCHAR(255) |
| `version` | integer NOT NULL | INTEGER |
| `payload` | jsonb NOT NULL | JSON |
| `actor_type` | text NOT NULL | TEXT |
| `actor_id` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `staff_account`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | text NOT NULL | VARCHAR(255) |
| `account_id` | text NOT NULL | TEXT |
| `provider_id` | text NOT NULL | TEXT |
| `user_id` | text NOT NULL | VARCHAR(255) |
| `access_token` | text | TEXT |
| `refresh_token` | text | TEXT |
| `id_token` | text | TEXT |
| `access_token_expires_at` | timestamp with time zone | DATETIME(6) |
| `refresh_token_expires_at` | timestamp with time zone | DATETIME(6) |
| `scope` | text | TEXT |
| `password` | text | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `updated_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `staff_session`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | text NOT NULL | VARCHAR(255) |
| `expires_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `token` | text NOT NULL | VARCHAR(255) |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `updated_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `ip_address` | text | TEXT |
| `user_agent` | text | TEXT |
| `user_id` | text NOT NULL | VARCHAR(255) |
| `impersonated_by` | text | TEXT |

### `staff_user`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | text NOT NULL | VARCHAR(255) |
| `name` | text NOT NULL | TEXT |
| `email` | text NOT NULL | VARCHAR(255) |
| `email_verified` | boolean NOT NULL DEFAULT false | TINYINT(1) DEFAULT 0 |
| `image` | text | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `updated_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `role` | text NOT NULL DEFAULT 'ADMISSION'::text | TEXT DEFAULT 'ADMISSION' |
| `banned` | boolean NOT NULL DEFAULT false | TINYINT(1) DEFAULT 0 |
| `ban_reason` | text | TEXT |
| `ban_expires` | timestamp with time zone | DATETIME(6) |

### `staff_verification`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | text NOT NULL | VARCHAR(255) |
| `identifier` | text NOT NULL | VARCHAR(255) |
| `value` | text NOT NULL | TEXT |
| `expires_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `updated_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `stay_boundary_amendments`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `stay_id` | uuid NOT NULL | UUID |
| `exception_id` | uuid NOT NULL | UUID |
| `evidence_id` | uuid NOT NULL | UUID |
| `version` | integer NOT NULL | INTEGER |
| `started_at` | timestamp with time zone NOT NULL | DATETIME(6) |
| `ended_at` | timestamp with time zone | DATETIME(6) |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `transfer_insurance_tasks`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `transfer_id` | uuid NOT NULL | UUID |
| `owner_role` | text NOT NULL DEFAULT 'INSURANCE'::text | TEXT DEFAULT 'INSURANCE' |
| `reason` | text NOT NULL | TEXT |
| `created_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `transfer_order_cancellations`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `transfer_order_id` | uuid NOT NULL | UUID |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT clock_timestamp() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |

### `transfer_orders`

| Column | PostgreSQL | MariaDB |
|---|---|---|
| `id` | uuid NOT NULL DEFAULT gen_random_uuid() | UUID DEFAULT uuid() |
| `admission_id` | uuid NOT NULL | UUID |
| `source_stay_id` | uuid NOT NULL | UUID |
| `destination_category` | text NOT NULL | TEXT |
| `reason` | text NOT NULL | TEXT |
| `signed_by` | text NOT NULL | VARCHAR(255) |
| `signed_at` | timestamp with time zone NOT NULL DEFAULT now() | DATETIME(6) DEFAULT (UTC_TIMESTAMP(6)) |
| `version` | integer NOT NULL | INTEGER |
