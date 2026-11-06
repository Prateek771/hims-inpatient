import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlColumn, type MySqlTable } from "drizzle-orm/mysql-core";
import type { Transaction } from "./db";

/** What the helpers need; satisfied by both a transaction and the autocommit `db`. */
export type Executor = Pick<Transaction, "select" | "insert" | "update" | "execute">;

/** MariaDB has no INSERT ... RETURNING in Drizzle: generate ids in the app, insert with them, then re-select by id. */
export const newId = (): string => randomUUID();

type FieldInfo = { name: string; columnType?: number; columnLength?: number };

/** MariaDB has no boolean type: BOOLEAN columns and comparison/EXISTS expressions are 1-digit integers (TINY or LONG, length 1). */
const isBooleanField = (field: FieldInfo) => (field.columnType === 1 || field.columnType === 3) && field.columnLength === 1;

/**
 * drizzle mysql2 `execute` resolves to `[rows, fields]` for SELECT; return the rows (empty for writes), with
 * boolean-shaped columns turned into real booleans (PostgreSQL returned them, and callers render and compare them).
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  const rows = result[0] as Record<string, unknown>[];
  const fields = Array.isArray(result[1]) ? (result[1] as FieldInfo[]) : [];
  const booleans = fields.filter(isBooleanField).map((field) => field.name);
  // DATETIME(6)/TIMESTAMP columns arrive as UTC strings from raw queries; PostgreSQL returned Date objects.
  const instants = fields.filter((field) => field.columnType === 7 || field.columnType === 12).map((field) => field.name);
  if (!booleans.length && !instants.length) return rows as T[];
  return rows.map((row) => {
    const copy = { ...row };
    for (const name of booleans) if (copy[name] !== null && copy[name] !== undefined) copy[name] = Number(copy[name]) !== 0;
    for (const name of instants) if (typeof copy[name] === "string") copy[name] = toDate(copy[name]);
    return copy;
  }) as T[];
}

/** Rows changed by an INSERT/UPDATE/DELETE executed through `execute`. */
export function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const value = (header as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof value === "number" ? value : 0;
}

/** Raw SELECT timestamps arrive as UTC strings ("YYYY-MM-DD HH:MM:SS.ffffff"); ORM queries already return Date. */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const iso = /^\d{4}-\d{2}-\d{2}[ T]/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error(`Not a database timestamp: ${String(value)}`);
}

export type DbErrorKind = "unique" | "foreign-key" | "check" | "rule" | "deadlock" | "serialization" | "lock-timeout" | "other";

const KIND_BY_ERRNO: Record<number, DbErrorKind> = {
  1062: "unique",
  1451: "foreign-key",
  1452: "foreign-key",
  4025: "check",
  3819: "check",
  1644: "rule", // trigger SIGNAL: the rule text is in `message`
  1213: "deadlock",
  1020: "serialization", // ER_CHECKREAD: a repeatable-read write hit a row changed since its snapshot (PostgreSQL 40001)
  1205: "lock-timeout",
};

/** Classify a driver error (Drizzle wraps mysql2 errors in `cause`). `message` is the server's own text, e.g. a trigger rule. */
export function dbError(error: unknown): { kind: DbErrorKind; errno?: number; message: string } {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { errno?: unknown; sqlMessage?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.errno === "number") {
      const message = typeof candidate.sqlMessage === "string" ? candidate.sqlMessage : String(candidate.message ?? "");
      return { kind: KIND_BY_ERRNO[candidate.errno] ?? "other", errno: candidate.errno, message };
    }
    current = candidate.cause;
  }
  return { kind: "other", message: error instanceof Error ? error.message : String(error) };
}

type Row<T extends MySqlTable> = InferSelectModel<T>;

function keyColumns(table: MySqlTable): AnyMySqlColumn[] {
  const config = getTableConfig(table);
  const single = config.columns.filter((column) => column.primary);
  return single.length ? single : (config.primaryKeys[0]?.columns ?? []);
}

