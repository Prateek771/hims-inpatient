import { test, expect } from "@playwright/test";
import { useStaffSession } from "../support/browser-session";
import { submitServerAction } from "../support/server-action";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
test("Admin/Billing can open the final-copy delivery workspace", async ({ page }) => {
  await useStaffSession(page, "BILLING"); await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Final documents", level: 1 })).toBeVisible();
});
test("downloads the actual authenticated server PDF and separately uses native HTML printing", async ({ page, browser }, info) => {
  // Real PDF generation/download, native print and protected access across contexts.
  test.setTimeout(60_000);
  const f = JSON.parse(await readFile(resolve("tmp/e2e-documents.json"), "utf8")) as { admissionId: string };
  await useStaffSession(page, "BILLING"); await page.goto(`/documents?admissionId=${f.admissionId}`);
  await submitServerAction(page, page.getByRole("button", { name: "Generate current discharge copy" }));
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/, { waitUntil: "load" });
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("final-copy")).toContainText("Pneumonia José - सावधानी");
  await expect(page.getByTestId("final-copy")).toContainText("Insurer authorization (not money received)");
  await expect(page.getByTestId("document-verification-footer")).toContainText("Revision 1");
  await expect(page.getByTestId("document-qr")).toBeVisible();
  const receipt = page.locator("tbody tr").filter({ hasText: "Actual PATIENT PAYMENT receipt" });
  expect(await receipt.textContent()).toContain("x\n".repeat(90) + "END");
  expect(await receipt.locator("td").first().evaluate(el => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
  await expect(page.getByTestId("final-copy")).toContainText("W".repeat(1100) + "END");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download verified PDF" }).click()]);
  await mkdir(resolve("../tmp/task13"), { recursive: true });
  await download.saveAs(resolve("../tmp/task13/server-download.pdf"));
  const bytes = await readFile(resolve("../tmp/task13/server-download.pdf")); expect(bytes.subarray(0,5).toString()).toBe("%PDF-");
  const http = await page.request.get(`/api/documents/${id}/pdf`); expect(http.status()).toBe(200); expect(http.headers()["cache-control"]).toContain("no-store"); expect(http.headers()["x-content-type-options"]).toBe("nosniff"); expect(await http.body()).toEqual(bytes);
  await page.screenshot({ path: info.outputPath("documents-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("documents-narrow.png"), fullPage: true });
  await page.goto(`/documents/${id}/print`);
  await expect(page.getByText("For reliable extracted or copied Hindi text, use Download verified PDF.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download verified PDF" })).toHaveAttribute("href", `/api/documents/${id}/pdf`);
  let prints = 0; await page.exposeFunction("recordNativePrint", () => { prints++; });
  await page.evaluate(() => { window.print = () => { void (window as unknown as { recordNativePrint: () => void }).recordNativePrint(); }; });
  await page.getByRole("button", { name: "Print / save discharge copy" }).click(); await expect.poll(() => prints).toBe(1);
  await page.emulateMedia({ media: "print" }); await expect(page.getByTestId("final-copy")).toContainText("आराम करें");
  await page.evaluate(() => document.fonts.ready);
  // Print-only native margin boxes reserve room on every page. The ordinary
  // HTML footer remains in the screen copy and is hidden from printed flow.
  expect(await page.locator("body").evaluate(el => getComputedStyle(el).page)).toBe("discharge");
  expect(await page.getByTestId("document-verification-footer").evaluate(el => getComputedStyle(el).display)).toBe("none");
  expect(await page.locator(".sidebar").evaluate(el => getComputedStyle(el).display)).toBe("none");
  await page.pdf({ path: resolve("../tmp/task13/browser-print.pdf"), format: "A4", printBackground: true });
  await page.screenshot({ path: info.outputPath("document-print-footer.png"), fullPage: true });
  await page.goto(`/documents/${id}/verify`); await expect(page.getByRole("heading", { name: "Document verification" })).toBeVisible();
  const verifyText = await page.locator("main").innerText(); expect(verifyText).not.toMatch(/Pneumonia|José|Patient|Amount|Synthetic E2E hospital/);
  expect(verifyText).toContain(createHash("sha256").update(bytes).digest("hex"));
  const qrText = await page.getByTestId("verification-reference").innerText(); expect(qrText).toContain(id);
  const fresh = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const anonymous = await fresh.request.get(`/api/documents/${id}/pdf`); expect(anonymous.status()).toBe(401); await fresh.close();
  await useStaffSession(page, "DOCTOR"); expect((await page.request.get(`/api/documents/${id}/pdf`)).status()).toBe(403); expect((await page.request.get(`/documents/${id}/verify`)).status()).toBe(404);
  await writeFile(resolve("../tmp/task13/server-download.json"), JSON.stringify({ documentId: id, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }, null, 2));
});
