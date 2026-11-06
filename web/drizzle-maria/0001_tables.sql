-- Tables are created empty: skipping FK validation while they are added is safe and ~7x faster.
SET foreign_key_checks = 0;
-- HIMS MariaDB 11.8 schema: tables, indexes, foreign keys (translated from tmp/port/pg-final-schema.sql).
-- Idempotent: every statement uses IF NOT EXISTS. Order: tables -> indexes -> foreign keys.
-- Conventions: docs/agent/MARIADB_PORT_CONVENTIONS.md. Column notes: web/drizzle-maria/TABLES_MANIFEST.md.
-- All tables use utf8mb4_nopad_bin (case- and trailing-space-sensitive, like PostgreSQL text equality).

-- ===== helper tables =====
CREATE TABLE IF NOT EXISTS `hims_locks` (
  `lock_key` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`lock_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `hims_migrations` (
  `name` VARCHAR(255) NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `applied_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- ===== tables =====
CREATE TABLE IF NOT EXISTS `admin_exceptions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `type` TEXT NOT NULL,
  `disposition` TEXT NOT NULL,
  `authority` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `evidence` TEXT NOT NULL,
  `evidence_ids` JSON NOT NULL,
  `source_id` UUID,
  `correction_kind` TEXT,
  `follow_up_owner_id` VARCHAR(255) NOT NULL,
  `snapshot` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `exception_authority_text` CHECK (((CHAR_LENGTH(TRIM(`authority`)) >= 3) AND (CHAR_LENGTH(TRIM(`reason`)) >= 3) AND (CHAR_LENGTH(TRIM(`evidence`)) >= 3)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `administrative_shift_ends` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `ended_at` DATETIME(6) NOT NULL,
  `evidence` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `administrative_shift_ends_shift_id_unique` UNIQUE (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `admission_counters` (
  `hospital_id` UUID NOT NULL,
  `year` INTEGER NOT NULL,
  `value` BIGINT NOT NULL,
  PRIMARY KEY (`hospital_id`, `year`),
  CONSTRAINT `admission_counter_positive` CHECK ((`value` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `admission_transfers` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `transfer_order_id` UUID,
  `old_stay_id` UUID NOT NULL,
  `new_stay_id` UUID NOT NULL,
  `old_bed_id` UUID NOT NULL,
  `target_bed_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `handover` TEXT NOT NULL,
  `transferred_at` DATETIME(6) NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `mvp_authority_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `admission_transfers_mvp_authority_id_key` UNIQUE (`mvp_authority_id`),
  CONSTRAINT `admission_transfers_new_stay_id_unique` UNIQUE (`new_stay_id`),
  CONSTRAINT `admission_transfers_old_stay_id_unique` UNIQUE (`old_stay_id`),
  CONSTRAINT `admission_transfers_transfer_order_id_unique` UNIQUE (`transfer_order_id`),
  CONSTRAINT `transfer_authority_exactly_one` CHECK (((`transfer_order_id` IS NOT NULL) <> (`mvp_authority_id` IS NOT NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `admissions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `hospital_id` UUID NOT NULL,
  `patient_id` UUID NOT NULL,
  `ip_code` VARCHAR(255) NOT NULL,
  `status` TEXT NOT NULL DEFAULT 'PENDING',
  `admitting_doctor_id` VARCHAR(255),
  `clinician_assessment` JSON,
  `bed_id` UUID NOT NULL,
  `payment_route` TEXT NOT NULL,
  `expected_stay_days` INTEGER NOT NULL,
  `registered_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `admitted_at` DATETIME(6),
  `cancelled_at` DATETIME(6),
  `cancellation_reason` TEXT,
  `created_by` VARCHAR(255) NOT NULL,
  `request_id` UUID NOT NULL,
  `request_payload` TEXT NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `bill_revision` INTEGER NOT NULL DEFAULT 1,
  `deposit_version_id` UUID,
  `workflow_version` INTEGER NOT NULL DEFAULT 1,
  `external_doctor_id` UUID,
  `patient_id__active` UUID GENERATED ALWAYS AS (IF(`status` IN ('PENDING', 'ADMITTED'), `patient_id`, NULL)) VIRTUAL INVISIBLE,
  PRIMARY KEY (`id`),
  CONSTRAINT `admissions_ip_code_unique` UNIQUE (`ip_code`),
  CONSTRAINT `admission_activation_time` CHECK (((`status` IN ('ADMITTED', 'DISCHARGED')) = (`admitted_at` IS NOT NULL))),
  CONSTRAINT `admission_cancel_record` CHECK (((`status` <> 'CANCELLED') OR ((`cancelled_at` IS NOT NULL) AND (CHAR_LENGTH(TRIM(`cancellation_reason`)) > 0)))),
  CONSTRAINT `admission_days` CHECK (((`expected_stay_days` >= 1) AND (`expected_stay_days` <= 365))),
  CONSTRAINT `admission_revisions_positive` CHECK (((`version` > 0) AND (`bill_revision` > 0))),
  CONSTRAINT `admission_route` CHECK ((`payment_route` IN ('SELF_PAY', 'INSURED'))),
  CONSTRAINT `admission_status` CHECK ((`status` IN ('PENDING', 'ADMITTED', 'CANCELLED', 'DISCHARGED'))),
  CONSTRAINT `admission_version_doctor_identity` CHECK ((((`workflow_version` = 1) AND (`admitting_doctor_id` IS NOT NULL) AND (`clinician_assessment` IS NOT NULL) AND (`external_doctor_id` IS NULL)) OR ((`workflow_version` = 2) AND (`external_doctor_id` IS NOT NULL) AND (`admitting_doctor_id` IS NULL) AND (`clinician_assessment` IS NULL)))),
  CONSTRAINT `admissions_workflow_version_check` CHECK ((`workflow_version` IN (1, 2)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `allocation_cancellations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `allocation_id` UUID NOT NULL,
  `reason` TEXT NOT NULL,
  `reviewed_hash` TEXT NOT NULL,
  `reviewed_bill_version` INTEGER NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `allocation_cancel_staff` CHECK ((`actor_type` = 'staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `audit_events` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `actor_type` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255) NOT NULL,
  `source` TEXT NOT NULL,
  `request_id` TEXT NOT NULL,
  `event` TEXT NOT NULL,
  `entity_type` VARCHAR(255) NOT NULL,
  `entity_id` VARCHAR(255) NOT NULL,
  `reason` TEXT NOT NULL,
  `before_version` INTEGER,
  `after_version` INTEGER,
  `occurred_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `audit_events_actor` CHECK ((((`actor_type` = 'staff') AND (CHAR_LENGTH(TRIM(`actor_id`)) > 0)) OR ((`actor_type` = 'system') AND (`actor_id` = 'room-charge')))),
  CONSTRAINT `audit_events_required_text` CHECK (((CHAR_LENGTH(TRIM(`source`)) > 0) AND (CHAR_LENGTH(TRIM(`request_id`)) > 0) AND (CHAR_LENGTH(TRIM(`event`)) > 0) AND (CHAR_LENGTH(TRIM(`entity_type`)) > 0) AND (CHAR_LENGTH(TRIM(`entity_id`)) > 0) AND (CHAR_LENGTH(TRIM(`reason`)) > 0))),
  CONSTRAINT `audit_events_versions` CHECK ((((`before_version` IS NULL) OR (`before_version` > 0)) AND ((`after_version` IS NULL) OR (`after_version` > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `availability_coordinators` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `nurse_id` VARCHAR(255) NOT NULL,
  `backup_nurse_id` VARCHAR(255),
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `version` INTEGER NOT NULL,
  `reason` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `request_id` UUID NOT NULL,
  `request_payload` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `availability_coordinators_recorded_by_request_id_key` UNIQUE (`recorded_by`, `request_id`),
  CONSTRAINT `availability_coordinators_version_key` UNIQUE (`version`),
  CONSTRAINT `availability_coordinators_check` CHECK ((`ends_at` > `starts_at`)),
  CONSTRAINT `availability_coordinators_check1` CHECK (((`backup_nurse_id` IS NULL) OR (`backup_nurse_id` <> `nurse_id`))),
  CONSTRAINT `availability_coordinators_reason_check` CHECK ((CHAR_LENGTH(TRIM(`reason`)) >= 3)),
  CONSTRAINT `availability_coordinators_version_check` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `bed_holds` (
  `bed_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `held_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`bed_id`),
  CONSTRAINT `bed_holds_admission_id_unique` UNIQUE (`admission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `bed_turnover_completions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `turnover_id` UUID NOT NULL,
  `completed_at` DATETIME(6) NOT NULL,
  `evidence` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `bed_turnovers` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `bed_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `vacated_at` DATETIME(6) NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `beds` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `label` VARCHAR(255) NOT NULL,
  `category` VARCHAR(255) NOT NULL,
  `category_version_id` UUID NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `beds_label_unique` UNIQUE (`label`),
  CONSTRAINT `beds_active_bool` CHECK (`active` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `billing_requests` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `actor_id` VARCHAR(255) NOT NULL,
  `request_id` UUID NOT NULL,
  `action` TEXT NOT NULL,
  `payload` TEXT NOT NULL,
  `result` JSON NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `care_billing_events` (
  `id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `order_id` UUID,
  `round_id` UUID,
  `category` TEXT NOT NULL,
  `item_id` TEXT NOT NULL,
  `quantity` TEXT NOT NULL,
  `unit` TEXT NOT NULL,
  `tariff_version_id` UUID,
  `resolution_reason` TEXT,
  `state` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `care_billing_state` CHECK ((`state` IN ('UNRESOLVED', 'READY', 'POSTED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `care_occurrences` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `order_id` UUID NOT NULL,
  `scheduled_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `care_tasks` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `owner_role` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `care_tasks_order_id_unique` UNIQUE (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `charge_finalizations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `charge_id` UUID NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `charge_reversals` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `charge_id` UUID NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `reason` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `correction_exception_id` UUID,
  `physical_amendment_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `reversal_amount` CHECK ((`amount_paise` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `charges` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `source_event_id` VARCHAR(255) NOT NULL,
  `source_payload` TEXT NOT NULL,
  `category` TEXT NOT NULL,
  `item_id` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `quantity` TEXT NOT NULL,
  `unit` TEXT NOT NULL,
  `tariff_version_id` UUID NOT NULL,
  `rate_paise` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `initial_status` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `correction_exception_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `charge_actor` CHECK ((((`actor_type` = 'staff') AND (CHAR_LENGTH(TRIM(`actor_id`)) > 0)) OR ((`actor_type` = 'system') AND (`actor_id` = 'room-charge') AND (`category` = 'room')))),
  CONSTRAINT `charge_amount` CHECK (((`amount_paise` >= 0) AND (`rate_paise` >= 0))),
  CONSTRAINT `charge_status` CHECK ((`initial_status` IN ('PENDING', 'FINAL')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clearance_invalidations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `seal_id` UUID NOT NULL,
  `change_kind` TEXT NOT NULL,
  `changed_record_ids` JSON NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clearance_seals` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `gate` VARCHAR(255) NOT NULL,
  `role` TEXT NOT NULL,
  `review_hash` TEXT NOT NULL,
  `bill_version` INTEGER,
  `predecessor_id` UUID,
  `inputs` JSON NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `clearance_bill_version` CHECK (((`gate` = 'BILLING') = (`bill_version` IS NOT NULL))),
  CONSTRAINT `clearance_gate_role` CHECK ((((`gate` = 'DOCTOR') AND (`role` = 'DOCTOR')) OR ((`gate` = 'PHARMACY') AND (`role` = 'PHARMACY')) OR ((`gate` = 'NURSING') AND (`role` = 'NURSE')) OR ((`gate` = 'BILLING') AND (`role` IN ('ADMIN', 'BILLING')))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clinical_addenda` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `note_id` UUID NOT NULL,
  `reason` TEXT NOT NULL,
  `text` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clinical_orders` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `round_id` UUID NOT NULL,
  `kind` TEXT NOT NULL,
  `requested_item` TEXT NOT NULL,
  `details` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `medicine_item_id` TEXT,
  `medicine_catalog_version_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `clinical_medicine_identity` CHECK (((`medicine_item_id` IS NULL) = (`medicine_catalog_version_id` IS NULL))),
  CONSTRAINT `clinical_order_kind` CHECK ((`kind` IN ('MEDICINE', 'LAB', 'RADIOLOGY', 'PROCEDURE', 'DIET', 'VITALS')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clinical_rounds` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `notes` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clinical_summaries` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `version` INTEGER NOT NULL,
  `diagnosis` TEXT NOT NULL,
  `course` TEXT NOT NULL,
  `condition` TEXT NOT NULL,
  `follow_up` TEXT NOT NULL,
  `advice` TEXT NOT NULL,
  `prescription` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `clinical_task_events` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `clinical_task_status` CHECK ((`status` IN ('COMPLETED', 'STOPPED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `departures` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `bill_seal_id` UUID,
  `departed_at` DATETIME(6) NOT NULL,
  `bill_version` INTEGER NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `mvp_finance_id` UUID,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `discharge_documents` (
  `id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `version` INTEGER NOT NULL,
  `replaces_document_id` UUID,
  `source_hash` VARCHAR(255) NOT NULL,
  `hash` TEXT NOT NULL,
  `snapshot` JSON NOT NULL,
  `storage_key` UUID NOT NULL,
  `pdf_hash` TEXT NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `created_by` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `schema_version` INTEGER NOT NULL DEFAULT 1,
  `kind` TEXT NOT NULL DEFAULT 'FINAL',
  PRIMARY KEY (`id`),
  CONSTRAINT `discharge_document_values` CHECK (((`version` > 0) AND (`size_bytes` > 0) AND (`size_bytes` <= 10485760) AND ((`hash` REGEXP '^[0-9a-f]{64}$' AND INSTR(`hash`, CHAR(10)) = 0)) AND ((`source_hash` REGEXP '^[0-9a-f]{64}$' AND INSTR(`source_hash`, CHAR(10)) = 0)) AND ((`pdf_hash` REGEXP '^[0-9a-f]{64}$' AND INSTR(`pdf_hash`, CHAR(10)) = 0)))),
  CONSTRAINT `discharge_documents_kind_check` CHECK ((`kind` IN ('CLINICAL', 'FINAL'))),
  CONSTRAINT `discharge_documents_schema_version_check` CHECK ((`schema_version` IN (1, 2)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `doctor_availability` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `doctor_id` UUID NOT NULL,
  `coordinator_id` UUID NOT NULL,
  `status` TEXT NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `expected_return` DATETIME(6),
  `remarks` TEXT NOT NULL,
  `version` INTEGER NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `request_id` UUID NOT NULL,
  `request_payload` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `doctor_availability_doctor_id_version_key` UNIQUE (`doctor_id`, `version`),
  CONSTRAINT `doctor_availability_recorded_by_request_id_key` UNIQUE (`recorded_by`, `request_id`),
  CONSTRAINT `doctor_availability_check` CHECK ((`ends_at` > `starts_at`)),
  CONSTRAINT `doctor_availability_check1` CHECK (((`expected_return` IS NULL) OR (`expected_return` >= `starts_at`))),
  CONSTRAINT `doctor_availability_remarks_check` CHECK ((CHAR_LENGTH(TRIM(`remarks`)) >= 3)),
  CONSTRAINT `doctor_availability_status_check` CHECK ((`status` IN ('AVAILABLE', 'OT', 'LEAVE', 'OFF_DUTY'))),
  CONSTRAINT `doctor_availability_version_check` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `doctor_directory` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `doctor_directory_versions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `doctor_id` UUID NOT NULL,
  `name` TEXT NOT NULL,
  `specialty` TEXT,
  `active` TINYINT(1) NOT NULL,
  `version` INTEGER NOT NULL,
  `reason` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `request_id` UUID NOT NULL,
  `request_payload` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `doctor_directory_versions_doctor_id_version_key` UNIQUE (`doctor_id`, `version`),
  CONSTRAINT `doctor_directory_versions_recorded_by_request_id_key` UNIQUE (`recorded_by`, `request_id`),
  CONSTRAINT `doctor_directory_versions_active_bool` CHECK (`active` IN (0, 1)),
  CONSTRAINT `doctor_directory_versions_name_check` CHECK (((CHAR_LENGTH(TRIM(`name`)) >= 2) AND (CHAR_LENGTH(TRIM(`name`)) <= 150))),
  CONSTRAINT `doctor_directory_versions_reason_check` CHECK ((CHAR_LENGTH(TRIM(`reason`)) >= 3)),
  CONSTRAINT `doctor_directory_versions_version_check` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `exception_evidence` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `kind` TEXT NOT NULL,
  `role` TEXT NOT NULL,
  `shift_id` UUID,
  `source_id` UUID,
  `actual_at` DATETIME(6) NOT NULL,
  `vacated_at` DATETIME(6),
  `notes` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `exception_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `exception_evidence_role` CHECK ((((`kind` IN ('PHYSICAL_EXIT', 'TRANSFER_HANDOVER', 'RETURN_HANDOVER', 'ROOM_CUTOFF')) AND (`role` = 'NURSE') AND (`shift_id` IS NOT NULL)) OR ((`kind` NOT IN ('PHYSICAL_EXIT', 'TRANSFER_HANDOVER', 'RETURN_HANDOVER', 'ROOM_CUTOFF')) AND (`role` = 'DOCTOR'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `exception_followups` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `exception_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `note` TEXT NOT NULL,
  `owner_id` VARCHAR(255) NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `exceptional_departures` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `physical_evidence_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `departed_at` DATETIME(6) NOT NULL,
  `snapshot` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `exceptional_departures_admission_id_unique` UNIQUE (`admission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `hospital_settings` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `name` TEXT NOT NULL,
  `timezone` TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  `identity` JSON NOT NULL DEFAULT '{}',
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_cases` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `assigned_staff_id` VARCHAR(255),
  `version` INTEGER NOT NULL DEFAULT 1,
  `review_revision` INTEGER NOT NULL DEFAULT 1,
  `document_set_revision` INTEGER NOT NULL DEFAULT 0,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `insurance_case_versions` CHECK (((`version` > 0) AND (`review_revision` > 0) AND (`document_set_revision` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_conversions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `case_version` INTEGER NOT NULL,
  `reason` TEXT NOT NULL,
  `decision_reference` TEXT NOT NULL,
  `verified_by` TEXT NOT NULL,
  `verified_at` DATETIME(6) NOT NULL,
  `allocation` JSON NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_decisions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `case_version` INTEGER NOT NULL,
  `policy_event_id` UUID NOT NULL,
  `status` TEXT NOT NULL,
  `kind` TEXT NOT NULL,
  `verified_by` TEXT NOT NULL,
  `verified_at` DATETIME(6) NOT NULL,
  `reference` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `approved_paise` BIGINT NOT NULL,
  `co_pay_bps` INTEGER NOT NULL,
  `allocation` JSON NOT NULL,
  `document_ids` JSON NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `insurance_decision_kind` CHECK ((`kind` IN ('PREAUTH', 'ENHANCEMENT', 'APPEAL'))),
  CONSTRAINT `insurance_decision_money` CHECK (((`approved_paise` >= 0) AND ((`co_pay_bps` >= 0) AND (`co_pay_bps` <= 10000)) AND ((`status` NOT IN ('PENDING', 'REJECTED')) OR (`approved_paise` = 0)))),
  CONSTRAINT `insurance_decision_status` CHECK ((`status` IN ('PENDING', 'APPROVED', 'PARTIAL', 'REJECTED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_documents` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `set_revision` INTEGER NOT NULL,
  `replaces_document_id` UUID,
  `original_name` TEXT NOT NULL,
  `mime` TEXT NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `sha256` TEXT NOT NULL,
  `storage_key` UUID NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `insurance_document_size` CHECK (((`size_bytes` > 0) AND (`set_revision` > 0) AND ((`sha256` REGEXP '^[a-f0-9]{64}$' AND INSTR(`sha256`, CHAR(10)) = 0)))),
  CONSTRAINT `insurance_document_type` CHECK ((`mime` IN ('application/pdf', 'image/jpeg', 'image/png')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_events` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `case_version` INTEGER NOT NULL,
  `kind` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `payload` JSON NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `insurance_event_kind` CHECK ((`kind` IN ('ASSIGNMENT', 'POLICY', 'FOLLOWUP')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `insurance_transfer_resolutions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `task_id` UUID NOT NULL,
  `decision_id` UUID,
  `conversion_id` UUID,
  `verified_by` TEXT NOT NULL,
  `verified_at` DATETIME(6) NOT NULL,
  `reference` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `insurance_transfer_source` CHECK (((`decision_id` IS NOT NULL) <> (`conversion_id` IS NOT NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lab_dispositions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `stop_event_id` UUID NOT NULL,
  `reversal_id` UUID,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `lab_dispositions_order_id_key` UNIQUE (`order_id`),
  CONSTRAINT `lab_dispositions_reason_check` CHECK (((CHAR_LENGTH(TRIM(`reason`)) >= 3) AND (CHAR_LENGTH(TRIM(`reason`)) <= 500)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lab_processing` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `sample_id` UUID,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `lab_processing_order_id_key` UNIQUE (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lab_report_addenda` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `report_id` UUID NOT NULL,
  `text` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `lab_report_addenda_reason_check` CHECK (((CHAR_LENGTH(TRIM(`reason`)) >= 3) AND (CHAR_LENGTH(TRIM(`reason`)) <= 500))),
  CONSTRAINT `lab_report_addenda_text_check` CHECK (((CHAR_LENGTH(TRIM(`text`)) >= 1) AND (CHAR_LENGTH(TRIM(`text`)) <= 5000)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lab_reports` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `sample_id` UUID,
  `result` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `lab_reports_order_id_key` UNIQUE (`order_id`),
  CONSTRAINT `lab_reports_result_check` CHECK (((CHAR_LENGTH(TRIM(`result`)) >= 1) AND (CHAR_LENGTH(TRIM(`result`)) <= 5000)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lab_samples` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `order_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `patient_id` UUID NOT NULL,
  `barcode` VARCHAR(255) NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `lab_samples_barcode_key` UNIQUE (`barcode`),
  CONSTRAINT `lab_samples_order_id_key` UNIQUE (`order_id`),
  CONSTRAINT `lab_samples_barcode_check` CHECK (((`barcode` REGEXP '^SMP-[A-F0-9]{32}$' AND INSTR(`barcode`, CHAR(10)) = 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lg_checkpoint_blobs` (
  `thread_id` VARCHAR(128) NOT NULL,
  `checkpoint_ns` VARCHAR(64) NOT NULL DEFAULT '',
  `channel` VARCHAR(128) NOT NULL,
  `version` VARCHAR(128) NOT NULL,
  `type` TEXT NOT NULL,
  `blob` LONGBLOB,
  PRIMARY KEY (`thread_id`, `checkpoint_ns`, `channel`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lg_checkpoint_migrations` (
  `v` INTEGER NOT NULL,
  PRIMARY KEY (`v`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lg_checkpoint_writes` (
  `thread_id` VARCHAR(128) NOT NULL,
  `checkpoint_ns` VARCHAR(64) NOT NULL DEFAULT '',
  `checkpoint_id` VARCHAR(64) NOT NULL,
  `task_id` VARCHAR(64) NOT NULL,
  `idx` INTEGER NOT NULL,
  `channel` TEXT NOT NULL,
  `type` TEXT,
  `blob` LONGBLOB NOT NULL,
  PRIMARY KEY (`thread_id`, `checkpoint_ns`, `checkpoint_id`, `task_id`, `idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `lg_checkpoints` (
  `thread_id` VARCHAR(128) NOT NULL,
  `checkpoint_ns` VARCHAR(64) NOT NULL DEFAULT '',
  `checkpoint_id` VARCHAR(64) NOT NULL,
  `parent_checkpoint_id` TEXT,
  `type` TEXT,
  `checkpoint` JSON NOT NULL,
  `metadata` JSON NOT NULL DEFAULT '{}',
  PRIMARY KEY (`thread_id`, `checkpoint_ns`, `checkpoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `medication_administrations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `occurrence_id` UUID NOT NULL,
  `actual_at` DATETIME(6) NOT NULL,
  `actual_dose` TEXT NOT NULL,
  `dose_unit` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `reason` TEXT,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `medication_administrations_occurrence_id_unique` UNIQUE (`occurrence_id`),
  CONSTRAINT `mar_outcome` CHECK ((`outcome` IN ('GIVEN', 'HELD', 'REFUSED'))),
  CONSTRAINT `mar_reason` CHECK (((`outcome` = 'GIVEN') OR (CHAR_LENGTH(TRIM(`reason`)) > 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_events` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `action` TEXT NOT NULL,
  `check_key` TEXT,
  `status` TEXT,
  `payload` JSON NOT NULL,
  `review_hash` TEXT NOT NULL,
  `bill_version` INTEGER NOT NULL,
  `clinical_id` UUID,
  `checklist_id` UUID,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_events_action_check` CHECK ((`action` IN ('doctor-approval', 'checklist', 'check', 'n-a', 'finance', 'deliver'))),
  CONSTRAINT `mvp_events_review_hash_check` CHECK (((`review_hash` REGEXP '^[0-9a-f]{64}$' AND INSTR(`review_hash`, CHAR(10)) = 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_exception_events` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `action` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `source_id` UUID,
  `payload` JSON NOT NULL,
  `bill_version` INTEGER NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_exception_events_action_check` CHECK ((`action` IN ('CLINICAL', 'AUTHORITY', 'FOLLOWUP', 'VACANCY', 'DELIVERY')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_exceptional_departures` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `authority_id` UUID NOT NULL,
  `clinical_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `departed_at` DATETIME(6) NOT NULL,
  `snapshot` JSON NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_exceptional_departures_admission_id_key` UNIQUE (`admission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_external_services` (
  `id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `charge_id` UUID NOT NULL,
  `category` TEXT NOT NULL,
  `item_id` TEXT NOT NULL,
  `quantity` TEXT NOT NULL,
  `unit` TEXT NOT NULL,
  `tariff_version_id` UUID NOT NULL,
  `performed_at` DATETIME(6) NOT NULL,
  `department_issuer` VARCHAR(255) NOT NULL,
  `external_bill_reference` VARCHAR(255) NOT NULL,
  `external_line_reference` VARCHAR(255) NOT NULL,
  `evidence` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorder_name` TEXT NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_external_bill_line_once` UNIQUE (`admission_id`, `department_issuer`, `external_bill_reference`, `external_line_reference`),
  CONSTRAINT `mvp_external_services_charge_id_key` UNIQUE (`charge_id`),
  CONSTRAINT `mvp_external_services_category_check` CHECK ((`category` IN ('consultation', 'procedure', 'consumable', 'lab', 'radiology')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_invalidations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `event_id` UUID NOT NULL,
  `kind` TEXT NOT NULL,
  `source_id` TEXT NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_invalidations_event_id_key` UNIQUE (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_medicine_sources` (
  `id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `original_id` UUID,
  `charge_id` UUID NOT NULL,
  `reversal_id` UUID,
  `quantity` TEXT NOT NULL,
  `quantity_scale` INTEGER NOT NULL,
  `evidence` TEXT NOT NULL,
  `reference` VARCHAR(255) NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `charge_id__chg` UUID GENERATED ALWAYS AS (IF(`kind` = 'CHARGE', `charge_id`, NULL)) VIRTUAL INVISIBLE,
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_medicine_sources_admission_id_kind_reference_key` UNIQUE (`admission_id`, `kind`, `reference`),
  CONSTRAINT `mvp_medicine_sources_evidence_check` CHECK ((CHAR_LENGTH(TRIM(`evidence`)) >= 3)),
  CONSTRAINT `mvp_medicine_sources_kind_check` CHECK ((`kind` IN ('CHARGE', 'RETURN'))),
  CONSTRAINT `mvp_medicine_sources_quantity_check` CHECK ((((`quantity` REGEXP '^[0-9]{1,12}([.][0-9]{1,6})?$' AND INSTR(`quantity`, CHAR(10)) = 0)) AND (CAST(`quantity` AS DECIMAL(18,6)) > 0))),
  CONSTRAINT `mvp_medicine_sources_quantity_scale_check` CHECK (((`quantity_scale` >= 0) AND (`quantity_scale` <= 6)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_receivable_receipts` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `finance_id` UUID,
  `receipt_id` UUID NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `exception_authority_id` UUID,
  `allocation_amendment_id` UUID,
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_receivable_receipts_receipt_id_key` UNIQUE (`receipt_id`),
  CONSTRAINT `mvp_receivable_original_authority` CHECK (((`finance_id` IS NULL) <> (`exception_authority_id` IS NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_room_returns` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `vacation_id` UUID NOT NULL,
  `authority_id` UUID NOT NULL,
  `clinical_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `returned_at` DATETIME(6) NOT NULL,
  `handover` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_room_returns_stay_id_key` UNIQUE (`stay_id`),
  CONSTRAINT `mvp_room_returns_vacation_id_key` UNIQUE (`vacation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_transfer_authorities` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `source_stay_id` UUID NOT NULL,
  `external_doctor_id` UUID NOT NULL,
  `authorizer_name` TEXT NOT NULL,
  `source_time` DATETIME(6) NOT NULL,
  `destination_category` TEXT NOT NULL,
  `evidence` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `version` INTEGER NOT NULL,
  `admission_version` INTEGER NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_transfer_authorities_admission_id_version_key` UNIQUE (`admission_id`, `version`),
  CONSTRAINT `mvp_transfer_authorities_admission_version_check` CHECK ((`admission_version` > 0)),
  CONSTRAINT `mvp_transfer_authorities_authorizer_name_check` CHECK (((CHAR_LENGTH(TRIM(`authorizer_name`)) >= 2) AND (CHAR_LENGTH(TRIM(`authorizer_name`)) <= 150))),
  CONSTRAINT `mvp_transfer_authorities_check` CHECK ((`source_time` <= `recorded_at`)),
  CONSTRAINT `mvp_transfer_authorities_destination_category_check` CHECK (((`destination_category` REGEXP '^[A-Z0-9_-]{2,32}$' AND INSTR(`destination_category`, CHAR(10)) = 0))),
  CONSTRAINT `mvp_transfer_authorities_evidence_check` CHECK ((CHAR_LENGTH(TRIM(`evidence`)) >= 3)),
  CONSTRAINT `mvp_transfer_authorities_reason_check` CHECK ((CHAR_LENGTH(TRIM(`reason`)) >= 3)),
  CONSTRAINT `mvp_transfer_authorities_version_check` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `mvp_transfer_cancellations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `authority_id` UUID NOT NULL,
  `external_doctor_id` UUID NOT NULL,
  `authorizer_name` TEXT NOT NULL,
  `source_time` DATETIME(6) NOT NULL,
  `evidence` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `mvp_transfer_cancellations_authority_id_key` UNIQUE (`authority_id`),
  CONSTRAINT `mvp_transfer_cancellations_authorizer_name_check` CHECK (((CHAR_LENGTH(TRIM(`authorizer_name`)) >= 2) AND (CHAR_LENGTH(TRIM(`authorizer_name`)) <= 150))),
  CONSTRAINT `mvp_transfer_cancellations_check` CHECK ((`source_time` <= `recorded_at`)),
  CONSTRAINT `mvp_transfer_cancellations_evidence_check` CHECK ((CHAR_LENGTH(TRIM(`evidence`)) >= 3)),
  CONSTRAINT `mvp_transfer_cancellations_reason_check` CHECK ((CHAR_LENGTH(TRIM(`reason`)) >= 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nurse_assignment_revocations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `assignment_id` UUID NOT NULL,
  `reason` TEXT NOT NULL,
  `authority` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `nurse_assignment_revocations_assignment_id_unique` UNIQUE (`assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nurse_assignments` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `nurse_id` VARCHAR(255) NOT NULL,
  `authority` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nursing_addenda` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `record_type` TEXT NOT NULL,
  `record_id` UUID NOT NULL,
  `reason` TEXT NOT NULL,
  `text` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `nursing_addendum_type` CHECK ((`record_type` IN ('MAR', 'OBSERVATION', 'SHIFT', 'CONSUMABLE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nursing_consumables` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `bed_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `used_at` DATETIME(6) NOT NULL,
  `item_id` TEXT NOT NULL,
  `quantity` TEXT NOT NULL,
  `unit` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nursing_observations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `shift_id` UUID NOT NULL,
  `occurrence_id` UUID NOT NULL,
  `observed_at` DATETIME(6) NOT NULL,
  `values` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `nursing_observations_occurrence_id_unique` UNIQUE (`occurrence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nursing_shift_ends` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `shift_id` UUID NOT NULL,
  `ended_at` DATETIME(6) NOT NULL,
  `handover` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `nursing_shift_ends_shift_id_unique` UNIQUE (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `nursing_shifts` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `nurse_id` VARCHAR(255) NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `handover` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `paperwork_followups` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `run_id` UUID NOT NULL,
  `packet_id` UUID NOT NULL,
  `owner_id` VARCHAR(255) NOT NULL,
  `action` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `paperwork_packets` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `run_id` UUID NOT NULL,
  `proposal_id` UUID NOT NULL,
  `review_id` UUID NOT NULL,
  `packet` JSON NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `paperwork_proposals` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `run_id` UUID NOT NULL,
  `revision` INTEGER NOT NULL,
  `packet` JSON NOT NULL,
  `packet_hash` TEXT NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `paperwork_proposal_bound` CHECK ((((`revision` >= 1) AND (`revision` <= 3)) AND ((`packet_hash` REGEXP '^[a-f0-9]{64}$' AND INSTR(`packet_hash`, CHAR(10)) = 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `paperwork_reviews` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `run_id` UUID NOT NULL,
  `revision` INTEGER NOT NULL,
  `decision` TEXT NOT NULL,
  `comment` TEXT NOT NULL,
  `request_id` UUID NOT NULL,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `paperwork_review_decision` CHECK (((`decision` IN ('ACCEPT', 'REQUEST_CHANGES', 'REJECT')) AND ((`revision` >= 1) AND (`revision` <= 3)) AND ((`decision` <> 'REQUEST_CHANGES') OR (`revision` < 3))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `paperwork_runs` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `case_id` UUID NOT NULL,
  `source` JSON NOT NULL,
  `source_hash` TEXT NOT NULL,
  `status` TEXT NOT NULL DEFAULT 'PROCESSING',
  `revision` INTEGER NOT NULL DEFAULT 0,
  `pending_review_id` UUID,
  `recorded_by` VARCHAR(255) NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `paperwork_run_state` CHECK (((`status` IN ('PROCESSING', 'AWAITING_REVIEW', 'ACCEPTED', 'REJECTED')) AND ((`revision` >= 0) AND (`revision` <= 3)) AND ((`source_hash` REGEXP '^[a-f0-9]{64}$' AND INSTR(`source_hash`, CHAR(10)) = 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `patient_identifications` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `patient_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `version` INTEGER NOT NULL,
  `name` TEXT NOT NULL,
  `date_of_birth` DATE,
  `age_years_at_registration` INTEGER,
  `sex` TEXT NOT NULL,
  `phone` TEXT,
  `evidence` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `identified_patient_age` CHECK (((`date_of_birth` IS NOT NULL) <> (`age_years_at_registration` IS NOT NULL))),
  CONSTRAINT `identified_patient_values` CHECK (((`sex` IN ('FEMALE', 'MALE', 'OTHER', 'UNKNOWN')) AND ((`age_years_at_registration` IS NULL) OR ((`age_years_at_registration` >= 0) AND (`age_years_at_registration` <= 130))) AND (`version` > 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `patients` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `uhid` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `date_of_birth` DATE,
  `sex` TEXT NOT NULL,
  `phone` TEXT,
  `registered_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `registered_by` VARCHAR(255) NOT NULL,
  `age_years_at_registration` INTEGER,
  `identity_status` TEXT NOT NULL DEFAULT 'KNOWN',
  `identity_provenance` TEXT,
  PRIMARY KEY (`id`),
  CONSTRAINT `patients_uhid_unique` UNIQUE (`uhid`),
  CONSTRAINT `patient_age_identity` CHECK ((((`date_of_birth` IS NOT NULL) <> (`age_years_at_registration` IS NOT NULL)) OR ((`identity_status` = 'TEMPORARY') AND (`date_of_birth` IS NULL) AND (`age_years_at_registration` IS NULL)))),
  CONSTRAINT `patient_age_range` CHECK (((`age_years_at_registration` IS NULL) OR ((`age_years_at_registration` >= 0) AND (`age_years_at_registration` <= 130)))),
  CONSTRAINT `patient_identity_provenance` CHECK (((`identity_status` IN ('KNOWN', 'TEMPORARY')) AND ((`identity_status` = 'KNOWN') OR (CHAR_LENGTH(TRIM(`identity_provenance`)) >= 3)))),
  CONSTRAINT `patients_sex` CHECK ((`sex` IN ('FEMALE', 'MALE', 'OTHER', 'UNKNOWN')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `pharmacy_batches` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `hospital_id` UUID NOT NULL,
  `medicine_id` VARCHAR(255) NOT NULL,
  `catalog_version_id` UUID NOT NULL,
  `batch_no` VARCHAR(255) NOT NULL,
  `expires_on` DATE NOT NULL,
  `unit` TEXT NOT NULL,
  `quantity_scale` INTEGER NOT NULL,
  `barcode` VARCHAR(255) NOT NULL,
  `available_quantity` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `reorder_threshold` DECIMAL(18,6),
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `pharmacy_stock_nonnegative` CHECK (((`available_quantity` >= 0) AND ((`reorder_threshold` IS NULL) OR (`reorder_threshold` >= 0)) AND ((`quantity_scale` >= 0) AND (`quantity_scale` <= 6))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `pharmacy_movements` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `batch_id` UUID NOT NULL,
  `admission_id` UUID,
  `order_id` UUID,
  `kind` TEXT NOT NULL,
  `purpose` TEXT,
  `quantity` DECIMAL(18,6) NOT NULL,
  `original_issue_id` UUID,
  `charge_id` UUID,
  `reversal_id` UUID,
  `reference` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `reference__receipt` VARCHAR(500) GENERATED ALWAYS AS (IF(`kind` = 'RECEIPT', `reference`, NULL)) VIRTUAL INVISIBLE,
  PRIMARY KEY (`id`),
  CONSTRAINT `pharmacy_movement_kind` CHECK ((((`kind` = 'RECEIPT') AND (`quantity` > 0) AND (`admission_id` IS NULL) AND (`order_id` IS NULL) AND (`original_issue_id` IS NULL) AND (`purpose` IS NULL) AND (`charge_id` IS NULL) AND (`reversal_id` IS NULL)) OR ((`kind` = 'ADJUSTMENT') AND (`quantity` <> 0) AND (`admission_id` IS NULL) AND (`order_id` IS NULL) AND (`original_issue_id` IS NULL) AND (`purpose` IS NULL) AND (`charge_id` IS NULL) AND (`reversal_id` IS NULL)) OR ((`kind` = 'ISSUE') AND (`quantity` < 0) AND (`admission_id` IS NOT NULL) AND (`order_id` IS NOT NULL) AND (`purpose` IN ('WARD', 'TAKE_HOME')) AND (`charge_id` IS NOT NULL) AND (`original_issue_id` IS NULL) AND (`reversal_id` IS NULL)) OR ((`kind` = 'RETURN') AND (`quantity` > 0) AND (`admission_id` IS NOT NULL) AND (`order_id` IS NOT NULL) AND (`purpose` IN ('WARD', 'TAKE_HOME')) AND (`charge_id` IS NOT NULL) AND (`original_issue_id` IS NOT NULL)))),
  CONSTRAINT `pharmacy_receipt_reference_canonical` CHECK ((`kind` <> 'RECEIPT') OR ((`reference` NOT REGEXP '^[\\t\\n\\x{0B}\\f\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]|[\\t\\n\\x{0B}\\f\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]\\z') AND (CHAR_LENGTH(`reference`) >= 3 AND CHAR_LENGTH(`reference`) <= 500)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `pharmacy_preparations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `prescription_version_id` UUID NOT NULL,
  `items` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `version` INTEGER NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `pharmacy_preparation_positive` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `post_discharge_amendments` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `kind` TEXT NOT NULL,
  `source_id` UUID NOT NULL,
  `result_id` UUID NOT NULL,
  `before_snapshot` JSON NOT NULL,
  `after_snapshot` JSON NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `receipt_allocations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `receipt_id` UUID NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `reason` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `allocation_amount` CHECK ((`amount_paise` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `receipt_refunds` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `hospital_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `receipt_id` UUID NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `mode` VARCHAR(255) NOT NULL,
  `channel` VARCHAR(255) NOT NULL,
  `source_reference` VARCHAR(255) NOT NULL,
  `evidence` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `refunded_at` DATETIME(6) NOT NULL,
  `reviewed_hash` TEXT NOT NULL,
  `reviewed_bill_version` INTEGER NOT NULL,
  `identity_payload` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `refund_amount` CHECK ((`amount_paise` > 0)),
  CONSTRAINT `refund_mode` CHECK ((`mode` IN ('CASH', 'CARD', 'UPI', 'BANK'))),
  CONSTRAINT `refund_staff` CHECK ((`actor_type` = 'staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `receipts` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `hospital_id` UUID NOT NULL,
  `admission_id` UUID NOT NULL,
  `party` TEXT NOT NULL,
  `kind` TEXT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `mode` VARCHAR(255) NOT NULL,
  `channel` VARCHAR(255) NOT NULL,
  `source_reference` VARCHAR(255) NOT NULL,
  `reference` TEXT NOT NULL,
  `evidence_id` TEXT,
  `identity_payload` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `receipt_amount` CHECK ((`amount_paise` > 0)),
  CONSTRAINT `receipt_human` CHECK (((`actor_type` = 'staff') AND (CHAR_LENGTH(TRIM(`actor_id`)) > 0))),
  CONSTRAINT `receipt_mode` CHECK ((`mode` IN ('CASH', 'CARD', 'UPI', 'BANK'))),
  CONSTRAINT `receipt_party_kind` CHECK ((((`party` = 'PATIENT') AND (`kind` IN ('DEPOSIT', 'TOP_UP', 'PAYMENT'))) OR ((`party` = 'INSURER') AND (`kind` = 'PAYMENT'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `room_returns` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `vacation_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `doctor_evidence_id` UUID NOT NULL,
  `nurse_evidence_id` UUID NOT NULL,
  `returned_at` DATETIME(6) NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `room_returns_stay_id_unique` UNIQUE (`stay_id`),
  CONSTRAINT `room_returns_vacation_id_unique` UNIQUE (`vacation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `room_stays` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `bed_id` UUID NOT NULL,
  `tariff_version_id` UUID NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `ended_at` DATETIME(6),
  `last_reconciled_at` DATETIME(6),
  `posted_paise` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `room_stay_boundary` CHECK (((`ended_at` IS NULL) OR (`ended_at` > `started_at`))),
  CONSTRAINT `room_stay_cursor_boundary` CHECK (((`last_reconciled_at` IS NULL) OR ((`last_reconciled_at` >= `started_at`) AND ((`ended_at` IS NULL) OR (`last_reconciled_at` <= `ended_at`))))),
  CONSTRAINT `room_stay_posted_positive` CHECK ((`posted_paise` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `room_vacations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `nursing_seal_id` UUID,
  `shift_id` UUID NOT NULL,
  `vacated_at` DATETIME(6) NOT NULL,
  `waiting_location` TEXT NOT NULL,
  `handover` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `mvp_readiness_id` UUID,
  `mvp_exception_id` UUID,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `self_pay_reviews` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `bill_basis` TEXT NOT NULL,
  `net_paise` BIGINT NOT NULL,
  `insurer_paise` BIGINT NOT NULL,
  `patient_paise` BIGINT NOT NULL,
  `reason` TEXT NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `self_pay_review_amounts` CHECK (((`net_paise` >= 0) AND (`insurer_paise` >= 0) AND (`patient_paise` >= 0) AND ((`insurer_paise` + `patient_paise`) = `net_paise`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `setting_versions` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `hospital_id` UUID NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `version` INTEGER NOT NULL,
  `payload` JSON NOT NULL,
  `actor_type` TEXT NOT NULL,
  `actor_id` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `setting_versions_hospital_kind_version` UNIQUE (`hospital_id`, `kind`, `version`),
  CONSTRAINT `setting_versions_actor` CHECK (((`actor_type` = 'staff') AND (CHAR_LENGTH(TRIM(`actor_id`)) > 0))),
  CONSTRAINT `setting_versions_kind` CHECK ((`kind` IN ('tariff', 'rule'))),
  CONSTRAINT `setting_versions_positive` CHECK ((`version` > 0)),
  CONSTRAINT `setting_versions_reason` CHECK ((CHAR_LENGTH(TRIM(`reason`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `staff_account` (
  `id` VARCHAR(255) NOT NULL,
  `account_id` TEXT NOT NULL,
  `provider_id` TEXT NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `access_token` TEXT,
  `refresh_token` TEXT,
  `id_token` TEXT,
  `access_token_expires_at` DATETIME(6),
  `refresh_token_expires_at` DATETIME(6),
  `scope` TEXT,
  `password` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `staff_session` (
  `id` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `ip_address` TEXT,
  `user_agent` TEXT,
  `user_id` VARCHAR(255) NOT NULL,
  `impersonated_by` TEXT,
  PRIMARY KEY (`id`),
  CONSTRAINT `staff_session_token_unique` UNIQUE (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `staff_user` (
  `id` VARCHAR(255) NOT NULL,
  `name` TEXT NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `email_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `image` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `role` TEXT NOT NULL DEFAULT 'ADMISSION',
  `banned` TINYINT(1) NOT NULL DEFAULT 0,
  `ban_reason` TEXT,
  `ban_expires` DATETIME(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `staff_user_email_unique` UNIQUE (`email`),
  CONSTRAINT `staff_user_email_verified_bool` CHECK (`email_verified` IN (0, 1)),
  CONSTRAINT `staff_user_banned_bool` CHECK (`banned` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `staff_verification` (
  `id` VARCHAR(255) NOT NULL,
  `identifier` VARCHAR(255) NOT NULL,
  `value` TEXT NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `stay_boundary_amendments` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `stay_id` UUID NOT NULL,
  `exception_id` UUID NOT NULL,
  `evidence_id` UUID NOT NULL,
  `version` INTEGER NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `ended_at` DATETIME(6),
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `stay_amendment_bounds` CHECK (((`version` > 0) AND ((`ended_at` IS NULL) OR (`ended_at` > `started_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `transfer_insurance_tasks` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `transfer_id` UUID NOT NULL,
  `owner_role` TEXT NOT NULL DEFAULT 'INSURANCE',
  `reason` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `transfer_insurance_tasks_transfer_id_unique` UNIQUE (`transfer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `transfer_order_cancellations` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `transfer_order_id` UUID NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  CONSTRAINT `transfer_order_cancellations_transfer_order_id_unique` UNIQUE (`transfer_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS `transfer_orders` (
  `id` UUID NOT NULL DEFAULT uuid(),
  `admission_id` UUID NOT NULL,
  `source_stay_id` UUID NOT NULL,
  `destination_category` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `signed_by` VARCHAR(255) NOT NULL,
  `signed_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `version` INTEGER NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- ===== indexes =====
CREATE INDEX IF NOT EXISTS `admin_shift_end_authority` ON `administrative_shift_ends` (`exception_id`);
CREATE INDEX IF NOT EXISTS `admin_shift_end_episode` ON `administrative_shift_ends` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `admission_retry_idx` ON `admissions` (`created_by`, `request_id`);
CREATE INDEX IF NOT EXISTS `admission_transfers_episode_idx` ON `admission_transfers` (`admission_id`);
CREATE INDEX IF NOT EXISTS `admissions_bed_idx` ON `admissions` (`bed_id`);
CREATE INDEX IF NOT EXISTS `admissions_doctor_idx` ON `admissions` (`admitting_doctor_id`);
CREATE INDEX IF NOT EXISTS `admissions_external_doctor_idx` ON `admissions` (`external_doctor_id`);
CREATE INDEX IF NOT EXISTS `admissions_hospital_idx` ON `admissions` (`hospital_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `allocation_cancel_once` ON `allocation_cancellations` (`allocation_id`);
CREATE INDEX IF NOT EXISTS `amendment_authority` ON `post_discharge_amendments` (`exception_id`);
CREATE INDEX IF NOT EXISTS `amendment_episode` ON `post_discharge_amendments` (`admission_id`);
CREATE INDEX IF NOT EXISTS `amendment_result` ON `post_discharge_amendments` (`result_id`);
CREATE INDEX IF NOT EXISTS `amendment_source` ON `post_discharge_amendments` (`source_id`);
CREATE INDEX IF NOT EXISTS `audit_events_actor_time` ON `audit_events` (`actor_type`, `actor_id`, `occurred_at`);
CREATE INDEX IF NOT EXISTS `audit_events_entity_time` ON `audit_events` (`entity_type`, `entity_id`, `occurred_at`);
CREATE INDEX IF NOT EXISTS `availability_coordinator_backup_idx` ON `availability_coordinators` (`backup_nurse_id`);
CREATE INDEX IF NOT EXISTS `availability_coordinator_nurse_idx` ON `availability_coordinators` (`nurse_id`);
CREATE INDEX IF NOT EXISTS `beds_category_idx` ON `beds` (`category`);
CREATE UNIQUE INDEX IF NOT EXISTS `billing_request_actor_key` ON `billing_requests` (`actor_id`, `request_id`);
CREATE INDEX IF NOT EXISTS `care_billing_episode_idx` ON `care_billing_events` (`admission_id`);
CREATE INDEX IF NOT EXISTS `care_billing_order_idx` ON `care_billing_events` (`order_id`);
CREATE INDEX IF NOT EXISTS `care_billing_round_idx` ON `care_billing_events` (`round_id`);
CREATE INDEX IF NOT EXISTS `care_billing_tariff_idx` ON `care_billing_events` (`tariff_version_id`);
CREATE INDEX IF NOT EXISTS `care_occurrence_episode_idx` ON `care_occurrences` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `care_occurrence_identity_idx` ON `care_occurrences` (`order_id`, `scheduled_at`);
CREATE INDEX IF NOT EXISTS `care_tasks_episode_idx` ON `care_tasks` (`admission_id`);
CREATE INDEX IF NOT EXISTS `charge_correction_authority_idx` ON `charges` (`correction_exception_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `charge_finalize_once` ON `charge_finalizations` (`charge_id`);
CREATE INDEX IF NOT EXISTS `charge_reversal_idx` ON `charge_reversals` (`charge_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `charge_source_unique` ON `charges` (`admission_id`, `source_event_id`);
CREATE INDEX IF NOT EXISTS `charges_admission_idx` ON `charges` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `clearance_invalidated_once` ON `clearance_invalidations` (`seal_id`);
CREATE INDEX IF NOT EXISTS `clearance_seal_episode_gate` ON `clearance_seals` (`admission_id`, `gate`);
CREATE INDEX IF NOT EXISTS `clearance_seal_predecessor` ON `clearance_seals` (`predecessor_id`);
CREATE INDEX IF NOT EXISTS `clearance_seal_signer` ON `clearance_seals` (`signed_by`);
CREATE INDEX IF NOT EXISTS `clinical_addenda_note_idx` ON `clinical_addenda` (`note_id`);
CREATE INDEX IF NOT EXISTS `clinical_order_medicine_version_idx` ON `clinical_orders` (`medicine_catalog_version_id`);
CREATE INDEX IF NOT EXISTS `clinical_orders_episode_idx` ON `clinical_orders` (`admission_id`);
CREATE INDEX IF NOT EXISTS `clinical_orders_round_idx` ON `clinical_orders` (`round_id`);
CREATE INDEX IF NOT EXISTS `clinical_rounds_episode_idx` ON `clinical_rounds` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `clinical_summary_version_idx` ON `clinical_summaries` (`admission_id`, `version`);
CREATE INDEX IF NOT EXISTS `clinical_task_events_order_idx` ON `clinical_task_events` (`order_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `clinical_task_once_idx` ON `clinical_task_events` (`order_id`, `status`);
CREATE UNIQUE INDEX IF NOT EXISTS `departure_episode_once` ON `departures` (`admission_id`);
CREATE INDEX IF NOT EXISTS `departure_seal` ON `departures` (`bill_seal_id`);
CREATE INDEX IF NOT EXISTS `departure_signer` ON `departures` (`signed_by`);
CREATE INDEX IF NOT EXISTS `departure_stay` ON `departures` (`stay_id`);
CREATE INDEX IF NOT EXISTS `discharge_document_creator` ON `discharge_documents` (`created_by`);
CREATE INDEX IF NOT EXISTS `discharge_document_predecessor` ON `discharge_documents` (`replaces_document_id`);
CREATE INDEX IF NOT EXISTS `discharge_document_source` ON `discharge_documents` (`admission_id`, `source_hash`);
CREATE UNIQUE INDEX IF NOT EXISTS `discharge_document_storage` ON `discharge_documents` (`storage_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `discharge_document_version` ON `discharge_documents` (`admission_id`, `version`);
CREATE INDEX IF NOT EXISTS `doctor_availability_coordinator_idx` ON `doctor_availability` (`coordinator_id`);
CREATE INDEX IF NOT EXISTS `doctor_directory_recorder_idx` ON `doctor_directory_versions` (`recorded_by`);
CREATE INDEX IF NOT EXISTS `exception_evidence_authority` ON `exception_evidence` (`exception_id`);
CREATE INDEX IF NOT EXISTS `exception_evidence_episode` ON `exception_evidence` (`admission_id`);
CREATE INDEX IF NOT EXISTS `exception_evidence_shift` ON `exception_evidence` (`shift_id`);
CREATE INDEX IF NOT EXISTS `exception_evidence_source` ON `exception_evidence` (`source_id`);
CREATE INDEX IF NOT EXISTS `exception_followup_authority` ON `exception_followups` (`exception_id`);
CREATE INDEX IF NOT EXISTS `exception_followup_episode` ON `exception_followups` (`admission_id`);
CREATE INDEX IF NOT EXISTS `exception_followup_owner` ON `exception_followups` (`owner_id`);
CREATE INDEX IF NOT EXISTS `exceptional_departure_authority` ON `exceptional_departures` (`exception_id`);
CREATE INDEX IF NOT EXISTS `exceptional_departure_evidence` ON `exceptional_departures` (`physical_evidence_id`);
CREATE INDEX IF NOT EXISTS `exceptional_departure_stay` ON `exceptional_departures` (`stay_id`);
CREATE INDEX IF NOT EXISTS `exceptions_admission_idx` ON `admin_exceptions` (`admission_id`);
CREATE INDEX IF NOT EXISTS `exceptions_owner_idx` ON `admin_exceptions` (`follow_up_owner_id`);
CREATE INDEX IF NOT EXISTS `exceptions_source_idx` ON `admin_exceptions` (`source_id`);
CREATE INDEX IF NOT EXISTS `identification_authority` ON `patient_identifications` (`exception_id`);
CREATE INDEX IF NOT EXISTS `identification_episode` ON `patient_identifications` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_case_admission` ON `insurance_cases` (`admission_id`);
CREATE INDEX IF NOT EXISTS `insurance_case_assignee` ON `insurance_cases` (`assigned_staff_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_conversion_once` ON `insurance_conversions` (`case_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_decision_version` ON `insurance_decisions` (`case_id`, `case_version`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_document_replacement` ON `insurance_documents` (`replaces_document_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_document_revision` ON `insurance_documents` (`case_id`, `set_revision`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_document_storage` ON `insurance_documents` (`storage_key`);
CREATE INDEX IF NOT EXISTS `insurance_events_case` ON `insurance_events` (`case_id`, `case_version`);
CREATE INDEX IF NOT EXISTS `insurance_transfer_case` ON `insurance_transfer_resolutions` (`case_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `insurance_transfer_resolved_once` ON `insurance_transfer_resolutions` (`task_id`);
CREATE INDEX IF NOT EXISTS `lab_addenda_report_idx` ON `lab_report_addenda` (`report_id`);
CREATE INDEX IF NOT EXISTS `lab_dispositions_episode_idx` ON `lab_dispositions` (`admission_id`);
CREATE INDEX IF NOT EXISTS `lab_processing_episode_idx` ON `lab_processing` (`admission_id`);
CREATE INDEX IF NOT EXISTS `lab_reports_episode_idx` ON `lab_reports` (`admission_id`);
CREATE INDEX IF NOT EXISTS `lab_samples_episode_idx` ON `lab_samples` (`admission_id`);
CREATE INDEX IF NOT EXISTS `mar_episode_idx` ON `medication_administrations` (`admission_id`);
CREATE INDEX IF NOT EXISTS `mar_shift_idx` ON `medication_administrations` (`shift_id`);
CREATE INDEX IF NOT EXISTS `mvp_event_episode` ON `mvp_events` (`admission_id`, `recorded_at`);
CREATE INDEX IF NOT EXISTS `mvp_exception_episode` ON `mvp_exception_events` (`admission_id`, `recorded_at`);
CREATE INDEX IF NOT EXISTS `mvp_external_episode` ON `mvp_external_services` (`admission_id`, `recorded_at`);
CREATE UNIQUE INDEX IF NOT EXISTS `mvp_medicine_charge_once` ON `mvp_medicine_sources` (`charge_id__chg`);
CREATE INDEX IF NOT EXISTS `mvp_medicine_episode` ON `mvp_medicine_sources` (`admission_id`);
CREATE INDEX IF NOT EXISTS `mvp_medicine_original` ON `mvp_medicine_sources` (`original_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `mvp_medicine_reversal_once` ON `mvp_medicine_sources` (`reversal_id`);
CREATE INDEX IF NOT EXISTS `mvp_receivable_episode` ON `mvp_receivable_receipts` (`admission_id`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_authority_doctor` ON `mvp_transfer_authorities` (`external_doctor_id`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_authority_recorder` ON `mvp_transfer_authorities` (`recorded_by`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_authority_stay` ON `mvp_transfer_authorities` (`source_stay_id`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_cancellation_doctor` ON `mvp_transfer_cancellations` (`external_doctor_id`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_cancellation_episode` ON `mvp_transfer_cancellations` (`admission_id`);
CREATE INDEX IF NOT EXISTS `mvp_transfer_cancellation_recorder` ON `mvp_transfer_cancellations` (`recorded_by`);
CREATE INDEX IF NOT EXISTS `nurse_assignment_identity_idx` ON `nurse_assignments` (`admission_id`, `nurse_id`);
CREATE INDEX IF NOT EXISTS `nurse_assignment_nurse_idx` ON `nurse_assignments` (`nurse_id`);
CREATE INDEX IF NOT EXISTS `nursing_addendum_episode_idx` ON `nursing_addenda` (`admission_id`);
CREATE INDEX IF NOT EXISTS `nursing_addendum_record_idx` ON `nursing_addenda` (`record_id`);
CREATE INDEX IF NOT EXISTS `nursing_consumable_bed_idx` ON `nursing_consumables` (`bed_id`);
CREATE INDEX IF NOT EXISTS `nursing_consumable_episode_idx` ON `nursing_consumables` (`admission_id`);
CREATE INDEX IF NOT EXISTS `nursing_consumable_shift_idx` ON `nursing_consumables` (`shift_id`);
CREATE INDEX IF NOT EXISTS `nursing_consumable_stay_idx` ON `nursing_consumables` (`stay_id`);
CREATE INDEX IF NOT EXISTS `nursing_observation_episode_idx` ON `nursing_observations` (`admission_id`);
CREATE INDEX IF NOT EXISTS `nursing_observation_shift_idx` ON `nursing_observations` (`shift_id`);
CREATE INDEX IF NOT EXISTS `nursing_shift_episode_idx` ON `nursing_shifts` (`admission_id`);
CREATE INDEX IF NOT EXISTS `nursing_shift_nurse_idx` ON `nursing_shifts` (`nurse_id`);
CREATE INDEX IF NOT EXISTS `paperwork_case` ON `paperwork_runs` (`case_id`, `recorded_at`);
CREATE UNIQUE INDEX IF NOT EXISTS `paperwork_followup_once` ON `paperwork_followups` (`run_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `paperwork_packet_once` ON `paperwork_packets` (`run_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `paperwork_proposal_revision` ON `paperwork_proposals` (`run_id`, `revision`);
CREATE UNIQUE INDEX IF NOT EXISTS `paperwork_review_request` ON `paperwork_reviews` (`recorded_by`, `request_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `paperwork_review_revision` ON `paperwork_reviews` (`run_id`, `revision`);
CREATE UNIQUE INDEX IF NOT EXISTS `patient_active_admission_idx` ON `admissions` (`patient_id__active`);
CREATE UNIQUE INDEX IF NOT EXISTS `patient_identification_version` ON `patient_identifications` (`patient_id`, `version`);
CREATE INDEX IF NOT EXISTS `patients_name_idx` ON `patients` (`name`);
CREATE UNIQUE INDEX IF NOT EXISTS `pharmacy_barcode_identity` ON `pharmacy_batches` (`hospital_id`, `barcode`);
CREATE INDEX IF NOT EXISTS `pharmacy_batch_catalog_idx` ON `pharmacy_batches` (`catalog_version_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `pharmacy_batch_identity` ON `pharmacy_batches` (`hospital_id`, `medicine_id`, `batch_no`);
CREATE INDEX IF NOT EXISTS `pharmacy_charge_idx` ON `pharmacy_movements` (`charge_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_movement_batch_idx` ON `pharmacy_movements` (`batch_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_movement_episode_idx` ON `pharmacy_movements` (`admission_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_movement_order_idx` ON `pharmacy_movements` (`order_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_preparation_episode_idx` ON `pharmacy_preparations` (`admission_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_preparation_rx_idx` ON `pharmacy_preparations` (`prescription_version_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `pharmacy_preparation_version` ON `pharmacy_preparations` (`admission_id`, `version`);
CREATE UNIQUE INDEX IF NOT EXISTS `pharmacy_receipt_source_once` ON `pharmacy_movements` (`batch_id`, `reference__receipt`);
CREATE INDEX IF NOT EXISTS `pharmacy_return_issue_idx` ON `pharmacy_movements` (`original_issue_id`);
CREATE INDEX IF NOT EXISTS `pharmacy_reversal_idx` ON `pharmacy_movements` (`reversal_id`);
CREATE INDEX IF NOT EXISTS `receipt_allocation_idx` ON `receipt_allocations` (`receipt_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `receipt_cash_identity` ON `receipts` (`hospital_id`, `mode`, `channel`, `source_reference`);
CREATE INDEX IF NOT EXISTS `receipts_admission_idx` ON `receipts` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `refund_cash_identity` ON `receipt_refunds` (`hospital_id`, `mode`, `channel`, `source_reference`);
CREATE INDEX IF NOT EXISTS `refund_episode` ON `receipt_refunds` (`admission_id`);
CREATE INDEX IF NOT EXISTS `refund_receipt` ON `receipt_refunds` (`receipt_id`);
CREATE INDEX IF NOT EXISTS `reversal_correction_authority_idx` ON `charge_reversals` (`correction_exception_id`);
CREATE INDEX IF NOT EXISTS `reversal_physical_amendment_idx` ON `charge_reversals` (`physical_amendment_id`);
CREATE INDEX IF NOT EXISTS `room_return_authority` ON `room_returns` (`exception_id`);
CREATE INDEX IF NOT EXISTS `room_return_doctor` ON `room_returns` (`doctor_evidence_id`);
CREATE INDEX IF NOT EXISTS `room_return_episode` ON `room_returns` (`admission_id`);
CREATE INDEX IF NOT EXISTS `room_return_nurse` ON `room_returns` (`nurse_evidence_id`);
CREATE INDEX IF NOT EXISTS `room_stays_admission_idx` ON `room_stays` (`admission_id`);
CREATE INDEX IF NOT EXISTS `room_stays_bed_idx` ON `room_stays` (`bed_id`);
CREATE INDEX IF NOT EXISTS `room_stays_tariff_idx` ON `room_stays` (`tariff_version_id`);
CREATE INDEX IF NOT EXISTS `room_vacation_nursing_seal` ON `room_vacations` (`nursing_seal_id`);
CREATE INDEX IF NOT EXISTS `room_vacation_shift` ON `room_vacations` (`shift_id`);
CREATE INDEX IF NOT EXISTS `room_vacation_signer` ON `room_vacations` (`signed_by`);
CREATE UNIQUE INDEX IF NOT EXISTS `room_vacation_stay_once` ON `room_vacations` (`stay_id`);
CREATE INDEX IF NOT EXISTS `self_pay_review_episode` ON `self_pay_reviews` (`admission_id`);
CREATE INDEX IF NOT EXISTS `staff_account_user_idx` ON `staff_account` (`user_id`);
CREATE INDEX IF NOT EXISTS `staff_session_user_idx` ON `staff_session` (`user_id`);
CREATE INDEX IF NOT EXISTS `staff_verification_identifier_idx` ON `staff_verification` (`identifier`);
CREATE INDEX IF NOT EXISTS `stay_amendment_authority` ON `stay_boundary_amendments` (`exception_id`);
CREATE INDEX IF NOT EXISTS `stay_amendment_episode` ON `stay_boundary_amendments` (`admission_id`);
CREATE INDEX IF NOT EXISTS `stay_amendment_evidence` ON `stay_boundary_amendments` (`evidence_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `stay_amendment_version` ON `stay_boundary_amendments` (`stay_id`, `version`);
CREATE INDEX IF NOT EXISTS `transfer_cancel_episode_idx` ON `transfer_order_cancellations` (`admission_id`);
CREATE INDEX IF NOT EXISTS `transfer_insurance_tasks_episode_idx` ON `transfer_insurance_tasks` (`admission_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `transfer_order_version_idx` ON `transfer_orders` (`admission_id`, `version`);
CREATE INDEX IF NOT EXISTS `transfer_orders_episode_idx` ON `transfer_orders` (`admission_id`);
CREATE INDEX IF NOT EXISTS `transfer_orders_stay_idx` ON `transfer_orders` (`source_stay_id`);
CREATE INDEX IF NOT EXISTS `turnover_bed` ON `bed_turnovers` (`bed_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `turnover_completed_once` ON `bed_turnover_completions` (`turnover_id`);
CREATE INDEX IF NOT EXISTS `turnover_completion_signer` ON `bed_turnover_completions` (`signed_by`);
CREATE INDEX IF NOT EXISTS `turnover_episode` ON `bed_turnovers` (`admission_id`);
CREATE INDEX IF NOT EXISTS `turnover_signer` ON `bed_turnovers` (`signed_by`);
CREATE UNIQUE INDEX IF NOT EXISTS `turnover_stay_once` ON `bed_turnovers` (`stay_id`);

-- ===== foreign keys =====
ALTER TABLE `admin_exceptions` ADD CONSTRAINT `admin_exceptions_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `admin_exceptions` ADD CONSTRAINT `admin_exceptions_follow_up_owner_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`follow_up_owner_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `admin_exceptions` ADD CONSTRAINT `admin_exceptions_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `administrative_shift_ends` ADD CONSTRAINT `administrative_shift_ends_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `administrative_shift_ends` ADD CONSTRAINT `administrative_shift_ends_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `administrative_shift_ends` ADD CONSTRAINT `administrative_shift_ends_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `administrative_shift_ends` ADD CONSTRAINT `administrative_shift_ends_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `admission_counters` ADD CONSTRAINT `admission_counters_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_mvp_authority_id_fkey` FOREIGN KEY IF NOT EXISTS (`mvp_authority_id`) REFERENCES `mvp_transfer_authorities` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_new_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`new_stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_old_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`old_bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_old_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`old_stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_target_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`target_bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `admission_transfers` ADD CONSTRAINT `admission_transfers_transfer_order_id_transfer_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`transfer_order_id`) REFERENCES `transfer_orders` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_admitting_doctor_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`admitting_doctor_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_created_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_deposit_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`deposit_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_external_doctor_id_fkey` FOREIGN KEY IF NOT EXISTS (`external_doctor_id`) REFERENCES `doctor_directory` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_patient_id_patients_id_fk` FOREIGN KEY IF NOT EXISTS (`patient_id`) REFERENCES `patients` (`id`);
ALTER TABLE `allocation_cancellations` ADD CONSTRAINT `allocation_cancellations_allocation_id_receipt_allocations_id_f` FOREIGN KEY IF NOT EXISTS (`allocation_id`) REFERENCES `receipt_allocations` (`id`);
ALTER TABLE `availability_coordinators` ADD CONSTRAINT `availability_coordinators_backup_nurse_id_fkey` FOREIGN KEY IF NOT EXISTS (`backup_nurse_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `availability_coordinators` ADD CONSTRAINT `availability_coordinators_nurse_id_fkey` FOREIGN KEY IF NOT EXISTS (`nurse_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `availability_coordinators` ADD CONSTRAINT `availability_coordinators_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `bed_holds` ADD CONSTRAINT `bed_holds_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `bed_holds` ADD CONSTRAINT `bed_holds_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `bed_turnover_completions` ADD CONSTRAINT `bed_turnover_completions_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `bed_turnover_completions` ADD CONSTRAINT `bed_turnover_completions_turnover_id_bed_turnovers_id_fk` FOREIGN KEY IF NOT EXISTS (`turnover_id`) REFERENCES `bed_turnovers` (`id`);
ALTER TABLE `bed_turnovers` ADD CONSTRAINT `bed_turnovers_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `bed_turnovers` ADD CONSTRAINT `bed_turnovers_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `bed_turnovers` ADD CONSTRAINT `bed_turnovers_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `bed_turnovers` ADD CONSTRAINT `bed_turnovers_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `beds` ADD CONSTRAINT `beds_category_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`category_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `care_billing_events` ADD CONSTRAINT `care_billing_events_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `care_billing_events` ADD CONSTRAINT `care_billing_events_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `care_billing_events` ADD CONSTRAINT `care_billing_events_round_id_clinical_rounds_id_fk` FOREIGN KEY IF NOT EXISTS (`round_id`) REFERENCES `clinical_rounds` (`id`);
ALTER TABLE `care_billing_events` ADD CONSTRAINT `care_billing_events_tariff_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`tariff_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `care_occurrences` ADD CONSTRAINT `care_occurrences_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `care_occurrences` ADD CONSTRAINT `care_occurrences_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `care_tasks` ADD CONSTRAINT `care_tasks_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `care_tasks` ADD CONSTRAINT `care_tasks_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `charges` ADD CONSTRAINT `charge_correction_authority_fk` FOREIGN KEY IF NOT EXISTS (`correction_exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `charge_finalizations` ADD CONSTRAINT `charge_finalizations_charge_id_charges_id_fk` FOREIGN KEY IF NOT EXISTS (`charge_id`) REFERENCES `charges` (`id`);
ALTER TABLE `charge_reversals` ADD CONSTRAINT `charge_reversals_charge_id_charges_id_fk` FOREIGN KEY IF NOT EXISTS (`charge_id`) REFERENCES `charges` (`id`);
ALTER TABLE `charges` ADD CONSTRAINT `charges_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `charges` ADD CONSTRAINT `charges_tariff_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`tariff_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `clearance_invalidations` ADD CONSTRAINT `clearance_invalidations_seal_id_clearance_seals_id_fk` FOREIGN KEY IF NOT EXISTS (`seal_id`) REFERENCES `clearance_seals` (`id`);
ALTER TABLE `clearance_seals` ADD CONSTRAINT `clearance_seals_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `clearance_seals` ADD CONSTRAINT `clearance_seals_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `clinical_addenda` ADD CONSTRAINT `clinical_addenda_note_id_clinical_rounds_id_fk` FOREIGN KEY IF NOT EXISTS (`note_id`) REFERENCES `clinical_rounds` (`id`);
ALTER TABLE `clinical_addenda` ADD CONSTRAINT `clinical_addenda_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `clinical_orders` ADD CONSTRAINT `clinical_orders_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `clinical_orders` ADD CONSTRAINT `clinical_orders_medicine_catalog_version_id_setting_versions_id` FOREIGN KEY IF NOT EXISTS (`medicine_catalog_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `clinical_orders` ADD CONSTRAINT `clinical_orders_round_id_clinical_rounds_id_fk` FOREIGN KEY IF NOT EXISTS (`round_id`) REFERENCES `clinical_rounds` (`id`);
ALTER TABLE `clinical_orders` ADD CONSTRAINT `clinical_orders_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `clinical_rounds` ADD CONSTRAINT `clinical_rounds_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `clinical_rounds` ADD CONSTRAINT `clinical_rounds_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `clinical_summaries` ADD CONSTRAINT `clinical_summaries_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `clinical_summaries` ADD CONSTRAINT `clinical_summaries_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `clinical_task_events` ADD CONSTRAINT `clinical_task_events_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `clinical_task_events` ADD CONSTRAINT `clinical_task_events_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `departures` ADD CONSTRAINT `departures_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `departures` ADD CONSTRAINT `departures_bill_seal_id_clearance_seals_id_fk` FOREIGN KEY IF NOT EXISTS (`bill_seal_id`) REFERENCES `clearance_seals` (`id`);
ALTER TABLE `departures` ADD CONSTRAINT `departures_mvp_finance_id_fkey` FOREIGN KEY IF NOT EXISTS (`mvp_finance_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `departures` ADD CONSTRAINT `departures_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `departures` ADD CONSTRAINT `departures_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `discharge_documents` ADD CONSTRAINT `discharge_documents_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `discharge_documents` ADD CONSTRAINT `discharge_documents_created_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `doctor_availability` ADD CONSTRAINT `doctor_availability_coordinator_id_fkey` FOREIGN KEY IF NOT EXISTS (`coordinator_id`) REFERENCES `availability_coordinators` (`id`);
ALTER TABLE `doctor_availability` ADD CONSTRAINT `doctor_availability_doctor_id_fkey` FOREIGN KEY IF NOT EXISTS (`doctor_id`) REFERENCES `doctor_directory` (`id`);
ALTER TABLE `doctor_availability` ADD CONSTRAINT `doctor_availability_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `doctor_directory_versions` ADD CONSTRAINT `doctor_directory_versions_doctor_id_fkey` FOREIGN KEY IF NOT EXISTS (`doctor_id`) REFERENCES `doctor_directory` (`id`);
ALTER TABLE `doctor_directory_versions` ADD CONSTRAINT `doctor_directory_versions_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `exception_evidence` ADD CONSTRAINT `exception_evidence_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `exception_evidence` ADD CONSTRAINT `exception_evidence_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `exception_evidence` ADD CONSTRAINT `exception_evidence_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `exception_evidence` ADD CONSTRAINT `exception_evidence_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `exception_followups` ADD CONSTRAINT `exception_followups_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `exception_followups` ADD CONSTRAINT `exception_followups_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `exception_followups` ADD CONSTRAINT `exception_followups_owner_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`owner_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `exception_followups` ADD CONSTRAINT `exception_followups_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `exceptional_departures` ADD CONSTRAINT `exceptional_departures_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `exceptional_departures` ADD CONSTRAINT `exceptional_departures_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `exceptional_departures` ADD CONSTRAINT `exceptional_departures_physical_evidence_id_exception_evidence_` FOREIGN KEY IF NOT EXISTS (`physical_evidence_id`) REFERENCES `exception_evidence` (`id`);
ALTER TABLE `exceptional_departures` ADD CONSTRAINT `exceptional_departures_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `exceptional_departures` ADD CONSTRAINT `exceptional_departures_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `insurance_cases` ADD CONSTRAINT `insurance_cases_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `insurance_cases` ADD CONSTRAINT `insurance_cases_assigned_staff_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`assigned_staff_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_cases` ADD CONSTRAINT `insurance_cases_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_conversions` ADD CONSTRAINT `insurance_conversions_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `insurance_conversions` ADD CONSTRAINT `insurance_conversions_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_decisions` ADD CONSTRAINT `insurance_decisions_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `insurance_decisions` ADD CONSTRAINT `insurance_decisions_policy_event_id_insurance_events_id_fk` FOREIGN KEY IF NOT EXISTS (`policy_event_id`) REFERENCES `insurance_events` (`id`);
ALTER TABLE `insurance_decisions` ADD CONSTRAINT `insurance_decisions_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_documents` ADD CONSTRAINT `insurance_documents_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `insurance_documents` ADD CONSTRAINT `insurance_documents_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_events` ADD CONSTRAINT `insurance_events_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `insurance_events` ADD CONSTRAINT `insurance_events_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_transfer_resolutions` ADD CONSTRAINT `insurance_transfer_resolutions_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `insurance_transfer_resolutions` ADD CONSTRAINT `insurance_transfer_resolutions_conversion_id_insurance_conversi` FOREIGN KEY IF NOT EXISTS (`conversion_id`) REFERENCES `insurance_conversions` (`id`);
ALTER TABLE `insurance_transfer_resolutions` ADD CONSTRAINT `insurance_transfer_resolutions_decision_id_insurance_decisions_` FOREIGN KEY IF NOT EXISTS (`decision_id`) REFERENCES `insurance_decisions` (`id`);
ALTER TABLE `insurance_transfer_resolutions` ADD CONSTRAINT `insurance_transfer_resolutions_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `insurance_transfer_resolutions` ADD CONSTRAINT `insurance_transfer_resolutions_task_id_transfer_insurance_tasks` FOREIGN KEY IF NOT EXISTS (`task_id`) REFERENCES `transfer_insurance_tasks` (`id`);
ALTER TABLE `lab_dispositions` ADD CONSTRAINT `lab_dispositions_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `lab_dispositions` ADD CONSTRAINT `lab_dispositions_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `lab_dispositions` ADD CONSTRAINT `lab_dispositions_reversal_id_charge_reversals_id_fk` FOREIGN KEY IF NOT EXISTS (`reversal_id`) REFERENCES `charge_reversals` (`id`);
ALTER TABLE `lab_dispositions` ADD CONSTRAINT `lab_dispositions_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `lab_dispositions` ADD CONSTRAINT `lab_dispositions_stop_event_id_clinical_task_events_id_fk` FOREIGN KEY IF NOT EXISTS (`stop_event_id`) REFERENCES `clinical_task_events` (`id`);
ALTER TABLE `lab_processing` ADD CONSTRAINT `lab_processing_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `lab_processing` ADD CONSTRAINT `lab_processing_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `lab_processing` ADD CONSTRAINT `lab_processing_sample_id_lab_samples_id_fk` FOREIGN KEY IF NOT EXISTS (`sample_id`) REFERENCES `lab_samples` (`id`);
ALTER TABLE `lab_processing` ADD CONSTRAINT `lab_processing_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `lab_report_addenda` ADD CONSTRAINT `lab_report_addenda_report_id_lab_reports_id_fk` FOREIGN KEY IF NOT EXISTS (`report_id`) REFERENCES `lab_reports` (`id`);
ALTER TABLE `lab_report_addenda` ADD CONSTRAINT `lab_report_addenda_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `lab_reports_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `lab_reports_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `lab_reports_sample_id_lab_samples_id_fk` FOREIGN KEY IF NOT EXISTS (`sample_id`) REFERENCES `lab_samples` (`id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `lab_reports_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `lab_samples` ADD CONSTRAINT `lab_samples_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `lab_samples` ADD CONSTRAINT `lab_samples_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `lab_samples` ADD CONSTRAINT `lab_samples_patient_id_patients_id_fk` FOREIGN KEY IF NOT EXISTS (`patient_id`) REFERENCES `patients` (`id`);
ALTER TABLE `lab_samples` ADD CONSTRAINT `lab_samples_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `medication_administrations` ADD CONSTRAINT `medication_administrations_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `medication_administrations` ADD CONSTRAINT `medication_administrations_occurrence_id_care_occurrences_id_fk` FOREIGN KEY IF NOT EXISTS (`occurrence_id`) REFERENCES `care_occurrences` (`id`);
ALTER TABLE `medication_administrations` ADD CONSTRAINT `medication_administrations_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `medication_administrations` ADD CONSTRAINT `medication_administrations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_events` ADD CONSTRAINT `mvp_events_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_events` ADD CONSTRAINT `mvp_events_checklist_id_fkey` FOREIGN KEY IF NOT EXISTS (`checklist_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `mvp_events` ADD CONSTRAINT `mvp_events_clinical_id_fkey` FOREIGN KEY IF NOT EXISTS (`clinical_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `mvp_events` ADD CONSTRAINT `mvp_events_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_exception_events` ADD CONSTRAINT `mvp_exception_events_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_exception_events` ADD CONSTRAINT `mvp_exception_events_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_authority_id_fkey` FOREIGN KEY IF NOT EXISTS (`authority_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_clinical_id_fkey` FOREIGN KEY IF NOT EXISTS (`clinical_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_shift_id_fkey` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `mvp_exceptional_departures` ADD CONSTRAINT `mvp_exceptional_departures_stay_id_fkey` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `mvp_external_services` ADD CONSTRAINT `mvp_external_services_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_external_services` ADD CONSTRAINT `mvp_external_services_charge_id_fkey` FOREIGN KEY IF NOT EXISTS (`charge_id`) REFERENCES `charges` (`id`);
ALTER TABLE `mvp_external_services` ADD CONSTRAINT `mvp_external_services_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_external_services` ADD CONSTRAINT `mvp_external_services_tariff_version_id_fkey` FOREIGN KEY IF NOT EXISTS (`tariff_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `mvp_invalidations` ADD CONSTRAINT `mvp_invalidations_event_id_fkey` FOREIGN KEY IF NOT EXISTS (`event_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `mvp_medicine_sources` ADD CONSTRAINT `mvp_medicine_sources_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_medicine_sources` ADD CONSTRAINT `mvp_medicine_sources_charge_id_fkey` FOREIGN KEY IF NOT EXISTS (`charge_id`) REFERENCES `charges` (`id`);
ALTER TABLE `mvp_medicine_sources` ADD CONSTRAINT `mvp_medicine_sources_original_id_fkey` FOREIGN KEY IF NOT EXISTS (`original_id`) REFERENCES `mvp_medicine_sources` (`id`);
ALTER TABLE `mvp_medicine_sources` ADD CONSTRAINT `mvp_medicine_sources_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_medicine_sources` ADD CONSTRAINT `mvp_medicine_sources_reversal_id_fkey` FOREIGN KEY IF NOT EXISTS (`reversal_id`) REFERENCES `charge_reversals` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_allocation_amendment_id_fkey` FOREIGN KEY IF NOT EXISTS (`allocation_amendment_id`) REFERENCES `post_discharge_amendments` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_exception_authority_id_fkey` FOREIGN KEY IF NOT EXISTS (`exception_authority_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_finance_id_fkey` FOREIGN KEY IF NOT EXISTS (`finance_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_receipt_id_fkey` FOREIGN KEY IF NOT EXISTS (`receipt_id`) REFERENCES `receipts` (`id`);
ALTER TABLE `mvp_receivable_receipts` ADD CONSTRAINT `mvp_receivable_receipts_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_authority_id_fkey` FOREIGN KEY IF NOT EXISTS (`authority_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_clinical_id_fkey` FOREIGN KEY IF NOT EXISTS (`clinical_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_shift_id_fkey` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_stay_id_fkey` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `mvp_room_returns` ADD CONSTRAINT `mvp_room_returns_vacation_id_fkey` FOREIGN KEY IF NOT EXISTS (`vacation_id`) REFERENCES `room_vacations` (`id`);
ALTER TABLE `mvp_transfer_authorities` ADD CONSTRAINT `mvp_transfer_authorities_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_transfer_authorities` ADD CONSTRAINT `mvp_transfer_authorities_external_doctor_id_fkey` FOREIGN KEY IF NOT EXISTS (`external_doctor_id`) REFERENCES `doctor_directory` (`id`);
ALTER TABLE `mvp_transfer_authorities` ADD CONSTRAINT `mvp_transfer_authorities_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `mvp_transfer_authorities` ADD CONSTRAINT `mvp_transfer_authorities_source_stay_id_fkey` FOREIGN KEY IF NOT EXISTS (`source_stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `mvp_transfer_cancellations` ADD CONSTRAINT `mvp_transfer_cancellations_admission_id_fkey` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `mvp_transfer_cancellations` ADD CONSTRAINT `mvp_transfer_cancellations_authority_id_fkey` FOREIGN KEY IF NOT EXISTS (`authority_id`) REFERENCES `mvp_transfer_authorities` (`id`);
ALTER TABLE `mvp_transfer_cancellations` ADD CONSTRAINT `mvp_transfer_cancellations_external_doctor_id_fkey` FOREIGN KEY IF NOT EXISTS (`external_doctor_id`) REFERENCES `doctor_directory` (`id`);
ALTER TABLE `mvp_transfer_cancellations` ADD CONSTRAINT `mvp_transfer_cancellations_recorded_by_fkey` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nurse_assignment_revocations` ADD CONSTRAINT `nurse_assignment_revocations_assignment_id_nurse_assignments_id` FOREIGN KEY IF NOT EXISTS (`assignment_id`) REFERENCES `nurse_assignments` (`id`);
ALTER TABLE `nurse_assignment_revocations` ADD CONSTRAINT `nurse_assignment_revocations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nurse_assignments` ADD CONSTRAINT `nurse_assignments_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `nurse_assignments` ADD CONSTRAINT `nurse_assignments_nurse_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`nurse_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nurse_assignments` ADD CONSTRAINT `nurse_assignments_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_addenda` ADD CONSTRAINT `nursing_addenda_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `nursing_addenda` ADD CONSTRAINT `nursing_addenda_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_consumables` ADD CONSTRAINT `nursing_consumables_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `nursing_consumables` ADD CONSTRAINT `nursing_consumables_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `nursing_consumables` ADD CONSTRAINT `nursing_consumables_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `nursing_consumables` ADD CONSTRAINT `nursing_consumables_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_consumables` ADD CONSTRAINT `nursing_consumables_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `nursing_observations` ADD CONSTRAINT `nursing_observations_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `nursing_observations` ADD CONSTRAINT `nursing_observations_occurrence_id_care_occurrences_id_fk` FOREIGN KEY IF NOT EXISTS (`occurrence_id`) REFERENCES `care_occurrences` (`id`);
ALTER TABLE `nursing_observations` ADD CONSTRAINT `nursing_observations_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `nursing_observations` ADD CONSTRAINT `nursing_observations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_shift_ends` ADD CONSTRAINT `nursing_shift_ends_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `nursing_shift_ends` ADD CONSTRAINT `nursing_shift_ends_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_shifts` ADD CONSTRAINT `nursing_shifts_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `nursing_shifts` ADD CONSTRAINT `nursing_shifts_nurse_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`nurse_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `nursing_shifts` ADD CONSTRAINT `nursing_shifts_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_followups` ADD CONSTRAINT `paperwork_followups_owner_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`owner_id`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_followups` ADD CONSTRAINT `paperwork_followups_packet_id_paperwork_packets_id_fk` FOREIGN KEY IF NOT EXISTS (`packet_id`) REFERENCES `paperwork_packets` (`id`);
ALTER TABLE `paperwork_followups` ADD CONSTRAINT `paperwork_followups_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_followups` ADD CONSTRAINT `paperwork_followups_run_id_paperwork_runs_id_fk` FOREIGN KEY IF NOT EXISTS (`run_id`) REFERENCES `paperwork_runs` (`id`);
ALTER TABLE `paperwork_packets` ADD CONSTRAINT `paperwork_packets_proposal_id_paperwork_proposals_id_fk` FOREIGN KEY IF NOT EXISTS (`proposal_id`) REFERENCES `paperwork_proposals` (`id`);
ALTER TABLE `paperwork_packets` ADD CONSTRAINT `paperwork_packets_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_packets` ADD CONSTRAINT `paperwork_packets_review_id_paperwork_reviews_id_fk` FOREIGN KEY IF NOT EXISTS (`review_id`) REFERENCES `paperwork_reviews` (`id`);
ALTER TABLE `paperwork_packets` ADD CONSTRAINT `paperwork_packets_run_id_paperwork_runs_id_fk` FOREIGN KEY IF NOT EXISTS (`run_id`) REFERENCES `paperwork_runs` (`id`);
ALTER TABLE `paperwork_proposals` ADD CONSTRAINT `paperwork_proposals_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_proposals` ADD CONSTRAINT `paperwork_proposals_run_id_paperwork_runs_id_fk` FOREIGN KEY IF NOT EXISTS (`run_id`) REFERENCES `paperwork_runs` (`id`);
ALTER TABLE `paperwork_reviews` ADD CONSTRAINT `paperwork_reviews_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `paperwork_reviews` ADD CONSTRAINT `paperwork_reviews_run_id_paperwork_runs_id_fk` FOREIGN KEY IF NOT EXISTS (`run_id`) REFERENCES `paperwork_runs` (`id`);
ALTER TABLE `paperwork_runs` ADD CONSTRAINT `paperwork_runs_case_id_insurance_cases_id_fk` FOREIGN KEY IF NOT EXISTS (`case_id`) REFERENCES `insurance_cases` (`id`);
ALTER TABLE `paperwork_runs` ADD CONSTRAINT `paperwork_runs_recorded_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`recorded_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `patient_identifications` ADD CONSTRAINT `patient_identifications_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `patient_identifications` ADD CONSTRAINT `patient_identifications_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `patient_identifications` ADD CONSTRAINT `patient_identifications_patient_id_patients_id_fk` FOREIGN KEY IF NOT EXISTS (`patient_id`) REFERENCES `patients` (`id`);
ALTER TABLE `patient_identifications` ADD CONSTRAINT `patient_identifications_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `patients` ADD CONSTRAINT `patients_registered_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`registered_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `pharmacy_batches` ADD CONSTRAINT `pharmacy_batches_catalog_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`catalog_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `pharmacy_batches` ADD CONSTRAINT `pharmacy_batches_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `pharmacy_batches` ADD CONSTRAINT `pharmacy_batches_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_batch_id_pharmacy_batches_id_fk` FOREIGN KEY IF NOT EXISTS (`batch_id`) REFERENCES `pharmacy_batches` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_charge_id_charges_id_fk` FOREIGN KEY IF NOT EXISTS (`charge_id`) REFERENCES `charges` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_order_id_clinical_orders_id_fk` FOREIGN KEY IF NOT EXISTS (`order_id`) REFERENCES `clinical_orders` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_reversal_id_charge_reversals_id_fk` FOREIGN KEY IF NOT EXISTS (`reversal_id`) REFERENCES `charge_reversals` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_movements_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `pharmacy_preparations` ADD CONSTRAINT `pharmacy_preparations_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `pharmacy_preparations` ADD CONSTRAINT `pharmacy_preparations_prescription_version_id_clinical_summarie` FOREIGN KEY IF NOT EXISTS (`prescription_version_id`) REFERENCES `clinical_summaries` (`id`);
ALTER TABLE `pharmacy_preparations` ADD CONSTRAINT `pharmacy_preparations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `pharmacy_movements` ADD CONSTRAINT `pharmacy_return_source_fk` FOREIGN KEY IF NOT EXISTS (`original_issue_id`) REFERENCES `pharmacy_movements` (`id`);
ALTER TABLE `post_discharge_amendments` ADD CONSTRAINT `post_discharge_amendments_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `post_discharge_amendments` ADD CONSTRAINT `post_discharge_amendments_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `post_discharge_amendments` ADD CONSTRAINT `post_discharge_amendments_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_receipt_id_receipts_id_fk` FOREIGN KEY IF NOT EXISTS (`receipt_id`) REFERENCES `receipts` (`id`);
ALTER TABLE `receipt_refunds` ADD CONSTRAINT `receipt_refunds_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `receipt_refunds` ADD CONSTRAINT `receipt_refunds_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `receipt_refunds` ADD CONSTRAINT `receipt_refunds_receipt_id_receipts_id_fk` FOREIGN KEY IF NOT EXISTS (`receipt_id`) REFERENCES `receipts` (`id`);
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `charge_reversals` ADD CONSTRAINT `reversal_correction_authority_fk` FOREIGN KEY IF NOT EXISTS (`correction_exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `charge_reversals` ADD CONSTRAINT `reversal_physical_amendment_fk` FOREIGN KEY IF NOT EXISTS (`physical_amendment_id`) REFERENCES `stay_boundary_amendments` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_doctor_evidence_id_exception_evidence_id_fk` FOREIGN KEY IF NOT EXISTS (`doctor_evidence_id`) REFERENCES `exception_evidence` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_nurse_evidence_id_exception_evidence_id_fk` FOREIGN KEY IF NOT EXISTS (`nurse_evidence_id`) REFERENCES `exception_evidence` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `room_returns` ADD CONSTRAINT `room_returns_vacation_id_room_vacations_id_fk` FOREIGN KEY IF NOT EXISTS (`vacation_id`) REFERENCES `room_vacations` (`id`);
ALTER TABLE `room_stays` ADD CONSTRAINT `room_stays_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `room_stays` ADD CONSTRAINT `room_stays_bed_id_beds_id_fk` FOREIGN KEY IF NOT EXISTS (`bed_id`) REFERENCES `beds` (`id`);
ALTER TABLE `room_stays` ADD CONSTRAINT `room_stays_tariff_version_id_setting_versions_id_fk` FOREIGN KEY IF NOT EXISTS (`tariff_version_id`) REFERENCES `setting_versions` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_mvp_exception_id_fkey` FOREIGN KEY IF NOT EXISTS (`mvp_exception_id`) REFERENCES `mvp_exception_events` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_mvp_readiness_id_fkey` FOREIGN KEY IF NOT EXISTS (`mvp_readiness_id`) REFERENCES `mvp_events` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_nursing_seal_id_clearance_seals_id_fk` FOREIGN KEY IF NOT EXISTS (`nursing_seal_id`) REFERENCES `clearance_seals` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_shift_id_nursing_shifts_id_fk` FOREIGN KEY IF NOT EXISTS (`shift_id`) REFERENCES `nursing_shifts` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `room_vacations` ADD CONSTRAINT `room_vacations_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `self_pay_reviews` ADD CONSTRAINT `self_pay_reviews_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `setting_versions` ADD CONSTRAINT `setting_versions_hospital_id_hospital_settings_id_fk` FOREIGN KEY IF NOT EXISTS (`hospital_id`) REFERENCES `hospital_settings` (`id`);
ALTER TABLE `staff_account` ADD CONSTRAINT `staff_account_user_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`user_id`) REFERENCES `staff_user` (`id`) ON DELETE CASCADE;
ALTER TABLE `staff_session` ADD CONSTRAINT `staff_session_user_id_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`user_id`) REFERENCES `staff_user` (`id`) ON DELETE CASCADE;
ALTER TABLE `stay_boundary_amendments` ADD CONSTRAINT `stay_boundary_amendments_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `stay_boundary_amendments` ADD CONSTRAINT `stay_boundary_amendments_evidence_id_exception_evidence_id_fk` FOREIGN KEY IF NOT EXISTS (`evidence_id`) REFERENCES `exception_evidence` (`id`);
ALTER TABLE `stay_boundary_amendments` ADD CONSTRAINT `stay_boundary_amendments_exception_id_admin_exceptions_id_fk` FOREIGN KEY IF NOT EXISTS (`exception_id`) REFERENCES `admin_exceptions` (`id`);
ALTER TABLE `stay_boundary_amendments` ADD CONSTRAINT `stay_boundary_amendments_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `stay_boundary_amendments` ADD CONSTRAINT `stay_boundary_amendments_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`stay_id`) REFERENCES `room_stays` (`id`);
ALTER TABLE `transfer_insurance_tasks` ADD CONSTRAINT `transfer_insurance_tasks_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `transfer_insurance_tasks` ADD CONSTRAINT `transfer_insurance_tasks_transfer_id_admission_transfers_id_fk` FOREIGN KEY IF NOT EXISTS (`transfer_id`) REFERENCES `admission_transfers` (`id`);
ALTER TABLE `transfer_order_cancellations` ADD CONSTRAINT `transfer_order_cancellations_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `transfer_order_cancellations` ADD CONSTRAINT `transfer_order_cancellations_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `transfer_order_cancellations` ADD CONSTRAINT `transfer_order_cancellations_transfer_order_id_transfer_orders_` FOREIGN KEY IF NOT EXISTS (`transfer_order_id`) REFERENCES `transfer_orders` (`id`);
ALTER TABLE `transfer_orders` ADD CONSTRAINT `transfer_orders_admission_id_admissions_id_fk` FOREIGN KEY IF NOT EXISTS (`admission_id`) REFERENCES `admissions` (`id`);
ALTER TABLE `transfer_orders` ADD CONSTRAINT `transfer_orders_signed_by_staff_user_id_fk` FOREIGN KEY IF NOT EXISTS (`signed_by`) REFERENCES `staff_user` (`id`);
ALTER TABLE `transfer_orders` ADD CONSTRAINT `transfer_orders_source_stay_id_room_stays_id_fk` FOREIGN KEY IF NOT EXISTS (`source_stay_id`) REFERENCES `room_stays` (`id`);

-- Protected insurance documents, discharge PDFs and manifests (immutable; see src/server/file-store.ts).
CREATE TABLE IF NOT EXISTS `protected_files` (
  `kind` VARCHAR(16) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `content` LONGBLOB NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `size_bytes` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`kind`, `name`),
  CONSTRAINT `protected_files_kind_check` CHECK (`kind` IN ('insurance', 'discharge'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

SET foreign_key_checks = 1;
