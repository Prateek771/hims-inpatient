import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/schema/index.ts",
  out: "./drizzle",
  schemaFilter: ["hims"],
});
