import { timingSafeEqual } from "node:crypto";

/** Bearer-secret check for scheduled jobs. A missing or short secret disables the endpoint entirely. */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
