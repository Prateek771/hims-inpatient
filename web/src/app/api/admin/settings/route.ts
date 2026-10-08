import { listSettings, saveSetting } from "@/server/settings";
import { apiError, sameOrigin } from "@/server/http";
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
    return Response.json(
      await saveSetting(request.headers, await request.json()),
    );
  } catch (e) {
    return apiError(e);
  }
}
