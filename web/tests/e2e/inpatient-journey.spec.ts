import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { useStaffSession } from "../support/browser-session";
type Journey = { admissionId: string; originalDocumentId: string; amendedDocumentId: string; transferredAt: string; vacatedAt: string; departedAt: string; netPaise: string; patientRefundPaise: string };
type Fixture = { selfPay: Journey; insured: Journey; exceptional: { admissionId: string; documentId: string; outstandingPaise: string }; recovery: { caseId: string; documentId: string; runId: string } };
async function fixture(): Promise<Fixture> { return JSON.parse(await readFile(resolve("tmp/e2e-journey.json"), "utf8")); }

for (const route of ["selfPay", "insured"] as const) test(`complete ${route} journey retains original cash, transfers, human seals and amended protected copy`, async ({ page }, info) => {
  const f = (await fixture())[route], external: string[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") external.push(url.origin); });
  await useStaffSession(page, "BILLING");
  await page.goto(`/documents/${f.originalDocumentId}`);
  const copy = page.getByTestId("final-copy");
  await expect(copy).toContainText("Whole-journey original signed findings");
  await expect(copy).toContainText("Whole-journey signed correction retains original findings");
  await expect(copy).not.toContainText("Whole-journey attributable post-discharge addendum");
  await expect(copy).toContainText(f.transferredAt); await expect(copy).toContainText(f.vacatedAt); await expect(copy).toContainText(f.departedAt);
  for (const role of ["DOCTOR", "PHARMACY", "NURSING", "BILLING"]) await expect(copy).toContainText(`${role}: recorded human clearance`);
  await expect(copy).toContainText("₹3,180.00");
  const original = await page.request.get(`/api/documents/${f.originalDocumentId}/pdf`); expect(original.status()).toBe(200);
  const originalBytes = await original.body(), originalHash = createHash("sha256").update(originalBytes).digest("hex");
  await page.goto(`/documents/${f.amendedDocumentId}`);
  await expect(copy).toContainText("Whole-journey attributable post-discharge addendum");
  await expect(page.getByTestId("document-verification-footer")).toContainText("Revision 2");
  await expect(copy).toContainText("Allocation applies cash already received");
  await expect(copy).toContainText("Actual refund of receipt");
  if (route === "insured") { await expect(copy).toContainText("Actual INSURER PAYMENT receipt"); await expect(copy).toContainText("₹2,700.00"); }
  const amended = await page.request.get(`/api/documents/${f.amendedDocumentId}/pdf`); expect(amended.status()).toBe(200); expect(amended.headers()["cache-control"]).toContain("no-store");
  expect(createHash("sha256").update(await amended.body()).digest("hex")).not.toBe(originalHash);
  expect(await (await page.request.get(`/api/documents/${f.originalDocumentId}/pdf`)).body()).toEqual(originalBytes);
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(`journey-${route}-amended.png`), fullPage: true });
  await page.goto(`/documents/${f.amendedDocumentId}/verify`); const verification = await page.locator("main").innerText();
  expect(verification).not.toMatch(/Whole-journey human diagnosis|3180|Synthetic whole journey/);
  expect(external).toEqual([]);
  await useStaffSession(page, "LAB"); expect((await page.request.get(`/api/documents/${f.amendedDocumentId}/pdf`)).status()).toBe(403);
  await page.context().clearCookies(); expect((await page.request.get(`/api/documents/${f.originalDocumentId}/pdf`)).status()).toBe(401);
});
test("exceptional exit keeps debt and missing professional seals visible in the delivered copy", async ({ page }, info) => {
  const f = (await fixture()).exceptional; expect(BigInt(f.outstandingPaise)).toBeGreaterThan(0n);
  await useStaffSession(page, "BILLING"); await page.goto(`/documents/${f.documentId}`);
  const copy = page.getByTestId("final-copy"); await expect(copy).toContainText("UNREVIEWED_EARLY_EXIT");
  for (const role of ["DOCTOR", "PHARMACY", "NURSING", "BILLING"]) await expect(copy).toContainText(`${role}: no recorded human clearance`);
  await expect(copy).toContainText(/outstanding obligations remain/i);
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath("journey-exception-debt.png"), fullPage: true });
});
test("manual recovery source remains private and the genuine retained run waits for human review", async ({ page }) => {
  const f = (await fixture()).recovery, file = `/api/insurance/cases/${f.caseId}/documents?documentId=${f.documentId}`;
  await useStaffSession(page, "INSURANCE"); const downloaded = await page.request.get(file); expect(downloaded.status()).toBe(200);
  expect((await downloaded.body()).toString()).toContain("Synthetic recovery protected case text");
  expect(downloaded.headers()["content-security-policy"]).toContain("sandbox"); expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff");
  const run = await page.request.get(`/api/insurance/cases/${f.caseId}/paperwork?runId=${f.runId}`); expect(run.status()).toBe(200); expect((await run.json()).status).toBe("AWAITING_REVIEW");
  expect((await page.request.get(`/private-uploads/insurance/${f.documentId}.bin`)).status()).toBe(404);
  await useStaffSession(page, "NURSE"); expect((await page.request.get(file)).status()).toBe(403);
  await page.context().clearCookies(); expect((await page.request.get(file)).status()).toBe(401);
});
