import { createPool, type Pool, type ResultSetHeader } from "mysql2/promise";
import { mariaPoolOptions, mariaSessionSettings, rewriteSharedLocks } from "../src/server/maria-options.ts";
import { splitStatements } from "./sql-statements.ts";

/** Rewrites PostgreSQL-style $1 placeholders (outside quotes) to ?, repeating values for repeated placeholders. */
export function positional(text: string, values: readonly unknown[] = []): { text: string; values: unknown[] } {
  const out: unknown[] = [];
  let result = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" && c !== "`" ? 2 : 1;
      result += text.slice(i, j + 1);
      i = j;
    } else if (c === "$" && /\d/.test(text[i + 1] ?? "")) {
      let j = i + 1;
      while (/\d/.test(text[j] ?? "")) j += 1;
      const index = Number(text.slice(i + 1, j)) - 1;
      if (index >= values.length) throw new Error(`Missing value for $${index + 1}`);
      out.push(values[index]);
      result += "?";
      i = j - 1;
    } else result += c;
  }
  return { text: result, values: out };
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** PostgreSQL accepted ISO-8601 instants ("...T...Z") as timestamp literals; MariaDB wants "YYYY-MM-DD HH:MM:SS.ffffff" (UTC). */
function utcLiteral(iso: string) {
  return new Date(iso).toISOString().replace("T", " ").replace("Z", "");
}
const normalizeLiterals = (text: string) => text.replace(/'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))'/g, (_m, iso: string) => `'${utcLiteral(iso)}'`);
/** The pg client sent plain objects as JSON; mysql2 would otherwise expand them into `column = value` pairs. */
const normalizeValue = (value: unknown) => {
  if (typeof value === "string" && isoInstant.test(value)) return utcLiteral(value);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return JSON.stringify(value);
  return value;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test rows are untyped, as with the former pg client
export type QueryResult = { rows: any[]; rowCount: number };

/**
 * Test-only client over a one-connection pool by default, so every statement of a test (BEGIN ... COMMIT, CONNECTION_ID(), locks)
 * runs on the same session and Drizzle can share it synchronously via `.pool`. It keeps the
 * `query(text, values) -> { rows, rowCount }` shape the integration tests were written against; several
 * `;`-separated statements run one after another and the last result is returned.
 */
export class TestClient {
  readonly pool: Pool;

  constructor(source: string | { connectionString: string; [option: string]: unknown }) {
    const url = typeof source === "string" ? source : source.connectionString;
    const poolSize = typeof source === "string" ? 1 : Number(source.connectionLimit ?? 1);
    const { connectionLimit, maxIdle, ...options } = mariaPoolOptions(url);
    void connectionLimit; void maxIdle;
    // Date objects, string BIGINT columns and real booleans, like the pg client returned; computed integers (COUNT(*)) stay numbers, as ::int did.
    this.pool = createPool({
      ...options,
      dateStrings: false,
      // One connection by default, like a pg Client: BEGIN, statements and CONNECTION_ID() share one session.
      connectionLimit: poolSize,
      maxIdle: poolSize,
      typeCast: (field, next) => {
        if (field.type === "LONGLONG" && field.table) return field.string();
        // 1-digit integers are booleans (BOOLEAN columns, EXISTS, comparisons), as in PostgreSQL.
        if ((field.type === "TINY" || field.type === "LONG") && field.length === 1) {
          const value = field.string();
          return value === null ? null : value !== "0";
        }
        return next();
      },
    });
    this.pool.pool.on("connection", (connection) => {
      rewriteSharedLocks(connection);
      connection.query(mariaSessionSettings(0), () => {});
      // The application's own pool runs at READ COMMITTED; tests must observe the same visibility after lock waits.
      connection.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED", () => {});
    });
  }

  /** The pg client needed an explicit connect; here the pool connects lazily. */
  async connect() {}

  /**
   * Connections currently waiting for an InnoDB lock, with the statement each is executing. MariaDB 11.8 leaves
   * information_schema.INNODB_LOCK_WAITS empty and never reports "LOCK WAIT" in INNODB_TRX, even while a statement is
   * blocked, but SHOW ENGINE INNODB STATUS lists every waiting transaction with its connection id and statement.
   */
  async lockWaiters(): Promise<{ pid: number; query: string }[]> {
    const [rows] = await this.pool.query("SHOW ENGINE INNODB STATUS");
    const status = String((rows as Record<string, unknown>[])[0]?.Status ?? "");
    const sessions = status.slice(Math.max(0, status.indexOf("LIST OF TRANSACTIONS FOR EACH SESSION")));
    return [...sessions.matchAll(/LOCK WAIT[^\n]*\n(?:MariaDB|MySQL) thread id (\d+)[^\n]*\n([\s\S]*?)(?=\n\*\*\*|\n---TRANSACTION|$)/g)].map((match) => ({ pid: Number(match[1]), query: match[2] }));
  }

  async query(text: string, values: readonly unknown[] = []): Promise<QueryResult> {
    // Tests ask "is connection B blocked by connection A?" (one boolean) or "which connections does A block?" (rows of pid).
    // The status text does not name the blocker, which is exact for the isolated two-session tests.
    const alias = /\)\s*(?:as\s+)?(\w+)\s*$/i.exec(text.trim())?.[1] ?? "blocked";
    if (text.includes("INNODB_LOCK_WAITS")) {
      const waiting = (await this.lockWaiters()).map((waiter) => waiter.pid);
      if (values.length >= 2) return { rows: [{ [alias]: waiting.includes(Number(values[1])) }], rowCount: 1 };
      const rows = waiting.filter((pid) => pid !== Number(values[0])).map((pid) => ({ pid }));
      return { rows, rowCount: rows.length };
    }
    if (/trx_state\s*=\s*'LOCK WAIT'/i.test(text)) {
      const like = /trx_query like '%([^%']+)%'/i.exec(text)?.[1];
      const pid = /trx_mysql_thread_id\s*=\s*\$1/i.test(text) ? Number(values[0]) : undefined;
      const hit = (await this.lockWaiters()).some((waiter) => (pid === undefined || waiter.pid === pid) && (!like || waiter.query.includes(like)));
      return { rows: [{ [alias]: hit }], rowCount: 1 };
    }
    const statements = /\bBEGIN\b[\s\S]*\bEND\b/i.test(text) || !text.includes(";") ? [text] : splitStatements(text);
    let last: QueryResult = { rows: [], rowCount: 0 };
    for (const statement of statements) {
      const prepared = positional(normalizeLiterals(statement), values.map(normalizeValue));
      const [result] = prepared.values.length ? await this.pool.query(prepared.text, prepared.values) : await this.pool.query(prepared.text);
      last = Array.isArray(result)
        ? { rows: result as Record<string, unknown>[], rowCount: result.length }
        : { rows: [], rowCount: (result as ResultSetHeader).affectedRows };
    }
    return last;
  }

  end() {
    return this.pool.end();
  }
}
