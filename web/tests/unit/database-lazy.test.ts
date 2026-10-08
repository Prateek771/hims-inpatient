import { afterEach, expect, it, vi } from "vitest";
import { getDb } from "../../src/server/db";
import { GET } from "../../src/app/api/health/ready/route";

afterEach(() => vi.unstubAllEnvs());
it("imports without database configuration and fails readiness safely", async () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(() => getDb()).toThrow("DATABASE_URL is required");
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
});
