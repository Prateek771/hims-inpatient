import { getAuth } from "@/server/auth";
import { requireStaff } from "@/server/access";
import { apiError } from "@/server/http";
import { boundedJsonBody } from "@/server/insurance/paperwork-http";
import { z } from "zod";
const passwordChange = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
  revokeOtherSessions: z.boolean().optional(),
});
const publicRoutes = new Set([
  "POST /sign-in/email",
  "GET /get-session",
  "POST /sign-out",
]);
async function handle(request: Request) {
  const path = new URL(request.url).pathname.slice("/api/auth".length);
  if (
    !publicRoutes.has(`${request.method} ${path}`) &&
    !(request.method === "POST" && path === "/change-password")
  )
    return Response.json(
      { error: "Staff account endpoint unavailable" },
      { status: 403 },
    );
  if (path === "/change-password") {
    try {
      await requireStaff(request.headers);
      const body = passwordChange.parse(await boundedJsonBody(request, 16384));
      request = new Request(request, {
        body: JSON.stringify({
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          revokeOtherSessions: true,
        }),
      });
    } catch (e) {
      return apiError(e);
    }
  }
  const response = await getAuth().handler(request);
  if (path === "/sign-in/email" && !response.ok && response.status !== 429)
    return Response.json(
      {
        error:
          "Unable to sign in. Check your details or contact your hospital administrator.",
      },
      { status: 401 },
    );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export { handle as GET, handle as POST };
