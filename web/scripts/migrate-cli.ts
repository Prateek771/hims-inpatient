import { connectForMigration, loadLocalEnvironment, migrate } from "./migrate.ts";

loadLocalEnvironment();
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required; set it to the same mysql:// URL as DATABASE_URL when one database user is used");
let connection;
try {
  connection = await connectForMigration(url);
  const applied = await migrate(connection);
  console.log(applied.length ? `HIMS migrations applied: ${applied.join(", ")}` : "HIMS migrations are up to date");
} catch (error) {
  console.error("HIMS migration failed; inspect database access and migration state without exposing credentials");
  if (error instanceof Error && /checksum mismatch|Another migration/.test(error.message)) console.error(error.message);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
