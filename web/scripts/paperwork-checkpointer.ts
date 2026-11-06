import type { Connection, RowDataPacket } from "mysql2/promise";
import { connectForMigration, migrate } from "./migrate.ts";

/** The checkpoint tables come from drizzle-maria/0001 and the library migration versions from 0005. */
export const EXPECTED_CHECKPOINT_VERSIONS = [0, 1, 2, 3, 4];

export async function verifyPaperworkCheckpointer(connection: Connection) {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT v FROM lg_checkpoint_migrations ORDER BY v");
  if (JSON.stringify(rows.map((row) => Number(row.v))) !== JSON.stringify(EXPECTED_CHECKPOINT_VERSIONS)) throw new Error("Unexpected installed checkpointer migration version");
}

/** Explicit owner setup: apply the schema migrations (idempotent) and verify the checkpointer versions. */
export async function setupPaperworkCheckpointer(connectionString: string) {
  const connection = await connectForMigration(connectionString);
  try {
    await migrate(connection);
    await verifyPaperworkCheckpointer(connection);
  } finally {
    await connection.end();
  }
}
