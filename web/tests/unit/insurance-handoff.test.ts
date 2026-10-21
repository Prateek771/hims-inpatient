import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ staff: vi.fn(), workspace: vi.fn(), case: vi.fn(), worklist: vi.fn(), mvp: vi.fn() }));
vi.mock("../../src/server/access", () => ({ requireStaff: reads.staff, staffContext: () => ({}) }));
vi.mock("../../src/server/insurance/commands", () => ({ insuranceWorkspace: reads.workspace, getInsuranceCase: reads.case }));
vi.mock("../../src/server/overview", () => ({ getStaffWorklist: reads.worklist }));
vi.mock("../../src/server/mvp/workspace", () => ({ isMvpEpisode: reads.mvp }));
vi.mock("../../src/server/insurance/documents", () => ({ documentSizeLimit: () => 1000 }));
vi.mock("../../src/app/(staff)/insurance/actions", () => ({ saveInsurance: async () => ({ message: "Saved" }) }));
vi.mock("../../src/components/mvp-workspace", () => ({ MvpWorkspace: () => null }));
vi.mock("../../src/components/staff-dashboard", () => ({ StaffAlerts: () => null, WorkTimestamp: () => null }));
vi.mock("../../src/components/insurance-upload", () => ({ InsuranceUpload: () => null }));
vi.mock("../../src/components/insurance-paperwork", () => ({ InsurancePaperwork: () => null }));
vi.mock("../../src/components/hospital-timestamp", () => ({ HospitalTimestamp: () => null }));
vi.mock("../../src/components/care-forms", () => ({ CareField: () => null, CareForm: ({ children }: { children: React.ReactNode }) => React.createElement("form", null, children) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import InsurancePage from "../../src/app/(staff)/insurance/page";

const saved = { id: "case-1", admissionId: "stay-1", name: "Patient One", ipCode: "IP-1", bedLabel: "Bed 1", assignedStaffId: "desk-1", paymentRoute: "INSURED", version: 1 };
const review = {
  case: { id: "case-1", version: 1, documentSetRevision: 0, assignedStaffId: "desk-1" },
  episode: { id: "stay-1", name: "Patient One", ipCode: "IP-1", bedLabel: "Bed 1", uhid: "UHID1", status: "ADMITTED", paymentRoute: "INSURED" },
  money: { revision: 1, netPaise: 0n, insurerCashPaise: 0n, unallocatedDepositPaise: 0n, pendingPaise: 0n, unpostedRoomPaise: 0n },
  actors: {}, decisions: [], events: [], documents: [], alerts: [], pendingTransfers: [], policy: null, responsibility: null, conversion: null,
};
const render = async (query: { admissionId?: string; caseId?: string; legacy?: string } = {}) => renderToStaticMarkup(await InsurancePage({ searchParams: Promise.resolve(query) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  reads.staff.mockResolvedValue({ id: "admission-1", name: "Reception", role: "ADMISSION" });
  reads.workspace.mockResolvedValue({ rows: [saved], unassigned: [{ id: "stay-2", name: "Patient Two", ipCode: "IP-2" }, { id: "stay-3", name: "Patient Three", ipCode: "IP-3" }], staffList: [{ id: "desk-1", name: "Assigned Desk" }] });
  reads.worklist.mockResolvedValue({ episodes: [{ id: "stay-1", status: "ADMITTED" }], alerts: [] });
  reads.case.mockResolvedValue(review);
  reads.mvp.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("Insurance role handoffs", () => {
  it.each([{ admissionId: "stay-1" }, { caseId: "case-1" }])("shows Admission the saved ownership handoff without detailed case reads (%j)", async query => {
    const html = await render(query);
    expect(html).toContain("Insurance case is recorded");
    expect(html).toContain("Patient One");
    expect(html).toContain("Assigned Desk");
    expect(html).toContain('href="/patients/stay-1"');
    expect(html).not.toContain("Policy number");
    expect(html).not.toContain("Responsibility and actual money");
    expect(reads.case).not.toHaveBeenCalled();
  });

  it("keeps unknown explicit cases unavailable to Admission", async () => {
    await expect(render({ caseId: "unknown" })).rejects.toThrow("NOT_FOUND");
    expect(reads.case).not.toHaveBeenCalled();
  });

  it("shows an unassigned saved case without inventing a named owner", async () => {
    reads.workspace.mockResolvedValue({ rows: [{ ...saved, assignedStaffId: null }], unassigned: [], staffList: [] });
    const html = await render({ admissionId: "stay-1" });
    expect(html).toContain("Insurance case is recorded");
    expect(html).toContain("Awaiting Insurance assignment");
    expect(html).not.toContain("Assigned Desk");
    expect(reads.case).not.toHaveBeenCalled();
  });

  it("preselects the admission named by the intake link", async () => {
    const html = await render({ admissionId: "stay-3" });
    expect(html).toMatch(/<select name="admissionId" required="">/);
    expect(html).toContain('<option value="stay-3" selected="">Patient Three');
    expect(html).toContain('<option value="">Choose an insured admission</option>');
  });

  it("requires an explicit admission choice without intake context", async () => {
    const html = await render();
    expect(html).toContain('<option value="" selected="">Choose an insured admission</option>');
    expect(html).not.toContain('<option value="stay-2" selected="">');
  });

  it("requires a choice if intake context is no longer eligible", async () => {
    const html = await render({ admissionId: "unknown-stay" });
    expect(html).toContain('<option value="" selected="">Choose an insured admission</option>');
    expect(html).not.toContain('<option value="stay-2" selected="">');
  });

  it("links assigned Insurance from external verification to its MVP readiness check", async () => {
    reads.staff.mockResolvedValue({ id: "desk-1", name: "Assigned Desk", role: "INSURANCE" });
    const html = await render({ caseId: "case-1" });
    expect(html).toContain('href="/mvp/stay-1?tab=readiness"');
    expect(html).toContain("Review Insurance discharge check");
    expect(html).toContain("external verification");
  });

  it.each(["PENDING", "DISCHARGED", "CANCELLED"])("does not offer a readiness action for %s", async status => {
    reads.staff.mockResolvedValue({ id: "desk-1", role: "INSURANCE" });
    reads.case.mockResolvedValue({ ...review, episode: { ...review.episode, status } });
    expect(await render({ caseId: "case-1" })).not.toContain("Review Insurance discharge check");
  });

  it("does not route retained legacy cases into MVP checks", async () => {
    reads.staff.mockResolvedValue({ id: "desk-1", role: "INSURANCE" });
    reads.mvp.mockResolvedValue(false);
    expect(await render({ caseId: "case-1" })).not.toContain("Review Insurance discharge check");
  });

  it.each(["BILLING", "ADMIN"])("preserves %s detailed case and Billing routes", async role => {
    reads.staff.mockResolvedValue({ id: "finance-1", role });
    const html = await render({ caseId: "case-1" });
    expect(reads.case).toHaveBeenCalledWith({}, "case-1");
    expect(html).toContain("Responsibility and actual money");
    expect(html).toContain('href="/billing?admissionId=stay-1"');
    expect(html).not.toContain("Review Insurance discharge check");
  });
});
