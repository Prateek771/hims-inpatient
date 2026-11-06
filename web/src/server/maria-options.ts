import type { PoolOptions } from "mysql2/promise";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Connection options for a mysql:// URL. TLS verification is always on except for loopback hosts. */
export function mariaPoolOptions(connectionString: string): PoolOptions {
  const url = new URL(connectionString);
  if (!["mysql:", "mariadb:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a mysql:// URL");
  const remote = !localHosts.has(url.hostname);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    charset: "utf8mb4",
    // Dates are DATETIME(6) holding UTC. Strings are parsed by drizzle (appended "Z"); Date parameters are written as UTC.
    timezone: "Z",
    dateStrings: true,
    // BIGINT arrives as a number when safe, a string otherwise; DECIMAL stays a string (as numeric did).
    supportBigNumbers: true,
    bigNumberStrings: false,
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 5,
    idleTimeout: 30000,
    connectTimeout: 3000,
    ...(remote ? { ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" } } : {}),
  };
}

/** Session settings every application connection runs: UTC, bounded statements, PostgreSQL-compatible quoting/concatenation. */
export const mariaSessionSettings = (statementTimeoutSeconds: number) =>
  `SET time_zone = '+00:00', max_statement_time = ${statementTimeoutSeconds}, sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES,PIPES_AS_CONCAT')`;

/**
 * Drizzle's MySQL dialect ends shared row locks with "for share"; MariaDB spells that "lock in share mode".
 * mysql2 passes SQL text, an options object or a Query instance to connection.query: change the text in place, never copy.
 */
export function rewriteSharedLocks(connection: unknown) {
  const target = connection as { query: (...args: unknown[]) => unknown };
  const query = target.query.bind(connection);
  const rewrite = (text: string) => text.replace(/ for share$/, " lock in share mode");
  target.query = (first: unknown, ...rest: unknown[]) => {
    if (typeof first === "string") return query(rewrite(first), ...rest);
    const options = first as { sql?: unknown } | null;
    if (options && typeof options.sql === "string") options.sql = rewrite(options.sql);
    return query(first, ...rest);
  };
}
