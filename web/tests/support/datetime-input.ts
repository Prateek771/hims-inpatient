import type { Locator } from "@playwright/test";

/** The arrival field records UTC wall time, including milliseconds. */
export async function fillUtcDateTime(input: Locator, instant: Date) {
  const canonical = await input.evaluate((element, value) => {
    const probe = document.createElement("input");
    probe.type = (element as HTMLInputElement).type;
    probe.step = (element as HTMLInputElement).step;
    probe.value = value;
    return probe.value;
  }, instant.toISOString().slice(0, 23));
  await input.fill(canonical);
}
