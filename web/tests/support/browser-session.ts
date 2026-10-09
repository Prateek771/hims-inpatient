import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type WorkflowRole = "ADMIN" | "ADMISSION" | "DOCTOR" | "BILLING" | "NURSE" | "PHARMACY" | "LAB";
/** A real synthetic Better Auth session created by the guarded fixture process.
 * Context cookies are isolated per test; switching roles never revokes another test's shared session. */
export async function useStaffSession(page: Page, role: WorkflowRole) {
  const file = resolve("tmp/e2e-auth", `${role.toLowerCase()}.json`);
  const state = JSON.parse(await readFile(file, "utf8")) as { cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0] };
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
  await page.goto("/workspace");
}
