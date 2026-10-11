import { expect, type Locator, type Page } from "@playwright/test";

/** Observe this real action's response; callers must wait for its exact rendered result. */
export async function submitServerAction(page: Page, button: Locator) {
  const pathname = new URL(page.url()).pathname;
  const [response] = await Promise.all([
    page.waitForResponse(result => result.request().method() === "POST"
      && new URL(result.url()).pathname === pathname
      && Boolean(result.request().headers()["next-action"])),
    button.click(),
  ]);
  expect([200, 303]).toContain(response.status());
  // Next may keep an RSC stream open after applying its result, so transport EOF
  // is not the completion signal. A 200/303 alone never establishes UI success.
}