/** The JavaScript property under which Drizzle exposes `column`. */
function columnProperty(table: MySqlTable, column: AnyMySqlColumn): string {
  const entry = Object.entries(table).find(([, value]) => value === column);
  return entry ? entry[0] : column.name;
}

/** Re-select rows by primary key, in the order of `keys` (each key is an object keyed by SQL column name). */
async function selectByKeys<T extends MySqlTable>(tx: Executor, table: T, columns: AnyMySqlColumn[], keys: Record<string, unknown>[]): Promise<Row<T>[]> {
  if (!keys.length) return [];
  const where = columns.length === 1
    ? inArray(columns[0], keys.map((key) => key[columns[0].name]) as never[])
    : or(...keys.map((key) => and(...columns.map((column) => eq(column, key[column.name] as never)))));
  const rows = (await tx.select().from(table).where(where)) as unknown as Record<string, unknown>[];
  const stamp = (read: (column: AnyMySqlColumn) => unknown) => JSON.stringify(columns.map((column) => String(read(column))));
  const index = new Map(rows.map((row) => [stamp((column) => row[columnProperty(table, column)]), row]));
  return keys.map((key) => index.get(stamp((column) => key[column.name]))).filter(Boolean) as Row<T>[];
}

/**
 * INSERT ... RETURNING replacement: a missing native-UUID primary key is generated here, the rows are inserted,
 * then re-selected by primary key inside the same transaction.
 */
export async function insertReturning<T extends MySqlTable>(tx: Executor, table: T, values: InferInsertModel<T> | InferInsertModel<T>[]): Promise<Row<T>[]> {
  const columns = keyColumns(table);
  if (!columns.length) throw new Error("insertReturning requires a primary key");
  const generated = columns.length === 1 && columns[0].getSQLType() === "uuid" ? columnProperty(table, columns[0]) : null;
  const rows = (Array.isArray(values) ? values : [values]).map((row) => {
    const record = { ...(row as Record<string, unknown>) };
    if (generated && record[generated] === undefined) record[generated] = newId();
    return record;
  });
  if (!rows.length) return [];
  const keys = rows.map((row) => Object.fromEntries(columns.map((column) => [column.name, row[columnProperty(table, column)]])));
  if (keys.some((key) => Object.values(key).some((value) => value === undefined))) throw new Error("insertReturning requires explicit key values for non-UUID keys");
  await tx.insert(table).values(rows as never);
  return selectByKeys(tx, table, columns, keys);
}

/**
 * UPDATE ... RETURNING replacement: lock the matching rows, update them, then re-select them by primary key.
 * Returns the updated rows (empty when nothing matched).
 */
export async function updateReturning<T extends MySqlTable>(tx: Executor, table: T, set: Partial<InferInsertModel<T>> | Record<string, unknown>, where?: SQL): Promise<Row<T>[]> {
  const columns = keyColumns(table);
  if (!columns.length) throw new Error("updateReturning requires a primary key");
  const picked = Object.fromEntries(columns.map((column) => [column.name, column]));
  const found = (await tx.select(picked).from(table).where(where).for("update")) as Record<string, unknown>[];
  if (!found.length) return [];
  await tx.update(table).set(set as never).where(where);
  return selectByKeys(tx, table, columns, found);
}

/** INSERT ... ON CONFLICT DO NOTHING RETURNING replacement: the row, or undefined when any unique key already exists. */
export async function insertOrNothing<T extends MySqlTable>(tx: Executor, table: T, values: InferInsertModel<T>): Promise<Row<T> | undefined> {
  try {
    return (await insertReturning(tx, table, values))[0];
  } catch (error) {
    // A failed statement does not abort a MariaDB transaction, so the caller can carry on.
    if (dbError(error).kind === "unique") return undefined;
    throw error;
  }
}
