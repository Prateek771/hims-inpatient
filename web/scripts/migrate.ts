import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Client } from "pg";

export function loadLocalEnvironment() {
  // Next intentionally excludes .env.local in test mode; the dedicated local
  // fixture URLs live there. Node preserves explicitly supplied CI variables.
  const path = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export async function migrate(client: Client) {
  const { rows: [identity] } = await client.query("SELECT current_database() AS database, current_user AS role, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user");
  const isApp = identity.database === "hims_local" && identity.role === "hims_owner";
  const isTest = (identity.database === "hims_test" || (process.env.CI === "true" && /^hims_test_ci_[a-z0-9]{8,40}$/.test(identity.database))) && identity.role === "hims_test_owner";
  if ((!isApp && !isTest) || identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole) throw new Error("Migration requires the dedicated non-privileged database owner");
  const runtime = isApp ? "hims_runtime" : "hims_test_runtime";
  await client.query("SELECT pg_advisory_lock(729104209)");
  try {
    await client.query("CREATE TABLE IF NOT EXISTS public.hims_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
    for (const name of (await readdir(folder)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
      const sql = await readFile(resolve(folder, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM public.hims_migrations WHERE name=$1", [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error("Applied migration checksum mismatch");
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public.hims_migrations(name,checksum) VALUES ($1,$2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    // Role names are fixed above, never derived from untrusted SQL input.
    await client.query(`REVOKE ALL ON SCHEMA hims FROM PUBLIC; GRANT USAGE ON SCHEMA hims TO ${runtime}; REVOKE ALL ON ALL TABLES IN SCHEMA hims FROM PUBLIC, ${runtime}; GRANT SELECT ON hims.hospital_settings, hims.setting_versions, hims.audit_events TO ${runtime}; GRANT INSERT ON hims.hospital_settings, hims.setting_versions, hims.audit_events TO ${runtime}; GRANT UPDATE ON hims.hospital_settings TO ${runtime}; GRANT SELECT, INSERT, UPDATE ON hims.staff_user, hims.staff_account, hims.staff_session, hims.staff_verification TO ${runtime}; GRANT DELETE ON hims.staff_session, hims.staff_verification TO ${runtime}; REVOKE CREATE ON SCHEMA public FROM PUBLIC, ${runtime}; REVOKE ALL ON public.hims_migrations FROM PUBLIC, ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.patients, hims.room_stays TO ${runtime}; GRANT SELECT, INSERT, UPDATE ON hims.beds, hims.admissions, hims.admission_counters TO ${runtime}; GRANT SELECT, INSERT, DELETE ON hims.bed_holds TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.charges, hims.charge_finalizations, hims.charge_reversals, hims.receipts, hims.receipt_allocations, hims.billing_requests TO ${runtime}; GRANT UPDATE (ended_at, last_reconciled_at, posted_paise) ON hims.room_stays TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.clinical_rounds, hims.clinical_addenda, hims.clinical_orders, hims.care_tasks, hims.clinical_task_events, hims.care_occurrences, hims.care_billing_events, hims.clinical_summaries, hims.nurse_assignments, hims.nursing_shifts, hims.nursing_shift_ends, hims.nursing_observations, hims.medication_administrations, hims.nursing_consumables TO ${runtime}; GRANT UPDATE (tariff_version_id, resolution_reason, state) ON hims.care_billing_events TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.nursing_addenda TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.nurse_assignment_revocations TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.transfer_orders, hims.admission_transfers, hims.transfer_insurance_tasks TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.pharmacy_batches, hims.pharmacy_movements, hims.pharmacy_preparations TO ${runtime}; GRANT UPDATE (available_quantity) ON hims.pharmacy_batches TO ${runtime};`);
    await client.query(`GRANT SELECT, INSERT ON hims.lab_samples, hims.lab_processing, hims.lab_reports, hims.lab_report_addenda, hims.lab_dispositions TO ${runtime};`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(729104209)");
  }
}
