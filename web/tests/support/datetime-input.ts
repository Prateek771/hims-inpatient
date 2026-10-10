import type { Locator } from "@playwright/test";
import { hospitalLocalInput } from "../../src/lib/hospital-time";

/** Fill an exact instant in the field's declared hospital zone, including milliseconds. */
export async function fillUtcDateTime(input: Locator, instant: Date) {
  const timezone = await input.getAttribute("data-hospital-timezone");
  const canonical = await input.evaluate((element, value) => {
    const probe = document.createElement("input");
    probe.type = (element as HTMLInputElement).type;
    probe.step = (element as HTMLInputElement).step;
    probe.value = value;
    return probe.value;
  }, timezone ? hospitalLocalInput(instant, timezone) : instant.toISOString().slice(0, 23));
  await input.fill(canonical);
}
