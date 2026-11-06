import { assertCoreReadiness } from "@/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await assertCoreReadiness();
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Cause only (error code and message); connection errors carry no credentials.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause ?? (error as { code?: string; message?: string });
    console.error("Readiness check failed:", cause.code ?? "", (cause.message ?? "").slice(0, 300));
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
