import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TestClient } from "../../scripts/test-client.ts";

const dialect = new MySqlDialect();

/**
 * Lets the commit-time check functions (which take a Drizzle executor) run on a transaction a test opened with raw
 * SQL through its TestClient: the statement goes through the same pool, so it sees that transaction's uncommitted rows.
 */
export function asTx(client: TestClient) {
  return {
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      const [rows, fields] = await client.pool.query(sql, params);
      return [rows, fields];
    },
  } as never;
}
