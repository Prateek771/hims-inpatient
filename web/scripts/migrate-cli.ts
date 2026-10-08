import { Client } from "pg";
import { loadLocalEnvironment, migrate } from "./migrate.ts";

loadLocalEnvironment();
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "MIGRATION_DATABASE_URL is required; runtime credentials are never a fallback",
  );
const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: 3000,
});
try {
  await client.connect();
  await migrate(client);
  console.log("HIMS migrations applied");
} catch {
  console.error(
    "HIMS migration failed; inspect database access and migration state without exposing credentials",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
