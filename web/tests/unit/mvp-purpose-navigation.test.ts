import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ staff: vi.fn(), episode: vi.fn(), identity: vi.fn(), bill: vi.fn(), nursing: vi.fn(), documents: vi.fn(), documentReview: vi.fn(), isMvp: vi.fn() }));
vi.mock("../../src/server/access", () => ({ requireStaff: reads.staff, staffContext: () => ({}) }));
vi.mock("../../src/server/mvp/workspace", () => ({ getMvpIdentity: reads.identity, isMvpEpisode: reads.isMvp }));
vi.mock("../../src/server/mvp/commands", () => ({ getMvpEpisode: reads.episode }));
vi.mock("../../src/server/billing/commands", () => ({ getBill: reads.bill }));
vi.mock("../../src/app/(staff)/nursing/actions", () => ({ saveNursing: reads.nursing }));
vi.mock("../../src/app/(staff)/mvp/[admissionId]/actions", () => ({ saveMvpAction: vi.fn() }));
vi.mock("../../src/app/(staff)/billing/actions", () => ({ saveAllocation: vi.fn(), saveManualReceipt: vi.fn(), saveReversal: vi.fn(), startAdmission: vi.fn(), postRoomThroughNow: vi.fn() }));
vi.mock("../../src/components/mvp-transfers", () => ({ MvpTransfers: () => null }));
vi.mock("../../src/components/mvp-exceptions", () => ({ MvpExceptions: () => null }));
vi.mock("../../src/components/mvp-financial-corrections", () => ({ MvpFinancialCorrections: () => null }));
vi.mock("../../src/server/documents/commands", () => ({ documentWorkspace: reads.documents, getDischargeDocumentReview: reads.documentReview }));
vi.mock("../../src/app/(staff)/documents/actions", () => ({ createDocumentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (href: string) => { throw Error(`REDIRECT:${href}`); } }));

import MvpEpisodePage from "../../src/app/(staff)/mvp/[admissionId]/page";
import DocumentsPage from "../../src/app/(staff)/documents/page";
import { MvpSummary } from "../../src/components/mvp-summary";
import type { MvpQueueRow, MvpReview } from "../../src/server/mvp/workspace";
import { purposeRows } from "../../src/lib/mvp-workspace-purpose";

const identity = { id: "episode", name: "Demo Person", uhid: "DP1234567", ipCode: "IP-TEST", bedLabel: "General 1", status: "ADMITTED", nurseName: "Assigned Nurse", action: "Review patient coordination", detail: "Await external Doctor instruction" } as MvpQueueRow;
const review = () => ({ episode: { status: "ADMITTED", billRevision: 1 }, reviewHash: "review", shifts: [], checks: [], medicine: [], deliveries: [], documents: [], blockers: [], serviceItems: [], serviceSources: [], clinical: null, checklist: null, finance: null, vacancy: null, departure: null, exceptionalDeparture: null });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  reads.staff.mockResolvedValue({ id: "nurse", role: "NURSE" });
  reads.episode.mockResolvedValue(review());
  reads.identity.mockResolvedValue({ identity, workspace: { medicinePrices: [] } });
  reads.bill.mockResolvedValue({ charges: [], receipts: [], activeAllocations: [], reversals: [] });
  reads.documents.mockResolvedValue([]);
  reads.isMvp.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllGlobals());
const episode = (tab?: string) => MvpEpisodePage({ params: Promise.resolve({ admissionId: "episode" }), searchParams: Promise.resolve({ tab }) });
const renderEpisode = async (tab?: string) => renderToStaticMarkup(await episode(tab));
const panel = (html: string, tab: string) => html.match(new RegExp(`<div[^>]*id="mvp-episode-panel-${tab}"[^>]*>`))?.[0];

