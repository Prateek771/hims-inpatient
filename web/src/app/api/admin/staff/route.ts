import { listStaff, createStaff, updateStaff } from "@/server/staff";
import { apiError, sameOrigin } from "@/server/http";
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
    return Response.json(
      await createStaff(request.headers, await request.json()),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await updateStaff(request.headers, await request.json());
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
