import { afterEach, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { POST as staffPost, PATCH as staffPatch } from "../../src/app/api/admin/staff/route";
import { POST as settingPost } from "../../src/app/api/admin/settings/route";
import { POST as authPost } from "../../src/app/api/auth/[...all]/route";
loadLocalEnvironment();
const ordinary = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = ordinary; });
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticAdminBoundsOnlySecretAtLeast32Characters";

it("authenticates Admin before consuming JSON and bounds declared and streamed bodies without effects", async () => withTestDatabase(async ({ runtime }) => {
  process.env.DATABASE_URL = getTestDatabaseConfig().runtimeUrl;
  const f = await billingFixture();
  const state = async () => (await runtime.query("select (select count(*) from hims.staff_user) staff,(select count(*) from hims.setting_versions) versions,(select count(*) from hims.audit_events) audit")).rows;
  for (const [method, handler] of [["POST", staffPost], ["PATCH", staffPatch], ["POST", settingPost]] as const) {
    let read = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { read++; controller.enqueue(new TextEncoder().encode("{}")); controller.close(); } }, { highWaterMark: 0 });
    const anonymous = new Request("http://127.0.0.1:3100/api/admin/test", { method, headers: { origin: process.env.BETTER_AUTH_URL!, "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    expect((await handler(anonymous)).status).toBe(401);
    expect(read).toBe(0);
    const before = await state();
    for (const declared of [true, false]) {
      const headers = new Headers(f.ah); headers.set("origin", process.env.BETTER_AUTH_URL!); headers.set("content-type", "application/json");
      if (declared) headers.set("content-length", "16385");
      const response = await handler(new Request("http://127.0.0.1:3100/api/admin/test", { method, headers, body: JSON.stringify({ text: "x".repeat(16385) }) }));
      expect(response.status).toBe(400);
      expect(await state()).toEqual(before);
    }
  }
  const headers = new Headers(f.ah); headers.set("origin", process.env.BETTER_AUTH_URL!); headers.set("content-type", "application/json");
  const response = await staffPost(new Request("http://127.0.0.1:3100/api/admin/staff", { method: "POST", headers, body: JSON.stringify({ name: "Bounded synthetic staff", email: "bounded@synthetic.invalid", password: "SyntheticBoundedOnly123!", role: "NURSE", reason: "Bounded authorized request" }) }));
  expect(response.status).toBe(200);
  headers.set("content-length", "16385");
  const change = await authPost(new Request("http://127.0.0.1:3100/api/auth/change-password", { method: "POST", headers, body: JSON.stringify({ currentPassword: "SyntheticBillingOnly123!", newPassword: "SyntheticReplacementOnly123!" }) }));
  expect(change.status).toBe(400);
}));
