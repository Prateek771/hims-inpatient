import { afterEach, describe, expect, it, vi } from "vitest";

const { readiness } = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("../../src/server/readiness", () => ({ assertCoreReadiness: readiness }));
import { GET } from "../../src/app/api/health/ready/route";

afterEach(() => vi.resetAllMocks());
describe("database readiness", () => {
  it("returns 503 with no database error details", async () => {
    readiness.mockRejectedValue(new Error("private connection details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
