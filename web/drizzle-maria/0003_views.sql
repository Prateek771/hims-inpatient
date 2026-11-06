-- 0003_views.sql: MariaDB 11.8 port of the six PostgreSQL "effective_*" views.
-- Idempotent (CREATE OR REPLACE), no schema prefix, same column names/order.
-- All views are SQL SECURITY INVOKER (Hostinger has a single database user).
--
-- Translation notes
--  * LEFT JOIN LATERAL (... ORDER BY version DESC LIMIT 1) has no MariaDB equivalent.
--    It is replaced by LEFT JOIN ... ON <child>.version = (SELECT MAX(version) ...).
--    This is exactly equivalent because (stay_id, version) and (patient_id, version)
--    are UNIQUE (stay_amendment_version, patient_identification_version).
--  * IS DISTINCT FROM -> NOT (a <=> b) (NULL-safe).
--  * String literals carry an explicit utf8mb4_nopad_bin collation so view columns that
--    come from literals compare case-/space-sensitively like the PostgreSQL text columns
--    (otherwise they would inherit the connection collation).
--  * Session time zone is UTC; all DATETIME(6) values are UTC, so no conversion is needed.

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_room_stays` AS
SELECT
  s.`id`,
  s.`admission_id`,
  s.`bed_id`,
  s.`tariff_version_id`,
  COALESCE(a.`started_at`, s.`started_at`) AS `started_at`,
  CASE WHEN a.`id` IS NULL THEN s.`ended_at` ELSE a.`ended_at` END AS `ended_at`,
  s.`last_reconciled_at`,
  s.`posted_paise`,
  a.`id` AS `amendment_id`
FROM `room_stays` s
LEFT JOIN `stay_boundary_amendments` a
  ON a.`stay_id` = s.`id`
 AND a.`version` = (SELECT MAX(x.`version`) FROM `stay_boundary_amendments` x WHERE x.`stay_id` = s.`id`);

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_vacation_facts` AS
SELECT
  v.`id`,
  v.`admission_id`,
  v.`stay_id`,
  v.`nursing_seal_id`,
  CASE WHEN NOT (s.`ended_at` <=> v.`vacated_at`) THEN p.`shift_id` ELSE v.`shift_id` END AS `shift_id`,
  s.`ended_at` AS `vacated_at`,
  CASE WHEN NOT (s.`ended_at` <=> v.`vacated_at`)
       THEN (_utf8mb4'See corrected Nurse findings' COLLATE utf8mb4_nopad_bin)
       ELSE v.`waiting_location` END AS `waiting_location`,
  CASE WHEN NOT (s.`ended_at` <=> v.`vacated_at`) THEN p.`notes` ELSE v.`handover` END AS `handover`,
  CASE WHEN NOT (s.`ended_at` <=> v.`vacated_at`) THEN p.`signed_by` ELSE v.`signed_by` END AS `signed_by`,
  CASE WHEN NOT (s.`ended_at` <=> v.`vacated_at`) THEN p.`signed_at` ELSE v.`signed_at` END AS `signed_at`,
  a.`id` AS `amendment_id`,
  p.`id` AS `evidence_id`,
  v.`vacated_at` AS `original_vacated_at`,
  v.`shift_id` AS `original_shift_id`,
  v.`handover` AS `original_handover`,
  v.`signed_by` AS `original_signed_by`,
  v.`signed_at` AS `original_signed_at`,
  v.`waiting_location` AS `original_waiting_location`
FROM `room_vacations` v
JOIN `effective_room_stays` s ON s.`id` = v.`stay_id`
LEFT JOIN `stay_boundary_amendments` a
  ON a.`stay_id` = v.`stay_id`
 AND a.`version` = (SELECT MAX(x.`version`) FROM `stay_boundary_amendments` x WHERE x.`stay_id` = v.`stay_id`)
