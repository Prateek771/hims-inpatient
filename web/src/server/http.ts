import { DomainError } from "./contracts";
import { ZodError } from "zod";
export function apiError(error: unknown) {
  if (error instanceof DomainError)
    return Response.json(
      { error: error.message },
      {
        status: {
          UNAUTHORIZED: 401,
          FORBIDDEN: 403,
          VALIDATION: 400,
          CONFLICT: 409,
          PRECONDITION: 409,
        }[error.code],
      },
    );
  if (error instanceof ZodError)
    return Response.json(
      { error: "Check the fields and try again" },
      { status: 400 },
    );
  return Response.json(
    { error: "Unable to complete this request" },
    { status: 400 },
  );
}
export function sameOrigin(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(process.env.BETTER_AUTH_URL ?? request.url).origin
  )
    throw new DomainError("FORBIDDEN", "Request origin denied");
}
