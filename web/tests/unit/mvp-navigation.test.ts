import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MvpQueueRow } from "../../src/server/mvp/workspace";

const reads = vi.hoisted(() => ({ staff: vi.fn(), workspace: vi.fn(), identity: vi.fn(), episode: vi.fn(), bill: vi.fn() }));
vi.mock("../../src/server/access", () => ({ requireStaff: reads.staff, staffContext: () => ({}) }));
vi.mock("../../src/server/mvp/workspace", () => ({ getMvpWorkspace: reads.workspace, getMvpIdentity: reads.identity }));
vi.mock("../../src/server/mvp/commands", () => ({ getMvpEpisode: reads.episode }));
vi.mock("../../src/server/billing/commands", () => ({ getBill: reads.bill }));
vi.mock("../../src/app/(staff)/nursing/actions", () => ({ saveNursing: async () => ({ message: "" }) }));
vi.mock("../../src/app/(staff)/mvp/[admissionId]/actions", () => ({ saveMvpAction: async () => ({ message: "" }) }));
vi.mock("../../src/app/(staff)/billing/actions", () => ({ saveAllocation: vi.fn(), saveManualReceipt: vi.fn(), saveReversal: vi.fn(), startAdmission: vi.fn(), postRoomThroughNow: vi.fn() }));
// These nested server components read separate workflows, outside this navigation contract.
vi.mock("../../src/components/mvp-transfers", () => ({ MvpTransfers: () => null }));
vi.mock("../../src/components/mvp-exceptions", () => ({ MvpExceptions: () => null }));
vi.mock("../../src/components/mvp-financial-corrections", () => ({ MvpFinancialCorrections: () => null }));

import { MvpWorkspace } from "../../src/components/mvp-workspace";
import MvpEpisodePage from "../../src/app/(staff)/mvp/[admissionId]/page";

const row = (id: string, status = "ADMITTED", needsAction = false): MvpQueueRow => ({
  id, name: `Patient ${id}`, uhid: `UHID-${id}`, ipCode: `IP-${id}`, status, needsAction,
  bedLabel: `Bed ${id}`, billRevision: 1, vacant: false, caseId: null, nurseName: "Assigned Nurse",
  insuranceOwner: null, registeredBy: "Admission", stage: "Inpatient care", action: "Review patient coordination",
  detail: "Await external Doctor instruction", owner: "Assigned Nurse", ownerRole: "Nurse",
});
const routine = row("routine"), attention = row("attention", "ADMITTED", true), pending = row("pending", "PENDING", true), historical = row("historical", "DISCHARGED");

beforeEach(() => {
  vi.resetAllMocks();
  // Vite preserves this project's JSX for the classic React transform.
  vi.stubGlobal("React", React);
  reads.staff.mockResolvedValue({ id: "nurse-1", role: "ADMIN" });
  reads.workspace.mockResolvedValue({ episodes: [routine, attention, pending, historical], medicinePrices: [], asOf: "2026-10-18T06:00:00Z", metrics: { current: 3, needsAction: 2, preparing: 0, available: 1, totalBeds: 4, occupied: 2, held: 1, cleaning: 0 } });
  reads.episode.mockResolvedValue({ episode: { status: "ADMITTED", billRevision: 1 }, reviewHash: "review", shifts: [], checks: [], medicine: [], deliveries: [], documents: [], blockers: [], serviceItems: [], serviceSources: [], clinical: null, checklist: null, finance: null, vacancy: null, departure: null, exceptionalDeparture: null });
  reads.identity.mockResolvedValue({ identity: routine, workspace: { medicinePrices: [] } });
  reads.bill.mockResolvedValue({ charges: [], receipts: [], activeAllocations: [], reversals: [] });
});
afterEach(() => vi.unstubAllGlobals());

const queue = (html: string) => html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
const renderWorkspace = async (filters = {}) => renderToStaticMarkup(await MvpWorkspace({ filters }));
const renderEpisode = async () => renderToStaticMarkup(await MvpEpisodePage({ params: Promise.resolve({ admissionId: "routine" }), searchParams: Promise.resolve({}) }));