LEFT JOIN `exception_evidence` p ON p.`id` = a.`evidence_id`;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_bed_turnovers` AS
SELECT
  t.`id`,
  t.`bed_id`,
  t.`stay_id`,
  t.`admission_id`,
  s.`ended_at` AS `vacated_at`,
  t.`reason`,
  t.`signed_by`,
  t.`signed_at`,
  a.`id` AS `amendment_id`,
  p.`id` AS `evidence_id`,
  t.`vacated_at` AS `original_vacated_at`,
  COALESCE(v.`shift_id`, p.`shift_id`) AS `cutoff_shift_id`,
  COALESCE(v.`signed_by`, p.`signed_by`) AS `cutoff_signed_by`,
  COALESCE(v.`signed_at`, p.`signed_at`) AS `cutoff_signed_at`,
  COALESCE(v.`handover`, p.`notes`) AS `cutoff_findings`
FROM `bed_turnovers` t
JOIN `effective_room_stays` s ON s.`id` = t.`stay_id`
LEFT JOIN `stay_boundary_amendments` a
  ON a.`stay_id` = t.`stay_id`
 AND a.`version` = (SELECT MAX(x.`version`) FROM `stay_boundary_amendments` x WHERE x.`stay_id` = t.`stay_id`)
LEFT JOIN `exception_evidence` p ON p.`id` = a.`evidence_id`
LEFT JOIN `effective_vacation_facts` v ON v.`stay_id` = t.`stay_id`;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_patients` AS
SELECT
  p.`id`,
  p.`uhid`,
  COALESCE(i.`name`, p.`name`) AS `name`,
  CASE WHEN i.`id` IS NULL THEN p.`identity_status`
       ELSE (_utf8mb4'KNOWN' COLLATE utf8mb4_nopad_bin) END AS `identity_status`,
  COALESCE(i.`evidence`, p.`identity_provenance`) AS `identity_provenance`,
  CASE WHEN i.`id` IS NULL THEN p.`date_of_birth` ELSE i.`date_of_birth` END AS `date_of_birth`,
  CASE WHEN i.`id` IS NULL THEN p.`age_years_at_registration` ELSE i.`age_years_at_registration` END AS `age_years_at_registration`,
  COALESCE(i.`sex`, p.`sex`) AS `sex`,
  CASE WHEN i.`id` IS NULL THEN p.`phone` ELSE i.`phone` END AS `phone`,
  p.`registered_at`,
  p.`registered_by`,
  i.`id` AS `identity_amendment_id`
FROM `patients` p
LEFT JOIN `patient_identifications` i
  ON i.`patient_id` = p.`id`
 AND i.`version` = (SELECT MAX(x.`version`) FROM `patient_identifications` x WHERE x.`patient_id` = p.`id`);

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_room_vacations` AS
SELECT
  v.`id`,
  v.`admission_id`,
  v.`stay_id`,
  v.`nursing_seal_id`,
  v.`shift_id`,
  v.`vacated_at`,
  v.`waiting_location`,
  v.`handover`,
  v.`signed_by`,
  v.`signed_at`,
  v.`amendment_id`,
  v.`evidence_id`,
  v.`original_vacated_at`,
  v.`original_shift_id`,
  v.`original_handover`,
  v.`original_signed_by`,
  v.`original_signed_at`,
  v.`original_waiting_location`
FROM `effective_vacation_facts` v
WHERE NOT EXISTS (SELECT 1 FROM `room_returns` r WHERE r.`vacation_id` = v.`id`)
  AND NOT EXISTS (SELECT 1 FROM `mvp_room_returns` r WHERE r.`vacation_id` = v.`id`);

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `effective_shift_ends` AS
SELECT
  n.`id`,
  n.`shift_id`,
  n.`ended_at`,
  n.`handover`,
  n.`signed_by`,
  n.`signed_at`,
  (_utf8mb4'NURSE' COLLATE utf8mb4_nopad_bin) AS `end_kind`,
  CAST(NULL AS CHAR CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin) AS `operational_evidence`
FROM `nursing_shift_ends` n
UNION ALL
SELECT
  x.`id`,
  x.`shift_id`,
  x.`ended_at`,
  CAST(NULL AS CHAR CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin) AS `handover`,
  x.`signed_by`,
  x.`signed_at`,
  (_utf8mb4'ADMIN' COLLATE utf8mb4_nopad_bin) AS `end_kind`,
  x.`evidence` AS `operational_evidence`
FROM `administrative_shift_ends` x;
