import "server-only";
import { accessSync, constants } from "node:fs";
import { is, sql } from "drizzle-orm";
import { PgTable, PgView, getTableConfig, getViewConfig } from "drizzle-orm/pg-core";
import { getDb } from "./db";
import * as schema from "./schema";
import { authConfiguration } from "./auth-configuration";
import { protectedStorageDirectory } from "./protected-storage";

const relations = Object.values(schema).flatMap(value => {
  if (is(value, PgTable)) { const c = getTableConfig(value); return [{ name: c.name, columns: c.columns.map(x => x.name), table: true }]; }
  if (is(value, PgView)) { const c = getViewConfig(value); return [{ name: c.name, columns: Object.values(c.selectedFields).map(x => (x as { name: string }).name), table: false }]; }
  return [];
});
const updates: Record<string, string[]> = {
  room_stays: ["ended_at", "last_reconciled_at", "posted_paise"],
  care_billing_events: ["tariff_version_id", "resolution_reason", "state"], pharmacy_batches: ["available_quantity"], insurance_cases: ["assigned_staff_id", "version", "review_revision", "document_set_revision"],
  paperwork_runs: ["status", "revision", "pending_review_id"],
};
const fullUpdates = ["hospital_settings", "staff_user", "staff_account", "staff_session", "staff_verification", "beds", "admissions", "admission_counters"];
/** Capability only, never policies/patients/provider calls or automatic setup. */
export async function assertCoreReadiness() {
  authConfiguration();
  for (const kind of ["insurance", "discharge"] as const) accessSync(protectedStorageDirectory(kind), constants.R_OK | constants.W_OK);
  const database = getDb();
  const result = await database.execute<{ name: string; columns: string[]; readable: boolean; insertable: boolean }>(sql`
    select c.relname name,array_agg(a.attname order by a.attnum) columns,
      bool_and(has_column_privilege(c.oid,a.attname,'SELECT')) readable,has_table_privilege(c.oid,'INSERT') insertable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where n.nspname='hims' and c.relname in (${sql.join(relations.map(r => sql`${r.name}`), sql`,`)}) group by c.oid,c.relname`);
  for (const required of relations) {
    const actual = result.rows.find(row => row.name === required.name);
    if (!actual?.readable || (required.table && !actual.insertable) || required.columns.some(column => !actual.columns.includes(column))) throw new Error("Core schema unavailable");
  }
  const checks = Object.entries(updates).flatMap(([table, columns]) => columns.map(column => sql`has_column_privilege(current_user,${`hims.${table}`},${column},'UPDATE')`));
  for (const table of fullUpdates) checks.push(sql`has_table_privilege(current_user,${`hims.${table}`},'UPDATE')`);
  for (const table of ["staff_session", "staff_verification", "bed_holds"]) checks.push(sql`has_table_privilege(current_user,${`hims.${table}`},'DELETE')`);
  const permissions = await database.execute<{ available: boolean }>(sql`select (${sql.join(checks, sql` and `)}) and
    has_schema_privilege(current_user,'hims','USAGE') and not has_schema_privilege(current_user,'hims','CREATE') and not has_schema_privilege(current_user,'public','CREATE') and
    current_user in ('hims_runtime','hims_test_runtime') and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls available from pg_roles where rolname=current_user`);
  if (!permissions.rows[0]?.available) throw new Error("Core privileges unavailable");
}
