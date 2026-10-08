import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`SELECT
      EXISTS (SELECT id FROM hims.hospital_settings LIMIT 1),
      EXISTS (SELECT id FROM hims.setting_versions LIMIT 1),
      EXISTS (SELECT id FROM hims.audit_events LIMIT 1)`);
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