describe("purpose-specific episode entry", () => {
  it.each(["BILLING", "PHARMACY"])("opens %s on its money work", async role => {
    reads.staff.mockResolvedValue({ id: "staff", role });
    const html = await renderEpisode();
    expect(panel(html, "money")).not.toContain("hidden");
    expect(panel(html, "readiness")).toContain("hidden");
  });
  it("keeps explicit section links and the Admission return destination", async () => {
    reads.staff.mockResolvedValue({ id: "staff", role: "ADMISSION" });
    const html = await renderEpisode("transfer");
    expect(html).toContain('href="/admissions">Back to patient queue');
    expect(panel(html, "transfer")).not.toContain("hidden");
  });
  it("omits a non-operational money tab for the assigned Nurse", async () => {
    const html = await renderEpisode();
    expect(panel(html, "readiness")).not.toContain("hidden");
    expect(html).not.toContain('id="mvp-episode-tab-money"');
  });
  it("takes Insurance staff directly to their own check and case evidence", async () => {
    reads.staff.mockResolvedValue({ id: "staff", role: "INSURANCE" });
    reads.identity.mockResolvedValue({ identity: { ...identity, caseId: "case" }, workspace: { medicinePrices: [] } });
    const html = await renderEpisode();
    expect(panel(html, "readiness")).not.toContain("hidden");
    expect(html).toContain('href="/insurance?caseId=case"');
    expect(html).not.toContain('id="mvp-episode-tab-money"');
  });
  it("keeps the exact authorized closed insurance correction target usable", async () => {
    reads.staff.mockResolvedValue({ id: "staff", role: "INSURANCE" });
    const [row] = purposeRows([{ ...identity, status: "DISCHARGED", insuranceCorrection: true }], "exceptions", "INSURANCE");
    expect(row.href).toBe("/mvp/episode?tab=money");
    reads.episode.mockResolvedValue({ ...review(), episode: { status: "DISCHARGED", billRevision: 1 } });
    const html = await renderEpisode(new URL(row.href, "http://localhost").searchParams.get("tab")!);
    expect(panel(html, "money")).toBeDefined();
    expect(panel(html, "money")).not.toContain("hidden");
    expect(html).toContain("Authorized insurance corrections");
    expect(html).not.toContain("Record actual payment or deposit");
  });
  it.each(["ADMITTED", "PENDING"])("keeps the monetary operations tab hidden from Insurance on %s", async status => {
    reads.staff.mockResolvedValue({ id: "staff", role: "INSURANCE" });
    reads.episode.mockResolvedValue({ ...review(), episode: { status, billRevision: 1 } });
    expect(await renderEpisode("money")).not.toContain('id="mvp-episode-tab-money"');
  });
});

