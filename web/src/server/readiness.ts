import "server-only";
import { is, sql } from "drizzle-orm";
import { MySqlTable, MySqlView, getTableConfig, getViewConfig } from "drizzle-orm/mysql-core";
import { getDb } from "./db";
import * as schema from "./schema";
import { authConfiguration } from "./auth-configuration";
import { expectedTriggers } from "./expected-triggers";
import { rowsOf } from "./sql";

const relations = Object.values(schema).flatMap(value => {
  if (is(value, MySqlTable)) { const c = getTableConfig(value); return [{ name: c.name, columns: c.columns.map(x => x.name) }]; }
  if (is(value, MySqlView)) { const c = getViewConfig(value); return [{ name: c.name, columns: Object.values(c.selectedFields).map(x => (x as { name: string }).name) }]; }
  return [];
});
const expectedRoutines = ["assert_planned_exit_instruction", "invalidate_clearances", "mvp_assigned", "mvp_current", "mvp_current_responsibility", "mvp_delay_allocation_amendment", "mvp_economic_basis", "mvp_finance_guard"];
/** Privileges the running application needs on its database; DDL rights are not required (and not checked). */
const requiredPrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "EXECUTE"];

/** Capability only, never policies/patients/provider calls or automatic setup. Protected files are database rows (protected_files). */
export async function assertCoreReadiness() {
  authConfiguration();
  const database = getDb();

  const columns = rowsOf<{ name: string; column: string }>(await database.execute(sql`
    select table_name as name, column_name as \`column\` from information_schema.columns
    where table_schema = database() and table_name in (${sql.join(relations.map(r => sql`${r.name}`), sql`,`)})`));
  const present = new Map<string, Set<string>>();
  for (const row of columns) present.set(row.name, (present.get(row.name) ?? new Set()).add(row.column));
  for (const required of relations) {
    const actual = present.get(required.name);
    if (!actual || required.columns.some(column => !actual.has(column))) throw new Error("Core schema unavailable");
  }

  // Through a definer-rights function: restricted accounts cannot see information_schema.triggers (migration 0006).
  const triggers = new Set((rowsOf<{ names: string | null }>(await database.execute(sql`select hims_installed_triggers() as names`))[0]?.names ?? "").split(","));
  if (expectedTriggers.some(name => !triggers.has(name))) throw new Error("Core integrity rules unavailable");
  const routines = new Set(rowsOf<{ name: string }>(await database.execute(sql`select routine_name as name from information_schema.routines where routine_schema = database()`)).map(row => row.name));
  if (expectedRoutines.some(name => !routines.has(name))) throw new Error("Core integrity rules unavailable");

  // Schema-level grants (Hostinger gives one database user; per-table roles do not exist). USAGE-only grants carry none of these.
  const granted = new Set(rowsOf<{ privilege: string }>(await database.execute(sql`
    select privilege_type as privilege from information_schema.schema_privileges
    where table_schema = database() and grantee = concat(char(39), substring_index(current_user(), '@', 1), char(39), '@', char(39), substring_index(current_user(), '@', -1), char(39))
    union select privilege_type from information_schema.user_privileges
    where grantee = concat(char(39), substring_index(current_user(), '@', 1), char(39), '@', char(39), substring_index(current_user(), '@', -1), char(39))`)).map(row => row.privilege));
  if (!granted.has("ALL PRIVILEGES") && requiredPrivileges.some(privilege => !granted.has(privilege))) throw new Error("Core privileges unavailable");
}