describe("patient queue navigation", () => {
  it("opens Admin on all current patients, with bed labels and matching search/selection links", async () => {
    const html = await renderWorkspace();
    expect(queue(html)).toContain("Patient routine");
    expect(queue(html)).toContain("Patient attention");
    expect(queue(html)).toContain("Patient pending");
    expect(queue(html)).not.toContain("Patient historical");
    expect(queue(html)).toContain("Bed routine");
    expect(html).toContain('name="view" value="all"');
    expect(queue(html)).toContain('href="/overview?view=all&amp;selected=routine"');
    expect(html).not.toContain("View admissions");
    expect(html).not.toContain("View all patients");
  });

  it("keeps explicit needs-action, history and search filters", async () => {
    const action = queue(await renderWorkspace({ view: "action" }));
    expect(action).toContain("Patient attention");
    expect(action).not.toContain("Patient routine");
    const history = queue(await renderWorkspace({ view: "history" }));
    expect(history).toContain("Patient historical");
    expect(history).not.toContain("Patient attention");
    const search = queue(await renderWorkspace({ q: "UHID-routine" }));
    expect(search).toContain("Patient routine");
    expect(search).not.toContain("Patient attention");
  });

  it.each(["NURSE", "INSURANCE", "PHARMACY", "BILLING", "ADMISSION"])("keeps %s within the server-scoped source and uses its own section", async role => {
    reads.staff.mockResolvedValue({ id: "staff-1", role });
    const scoped = { ...attention, caseId: "assigned-case", insuranceOwner: "Assigned Insurance" };
    reads.workspace.mockResolvedValue({ ...(await reads.workspace()), episodes: [scoped] });
    const html = await renderWorkspace();
    expect(queue(html)).toContain("Patient attention");
    expect(queue(html)).not.toContain("Patient routine");
    expect(html).toContain(`name="view" value="${role === "ADMISSION" ? "action" : "all"}"`);
    if (role === "ADMISSION") expect(html).toContain('href="/admissions?view=intake"');
    const all = queue(await renderWorkspace({ view: "all" }));
    expect(all).toContain("Patient attention");
    expect(all).not.toContain("Patient routine");
  });
});

describe("Nurse episode shortcuts", () => {
  it("opens transfer and discharge readiness within retained workflow panels", async () => {
    reads.staff.mockResolvedValue({ id: "nurse-1", role: "NURSE" });
    const html = await renderEpisode();
    const tabs = html.slice(html.indexOf('class="workflow-tabs"'), html.indexOf('role="tablist"'));
    expect(tabs).toContain('data-workflow-tab="transfer"');
    expect(tabs).toMatch(/href="\/mvp\/routine\?tab=transfer"[^>]*>Shift patient<\/a>/);
    expect(tabs).toContain('data-workflow-tab="readiness"');
    expect(tabs).toMatch(/href="\/mvp\/routine\?tab=readiness"[^>]*>Start discharge<\/a>/);
    expect(tabs).not.toContain('data-workflow-tab="exit"');
  });

  it.each(["PENDING", "DISCHARGED", "CANCELLED"])("hides shortcuts on a %s episode", async status => {
    reads.staff.mockResolvedValue({ id: "nurse-1", role: "NURSE" });
    reads.episode.mockResolvedValue({ ...(await reads.episode()), episode: { status, billRevision: 1 } });
    const html = await renderEpisode();
    expect(html).not.toContain(">Shift patient</a>");
    expect(html).not.toContain(">Start discharge</a>");
  });

  it.each(["ADMIN", "ADMISSION", "PHARMACY", "BILLING", "INSURANCE"])("hides Nurse shortcuts for %s", async role => {
    reads.staff.mockResolvedValue({ id: "staff-1", role });
    const html = await renderEpisode();
    expect(html).not.toContain(">Shift patient</a>");
    expect(html).not.toContain(">Start discharge</a>");
  });
});