// Find the real CareForm element before rendering so the existing action binding can be exercised.
function formElement(node: unknown, testId: string): React.ReactElement<{ action: (...args: unknown[]) => unknown }> | undefined {
  if (Array.isArray(node)) return node.map(child => formElement(child, testId)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { testId?: string; children?: unknown; items?: { children: unknown }[]; beforeTabs?: unknown };
  if (props.testId === testId) return node as React.ReactElement<{ action: (...args: unknown[]) => unknown }>;
  return formElement(props.children, testId) ?? formElement(props.items?.map(item => item.children), testId) ?? formElement(props.beforeTabs, testId);
}

describe("assigned Nurse attendance handover", () => {
  it.each(["ADMITTED", "DISCHARGED"])("can close an own open care shift on %s using the existing action", async status => {
    reads.episode.mockResolvedValue({ ...review(), episode: { status, billRevision: 1 }, shifts: [{ id: "own-shift", nurse_id: "nurse", started_at: "2026-10-19T02:00:00Z", ended_at: null }, { id: "other-shift", nurse_id: "other", started_at: "2026-10-19T02:00:00Z", ended_at: null }] });
    const tree = await episode();
    const form = formElement(tree, "mvp-shift-end");
    expect(form).toBeDefined();
    const data = new FormData();
    await form!.props.action(undefined, data);
    expect(reads.nursing).toHaveBeenCalledWith("episode", expect.any(String), "end", "", "own-shift", "", undefined, data);
  });
  it("does not expose another Nurse's attendance or a closed shift for editing", async () => {
    reads.episode.mockResolvedValue({ ...review(), shifts: [{ id: "ended", nurse_id: "nurse", ended_at: "2026-10-19T03:00:00Z" }, { id: "other", nurse_id: "other", ended_at: null }] });
    expect(formElement(await episode(), "mvp-shift-end")).toBeUndefined();
  });
});

describe("patient medicine sources", () => {
  it("shows original item prices, accepted credits and remaining return quantity", async () => {
    reads.staff.mockResolvedValue({ id: "pharmacy", role: "PHARMACY" });
    reads.episode.mockResolvedValue({ ...review(), medicine: [
      { id: "charge-source", kind: "CHARGE", chargeId: "charge", reference: "MED-1", quantity: "5", itemName: "Demo tablets", unit: "tablet", originalQuantity: "5", returnedQuantity: "2", remainingQuantity: "3", unitPricePaise: "1000", amountPaise: "5000", creditedPaise: "2000", recordedAt: "2026-10-19T02:00:00Z" },
      { id: "return-source", kind: "RETURN", chargeId: "charge", reference: "RET-1", quantity: "2", itemName: "Demo tablets", unit: "tablet", originalQuantity: "5", returnedQuantity: "2", remainingQuantity: "3", unitPricePaise: "1000", amountPaise: "2000", creditedPaise: "2000", recordedAt: "2026-10-19T03:00:00Z" },
      { id: "fully-returned", kind: "CHARGE", chargeId: "returned-charge", reference: "MED-2", quantity: "1", itemName: "Returned syrup", unit: "bottle", originalQuantity: "1", returnedQuantity: "1", remainingQuantity: "0", unitPricePaise: "500", amountPaise: "500", creditedPaise: "500", recordedAt: "2026-10-19T02:00:00Z" },
    ] });
    const html = await renderEpisode();
    expect(html).toContain("Demo tablets");
    expect(html).toContain("3 tablet available to return");
    expect(html).toContain("Accepted return credit");
    expect(html).toContain("₹20.00");
    expect(html).not.toContain('value="returned-charge"');
    expect(html).toContain("Return credit does not record a cash refund");
  });
});

describe("retained papers and departure evidence", () => {
  const summary = (data: object) => renderToStaticMarkup(React.createElement(MvpSummary, { identity, review: { ...review(), ...data } as unknown as MvpReview, showMoney: false }));
  it("retains final paper delivery after later money changes clear current finance", () => {
    const html = summary({ departure: { mvpFinanceId: "finance-original" }, documents: [{ id: "final-doc", kind: "FINAL", version: 2 }], deliveries: [{ id: "delivery", payload: { kind: "FINAL", financeId: "finance-original", documentId: "final-doc" } }] });
    expect(html).toContain("final papers delivered");
    expect(html).not.toContain("final papers pending");
    expect(html).toContain('href="/documents/final-doc"');
  });
  it("does not infer delivered papers from exceptional departure alone", () => {
    const html = summary({ exceptionalDeparture: { id: "exceptional-exit" } });
    expect(html).not.toContain("final papers delivered");
    expect(html).toContain("delivery not recorded");
  });
  it("does not mistake delivery of a clinical copy for final paper delivery", () => {
    const html = summary({ departure: { mvpFinanceId: "finance-original" }, documents: [{ id: "clinical-doc", kind: "CLINICAL" }], deliveries: [{ id: "delivery", payload: { kind: "CLINICAL", documentId: "clinical-doc" } }] });
    expect(html).not.toContain("final papers delivered");
  });
  it("recognizes exceptional exact delivery only for the recorded departure authority", () => {
    const html = summary({ exceptionalDeparture: { authorityId: "authority" }, documents: [{ id: "final-doc", kind: "FINAL" }], exceptions: [{ action: "DELIVERY", sourceId: "authority", payload: { documentId: "final-doc" } }] });
    expect(html).toContain("final papers delivered");
    expect(html).toContain('href="/documents/final-doc"');
    const unrelated = summary({ departure: { mvpFinanceId: "current-finance" }, documents: [{ id: "old-doc", kind: "FINAL" }], deliveries: [{ payload: { kind: "FINAL", financeId: "old-finance", documentId: "old-doc" } }] });
    expect(unrelated).not.toContain("final papers delivered");
  });
});

describe("closed episode status for roles without paper evidence", () => {
  it.each(["PHARMACY", "INSURANCE", "ADMISSION"].flatMap(role => ["ordinary", "exceptional"].map(kind => [role, kind])))("does not infer missing papers or pending exit for %s after %s closure", async (role, kind) => {
    reads.staff.mockResolvedValue({ id: "staff", role });
    reads.episode.mockResolvedValue({ ...review(), episode: { status: "DISCHARGED", billRevision: 3 }, departure: kind === "ordinary" ? { mvpFinanceId: "finance-original" } : null, exceptionalDeparture: null });
    const html = await renderEpisode();
    expect(html).toContain("Episode closed");
    expect(html).not.toContain("delivery not recorded");
    expect(html).not.toContain("Actual hospital exit not yet recorded");
    expect(html).not.toContain("Final finance:");
    expect(html).not.toContain("final papers");
  });
});

describe("MVP documents route", () => {
  it("routes an exact MVP admission to its retained paper surface before legacy source loading", async () => {
    reads.staff.mockResolvedValue({ id: "billing", role: "BILLING" });
    reads.isMvp.mockResolvedValue(true);
    await expect(DocumentsPage({ searchParams: Promise.resolve({ admissionId: "episode" }) })).rejects.toThrow("REDIRECT:/mvp/episode?tab=exit");
    expect(reads.documentReview).not.toHaveBeenCalled();
  });
  it("lists MVP paper links beside legacy review links without asserting a four-seal MVP chain", async () => {
    reads.staff.mockResolvedValue({ id: "billing", role: "BILLING" });
    reads.documents.mockResolvedValue([{ id: "mvp", ipCode: "IP-MVP", workflowVersion: 2 }, { id: "old", ipCode: "IP-OLD", workflowVersion: 1 }]);
    reads.isMvp.mockImplementation(async (id: string) => id === "mvp");
    const html = renderToStaticMarkup(await DocumentsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/mvp/mvp?tab=exit"');
    expect(html).toContain('href="/documents?admissionId=old"');
    expect(html).not.toContain("A final copy follows actual hospital departure");
  });
});
