import { isCronAuthorized } from "@/server/cron-auth";
import { postDueRoomCharges } from "@/server/billing/room-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled room-charge reconciliation. The hosting platform cannot keep a worker process running, so its cron
 * job calls this endpoint with the shared secret instead. The pass is idempotent: persisted stay cursors make a
 * repeat or a partly failed run safe, and nothing is revealed to an unauthorized caller.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.HIMS_CRON_SECRET)) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    await postDueRoomCharges(new Date());
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Room reconciliation failed; committed cursors are preserved. The next run recovers remaining work.");
    return Response.json({ status: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
