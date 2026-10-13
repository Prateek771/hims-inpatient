import { expect, test } from "@playwright/test";
import { useStaffSession as signInStaffSession } from "../support/browser-session";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openWorkflowTab } from "../support/workflow-tabs";

const jobs = {
  ADMIN: { home: "/overview", labels: ["Home", "Beds", "Staff", "Assignments", "Billing", "Pharmacy", "Insurance", "Discharge", "Documents", "Exceptions", "Settings"] },
  DOCTOR: { home: "/clinical", labels: ["Patients", "Discharge", "Exceptions"] },
  NURSE: { home: "/nursing", labels: ["My shift", "Discharge", "Exceptions"] },
  ADMISSION: { home: "/admissions", labels: ["Admissions", "Insurance", "Exceptions"] },
  PHARMACY: { home: "/pharmacy", labels: ["Medicines", "Discharge", "Exceptions"] },
  LAB: { home: "/lab", labels: ["Lab", "Exceptions"] },
  INSURANCE: { home: "/insurance", labels: ["Cases", "Exceptions"] },
  BILLING: { home: "/billing", labels: ["Billing", "Insurance", "Discharge", "Documents", "Exceptions"] },
} as const;

for (const role of Object.keys(jobs) as (keyof typeof jobs)[]) {
  test(`${role} starts on its approved real worklist with every authorized job`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await signInStaffSession(page, role);
    await expect(page).toHaveURL(new RegExp(`${jobs[role].home}$`));
    const nav = page.getByRole("navigation", { name: "Hospital sections" });
    await expect(nav.getByRole("link")).toHaveText([...jobs[role].labels]);
    await expect(page.getByRole("button", { name: "Customize", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    if (role !== "ADMIN") {
      expect((await page.request.get("/api/admin/staff")).status()).toBe(403);
      await page.goto("/admin/staff");
      await expect(page).toHaveURL(new RegExp(`${jobs[role].home}$`));
      await expect(page.getByRole("heading", { name: "Create staff account" })).toHaveCount(0);
      expect((await page.request.get("/overview")).status()).toBe(404);
    } else {
      expect((await page.request.get("/clinical")).status()).toBe(404);
    }
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    // End the wide guide excerpt at a complete surface rather than splitting text.
    const lastSurface = role === "NURSE" ? page.locator(".nursing-shift-summary")
      : role === "INSURANCE" ? page.locator("main tbody tr").first()
      : role === "ADMISSION" ? page.getByRole("tablist", { name: "Work sections" })
      : page.locator(".operational-metrics, .care-work-metrics").first();
    const surface = await lastSurface.boundingBox();
    expect(surface).not.toBeNull();
    const height = Math.ceil(surface!.y + surface!.height - 76 + (role === "INSURANCE" ? 1 : 8));
    await page.screenshot({ path: testInfo.outputPath(`guide-${role.toLowerCase()}.png`), clip: { x: 220, y: 76, width: 960, height } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(nav.getByRole("link")).toHaveText([...jobs[role].labels]);
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("personal appearance persists for its staff member and profile never grants role administration", async ({ page }) => {
  await signInStaffSession(page, "NURSE");
  const profileButton = page.getByRole("button", { name: "Profile for Synthetic E2E NURSE" });
  await profileButton.click();
  const profile = page.getByRole("dialog", { name: "Profile", exact: true });
  await expect(profile.getByLabel("Name · managed by hospital admin")).toHaveValue("Synthetic E2E NURSE");
  await expect(profile.getByLabel("Role · managed by hospital admin")).toHaveValue("Nurse");
  await expect(profile.getByLabel("Role · managed by hospital admin")).toHaveAttribute("readonly", "");
  await page.keyboard.press("Escape");
  await expect(profile).not.toBeVisible();
  await expect(profileButton).toBeFocused();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const customize = page.getByRole("dialog", { name: "Customize my view" });
  await customize.getByLabel("Reporting blue", { exact: true }).check();
  await customize.getByRole("combobox", { name: "Density", exact: true }).selectOption("compact");
  await customize.getByRole("combobox", { name: "Motion", exact: true }).selectOption("none");
  await customize.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(customize.getByLabel("Reporting blue", { exact: true })).toBeChecked();
  await expect(customize.getByRole("combobox", { name: "Density", exact: true })).toHaveValue("compact");
  await expect(customize.getByRole("combobox", { name: "Motion", exact: true })).toHaveValue("none");
  await page.keyboard.press("Escape");
  await signInStaffSession(page, "DOCTOR");
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(customize.getByLabel("Hospital teal", { exact: true })).toBeChecked();
  await expect(customize.getByRole("combobox", { name: "Density", exact: true })).toHaveValue("comfortable");
  await page.keyboard.press("Escape");
  expect((await page.request.post("/api/auth/update-user", { data: { role: "ADMIN", name: "Forged" } })).status()).toBe(403);
});

test("all personal accents keep actual small action and selected-tab text readable", async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = JSON.parse(await readFile(resolve("tmp/e2e-care.json"), "utf8")) as { admissionId: string };
  for (const role of ["DOCTOR", "NURSE"] as const) {
    await signInStaffSession(page,role);
    if(role === "DOCTOR") await page.goto(`/clinical?admissionId=${fixture.admissionId}`);
  for (const accent of ["Hospital teal", "Reporting blue", "Soft purple"]) {
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    const customize = page.getByRole("dialog", { name: "Customize my view" });
    await customize.getByLabel(accent, { exact: true }).check();
    await customize.getByRole("button", { name: "Done", exact: true }).click();
    const contrasts = await page.locator(".nav-item.active, .eyebrow, .workflow-tablist [aria-selected=true], .button:not(.secondary):not(.quiet), .caption, th, .nursing-shift-summary p").evaluateAll(elements => {
      const color = (value: string) => {
        const values = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
        return [values[0], values[1], values[2], values[3] ?? 1];
      };
      const blend = (foreground: number[], background: number[]) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
      const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      return elements.filter(element => element.getClientRects().length).map(element => {
        const ancestry: Element[] = [];
        for (let current: Element | null = element; current; current = current.parentElement) ancestry.unshift(current);
        let background = [255, 255, 255];
        for (const ancestor of ancestry) background = blend(color(getComputedStyle(ancestor).backgroundColor), background);
        const ink = blend(color(getComputedStyle(element).color), background);
        const first = luminance(ink), second = luminance(background);
        return { label: element.textContent?.trim().slice(0, 80), ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) };
      });
    });
    expect(contrasts.length).toBeGreaterThan(2);
    expect(contrasts.filter(item => item.ratio < 4.5), `${role} ${accent}: ${JSON.stringify(contrasts)}`).toEqual([]);
  }
  }
});

test("profile changes a dedicated synthetic password and Logout revokes that actual session", async ({ page }) => {
  await signInStaffSession(page, "ADMIN");
  const email = `profile-${Date.now()}@e2e.fixture.invalid`;
  const password = "SyntheticProfileOnly123!";
  const updated = "SyntheticProfileUpdated456!";
  const created = await page.request.post("/api/admin/staff", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { name: "Synthetic profile doctor", email, password, role: "DOCTOR", reason: "Isolated synthetic account controls regression" },
  });
  expect(created.ok()).toBe(true);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email or role", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clinical$/);
  await page.getByRole("button", { name: "Profile for Synthetic profile doctor" }).click();
  const profile = page.getByRole("dialog", { name: "Profile", exact: true });
  await profile.getByLabel("Current password", { exact: true }).fill(password);
  await profile.getByLabel("New password", { exact: true }).fill(updated);
  await profile.getByLabel("Confirm password", { exact: true }).fill(updated);
  await profile.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(profile.getByRole("status")).toContainText("Password changed");
  await profile.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/clinical");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email or role", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(updated);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clinical$/);
});

test("patient tabs retain an unsigned draft and support keyboard selection without losing admission identity", async ({ page }) => {
  const fixture = JSON.parse(await readFile(resolve("tmp/e2e-care.json"), "utf8")) as { admissionId: string };
  await signInStaffSession(page, "DOCTOR");
  await page.goto(`/clinical?admissionId=${fixture.admissionId}`);
  const rounds = await openWorkflowTab(page, "Rounds");
  await rounds.getByText("Record a new round", { exact: true }).click();
  const notes = rounds.getByTestId("round-form").getByLabel("Clinical assessment / notes");
  await notes.fill("Unsigned synthetic draft retained across task tabs");
  await openWorkflowTab(page, "Orders");
  await openWorkflowTab(page, "Rounds");
  await expect(notes).toHaveValue("Unsigned synthetic draft retained across task tabs");
  const tab = page.getByRole("tab", { name: "Rounds", exact: true });
  await tab.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Summary & Rx", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Summary & Rx", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab).toBeFocused();
  await expect(notes).toHaveValue("Unsigned synthetic draft retained across task tabs");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openWorkflowTab(page, "Reports");
  await expect(page.getByRole("heading", { name: "Patient chart", exact: true })).toBeVisible();
});

test("same-admission task links select their tab while preserving a receipt draft", async ({ page }) => {
  const fixture = JSON.parse(await readFile(resolve("tmp/e2e-care.json"), "utf8")) as { admissionId: string };
  await signInStaffSession(page, "BILLING");
  await page.goto(`/billing?admissionId=${fixture.admissionId}`);
  await page.getByRole("link", { name: "Open receipt work", exact: true }).click();
  const receipts = page.getByRole("tabpanel", { name: "Receipts & deposits", exact: true });
  await expect(receipts).toBeVisible();
  const reference = receipts.getByLabel("Staff reference", { exact: true });
  await reference.fill("Unsigned actual receipt draft kept across task links");
  await openWorkflowTab(page, "Charges");
  await page.getByRole("link", { name: "Open receipt work", exact: true }).click();
  await expect(receipts).toBeVisible();
  await expect(reference).toHaveValue("Unsigned actual receipt draft kept across task links");
  await receipts.getByRole("link", { name: "Review held deposit allocation", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Allocations", exact: true })).toBeVisible();
  await openWorkflowTab(page, "Receipts & deposits");
  await expect(reference).toHaveValue("Unsigned actual receipt draft kept across task links");
  await expect(page).toHaveURL(new RegExp(`admissionId=${fixture.admissionId}`));
});

test("blocked appearance storage still supports the current session and device reduced motion", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage disabled for synthetic check", "SecurityError"); } });
  });
  await signInStaffSession(page, "NURSE");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const customize = page.getByRole("dialog", { name: "Customize my view" });
  await customize.getByLabel("Soft purple", { exact: true }).check();
  await expect(customize.getByRole("status")).toContainText("Applied for this session");
  await customize.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(customize.getByLabel("Soft purple", { exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  const transition = await page.locator(".nav-item.active").evaluate(element => getComputedStyle(element).transitionDuration);
  expect(transition.split(",").every(value => parseFloat(value) <= 0.001)).toBe(true);
});
