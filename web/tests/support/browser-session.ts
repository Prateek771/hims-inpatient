import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type WorkflowRole = "ADMIN" | "ADMISSION" | "DOCTOR" | "BILLING" | "NURSE" | "PHARMACY" | "LAB" | "INSURANCE";
/** A real synthetic Better Auth session created by the guarded fixture process.
 * Context cookies are isolated per test; switching roles never revokes another test's shared session. */
export async function useStaffSession(page: Page, role: WorkflowRole) {
  const file = resolve("tmp/e2e-auth", `${role.toLowerCase()}.json`);
  const state = JSON.parse(await readFile(file, "utf8")) as { cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0] };
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
  await page.goto("/workspace");
  // Next can stream the authenticated redirect after the original document loads.
  // Wait for its actual destination before a test begins another navigation.
  const homes = { ADMIN: "/overview", ADMISSION: "/admissions", DOCTOR: "/history", BILLING: "/billing", NURSE: "/nursing", PHARMACY: "/pharmacy", LAB: "/history", INSURANCE: "/insurance" };
  await page.waitForURL(new RegExp(`${homes[role]}$`), { waitUntil: "load" });
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
}
