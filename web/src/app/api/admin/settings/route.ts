import { listSettings, saveSetting } from "@/server/settings";
import { apiError, sameOrigin } from "@/server/http";
import { requireAdmin } from "@/server/access";
import { boundedJsonBody } from "@/server/insurance/paperwork-http";
export async function GET(request: Request) {
  try {
    return Response.json(await listSettings(request.headers), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireAdmin(request.headers);
    return Response.json(
      await saveSetting(request.headers, await boundedJsonBody(request, 16384)),
    );
  } catch (e) {
    return apiError(e);
  }
}
