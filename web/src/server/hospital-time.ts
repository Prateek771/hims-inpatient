import "server-only";
import { db } from "./db";
import { hospitalSettings } from "./schema";
import { DomainError } from "./contracts";
import { hospitalLocalInstant } from "@/lib/hospital-time";

export async function hospitalTimeConfiguration() {
  const [hospital] = await db.select({ timezone: hospitalSettings.timezone }).from(hospitalSettings).limit(1);
  return { timezone: hospital?.timezone ?? "Asia/Kolkata", configured: !!hospital };
}
export async function hospitalFormInstant(value: string, renderedTimezone: string) {
  const { timezone } = await hospitalTimeConfiguration();
  if (renderedTimezone !== timezone) throw new DomainError("CONFLICT", "Hospital timezone changed or is missing. Refresh the form before entering an actual time.");
  try { return hospitalLocalInstant(value, timezone); }
  catch (error) {
    if (error instanceof RangeError) throw new DomainError("VALIDATION", error.message);
    throw error;
  }
}
