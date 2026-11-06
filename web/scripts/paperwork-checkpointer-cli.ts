import { loadLocalEnvironment } from "./migrate.ts";
import { setupPaperworkCheckpointer } from "./paperwork-checkpointer.ts";

loadLocalEnvironment();
try {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("Migration database URL required");
  await setupPaperworkCheckpointer(url);
  console.log("Paperwork checkpointer tables and migration versions 0-4 are ready");
} catch {
  console.error("Paperwork checkpointer setup failed; inspect migration authority and checkpoint state without exposing credentials");
  process.exitCode = 1;
}
