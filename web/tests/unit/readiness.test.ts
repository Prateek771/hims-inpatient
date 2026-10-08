import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db", () => ({ getDb: () => ({ execute }) }));
import { GET } from "../../src/app/api/health/ready/route";

afterEach(() => vi.resetAllMocks());
describe("database readiness", () => {
  it("returns 503 with no database error details", async () => {
    execute.mockRejectedValue(new Error("private connection details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("returns 200 after querying the installed schema", async () => {
    execute.mockResolvedValue({ rows: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(execute).toHaveBeenCalledOnce();
  });
});
