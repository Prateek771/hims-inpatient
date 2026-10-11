import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useStaffSession } from "../support/browser-session";
import { openWorkflowTab } from "../support/workflow-tabs";

const fixture = async (name: string): Promise<Record<string, string>> => JSON.parse(await readFile(resolve(`tmp/e2e-${name}.json`), "utf8"));
const details = [
  { role: "DOCTOR", path: "clinical", fixture: "care", key: "admissionId" },
  { role: "NURSE", path: "nursing", fixture: "care", key: "admissionId" },
  { role: "PHARMACY", path: "pharmacy", fixture: "pharmacy", key: "admissionId" },
  { role: "LAB", path: "lab", fixture: "lab", key: "orderId" },
  { role: "INSURANCE", path: "insurance", fixture: "insurance", key: "caseId" },
  { role: "BILLING", path: "billing", fixture: "care", key: "admissionId" },
  { role: "ADMISSION", path: "patients", fixture: "care", key: "admissionId" },
  { role: "ADMIN", path: "admin/settings", fixture: null, key: "" },
  { role: "BILLING", path: "discharge", fixture: "care", key: "admissionId" },
  { role: "ADMIN", path: "exceptions", fixture: "care", key: "admissionId" },
  { role: "BILLING", path: "documents", fixture: "documents", key: "admissionId" },
] as const;

for (const detail of details) test(`${detail.role} ${detail.path} keeps every task panel reachable at 390px`, async ({ page }, info) => {
  await useStaffSession(page, detail.role);
  const id = detail.fixture ? (await fixture(detail.fixture))[detail.key] : "";
  const url = detail.path === "patients" ? `/patients/${id}` : `/${detail.path}${id ? `?${detail.key}=${id}` : ""}`;
  await page.goto(url);
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole("tab");
  const names = await tabs.allTextContents();
  expect(names.length).toBeGreaterThan(1);
  for (const name of names) {
    const panel = await openWorkflowTab(page, name.trim());
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${detail.path}: ${name}`).toBe(true);
    const scrolls = panel.locator(".table-scroll:visible");
    for (const scroll of await scrolls.all()) {
      await scroll.focus();
      await expect(scroll).toBeFocused();
      if (await scroll.evaluate(element => element.scrollWidth > element.clientWidth)) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
    }
  }
  await tabs.first().focus();
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath(`${detail.role.toLowerCase()}-${detail.path.replaceAll("/", "-")}-narrow.png`), fullPage: true });
});

test("Nurse prescribed work is unique, time-ordered and split at its published evaluation", async ({ page }) => {
  await useStaffSession(page, "NURSE");
  const evaluatedAt = await page.locator(".page-description time").getAttribute("datetime");
  const cutoff = Date.parse(evaluatedAt!);
  expect(Number.isFinite(cutoff)).toBe(true);
  const due = page.locator(".nursing-task-due [data-testid=shift-prescribed-task]");
  const next = page.locator(".nursing-task-next [data-testid=shift-prescribed-task]");
  expect(await due.count()).toBeGreaterThan(0);
  expect(await next.count()).toBeGreaterThan(0);
  const hrefs: string[] = [];
  for (const [cards, isDue] of [[due, true], [next, false]] as const) {
    const dates = await cards.evaluateAll(elements => elements.map(element => Date.parse(element.getAttribute("data-scheduled-at")!)));
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(dates.every(date => isDue ? date <= cutoff : date > cutoff)).toBe(true);
    hrefs.push(...await cards.getByRole("link", { name: "Open care task", exact: true }).evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).getAttribute("href")!)));
  }
  expect(new Set(hrefs).size).toBe(hrefs.length);
  const link = due.first().getByRole("link", { name: "Open care task", exact: true });
  const destination = new URL((await link.getAttribute("href"))!, page.url());
  const tab = destination.searchParams.get("tab") === "medicines" ? "Medicines" : "Observations";
  await link.click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(destination.hash)).toBeVisible();
});

test("original receipt links repeatedly open and scroll their exact retained source", async ({ page }) => {
  const journey = JSON.parse(await readFile(resolve("tmp/e2e-journey.json"), "utf8")) as { insured: { admissionId: string } };
  await useStaffSession(page, "BILLING");
  await page.goto(`/billing?admissionId=${journey.insured.admissionId}&tab=history`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const allocations = await openWorkflowTab(page, "Allocations");
    const link = allocations.locator("a[data-workflow-tab=history]").first();
    const hash = new URL((await link.getAttribute("href"))!, page.url()).hash;
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "History", exact: true })).toBeFocused();
    await expect(page.locator(hash)).toBeInViewport();
  }
});
