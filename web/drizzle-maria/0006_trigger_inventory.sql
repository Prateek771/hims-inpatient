-- 0006_trigger_inventory.sql: lets the running application (which has no TRIGGER privilege on restricted accounts, so
-- information_schema.TRIGGERS shows it nothing) verify that every integrity trigger is installed, without being
-- allowed to create, alter or drop one. The function runs with the privileges of the account that applied the migration.
-- Idempotent; same `DELIMITER $$` convention as 0002_helpers.sql.
DELIMITER $$
DROP FUNCTION IF EXISTS hims_installed_triggers$$
CREATE FUNCTION hims_installed_triggers()
RETURNS LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin
READS SQL DATA
SQL SECURITY DEFINER
BEGIN
  DECLARE v_names LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin DEFAULT '';
  SET SESSION group_concat_max_len = 1048576;
  SELECT GROUP_CONCAT(trigger_name ORDER BY trigger_name SEPARATOR ',') INTO v_names
    FROM information_schema.TRIGGERS WHERE trigger_schema = DATABASE();
  RETURN COALESCE(v_names, '');
END$$
DELIMITER ;
