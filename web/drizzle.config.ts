import { defineConfig } from "drizzle-kit";

// MariaDB DDL is hand-written and idempotent in ./drizzle-maria; this config is only for introspection tooling.
export default defineConfig({
  dialect: "mysql",
  schema: "./src/server/schema/index.ts",
  out: "./drizzle-maria",
});
