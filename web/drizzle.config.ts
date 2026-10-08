import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/schema/core.ts",
  out: "./drizzle",
  schemaFilter: ["hims"],
});
