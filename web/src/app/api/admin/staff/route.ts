import { listStaff, createStaff, updateStaff } from "@/server/staff";
import { apiError, sameOrigin } from "@/server/http";
import { requireAdmin } from "@/server/access";
import { boundedJsonBody } from "@/server/insurance/paperwork-http";
export async function GET(request: Request) {
  try {
    return Response.json(await listStaff(request.headers), {
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
      await createStaff(request.headers, await boundedJsonBody(request, 16384)),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await requireAdmin(request.headers);
    await updateStaff(request.headers, await boundedJsonBody(request, 16384));
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
