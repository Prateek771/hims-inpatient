import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MvpQueueRow } from "../../src/server/mvp/workspace";
const reads = vi.hoisted(() => ({ staff: vi.fn(), workspace: vi.fn(), episode: vi.fn() }));
vi.mock("../../src/server/access", () => ({ requireStaff: reads.staff, staffContext: () => ({}) }));
vi.mock("../../src/server/mvp/workspace", () => ({ getMvpWorkspace: reads.workspace }));
vi.mock("../../src/server/mvp/commands", () => ({ getMvpEpisode: reads.episode }));
import { MvpWorkspace } from "../../src/components/mvp-workspace";
import { purposeRows, workspacePurpose } from "../../src/lib/mvp-workspace-purpose";
const row = (id: string, extra: Partial<MvpQueueRow> = {}): MvpQueueRow => ({ id, name: `Patient ${id}`, uhid: `U-${id}`, ipCode: `IP-${id}`, status: "ADMITTED", billRevision: 1, vacant: false, caseId: null, bedLabel: `Configured ${id}`, nurseName: "Nurse Uma", insuranceOwner: "Insurance Dev", registeredBy: "Reception", stage: "Inpatient care", action: "Review patient coordination", detail: "Await external Doctor instruction", owner: "Nurse Uma", ownerRole: "Assigned Nurse", needsAction: false, ...extra });
const routine = row("routine"), preparation = row("preparing", { stage: "Checks running", needsAction: true, coordination: { clinical: true, checklist: true, pendingChecks: ["PHARMACY"], finance: false, finalDelivered: false, exception: false } }), insured = row("insured", { caseId: "case-insured" }), pending = row("pending", { status: "PENDING", needsAction: true, caseId: "case-pending" }), exception = row("exception", { coordination: { clinical: false, checklist: false, pendingChecks: [], finance: false, finalDelivered: false, exception: true } }), historical = row("historical", { status: "DISCHARGED", caseId: "case-history" });
beforeEach(() => { vi.stubGlobal("React", React); reads.staff.mockResolvedValue({ id: "staff", role: "ADMIN" }); reads.workspace.mockResolvedValue({ episodes: [routine, preparation, insured, pending, exception, historical], asOf: "2026-10-19T06:00:00Z", metrics: { available: 2, totalBeds: 6, occupied: 3, held: 1, cleaning: 0 } }); reads.episode.mockResolvedValue({ episode: { status: "ADMITTED" }, checks: [{ check: "PHARMACY", current: false }], medicine: [], documents: [], deliveries: [], exceptions: [], bill: { netPaise: "230000" }, financial: { responsibility: { patientOutstandingPaise: "30000" } } }); });
const render = async (surface?: "payments" | "medicine" | "discharge" | "insurance" | "exceptions", filters = { view: "all" }) => renderToStaticMarkup(await MvpWorkspace({ surface, filters }));
const queue = (html: string) => html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
describe("purpose-specific staff workspaces", () => {
  it("normalizes every current role and lets an explicit section override it", () => {
    expect(["ADMIN", "ADMISSION", "NURSE", "BILLING", "PHARMACY", "INSURANCE"].map(role => workspacePurpose(role as Parameters<typeof workspacePurpose>[0]))).toEqual(["patients", "admission", "nursing", "payments", "medicine", "insurance"]);
    expect(workspacePurpose("ADMIN", "medicine")).toBe("medicine");
  });
  it("does not send Billing pending patients to forbidden intake pages or give Nursing Pharmacy's task", () => {
    expect(purposeRows([pending], "payments", "BILLING")[0].href).toBe("/mvp/pending?tab=money");
    const nursing = purposeRows([{ ...preparation, action: "Review pharmacy check", ownerRole: "PHARMACY" }], "discharge", "NURSE")[0];
    expect(nursing.needsAction).toBe(false);
    expect(nursing.action).toBe("Review discharge handoff & waiting care");
    expect(nursing.href).toBe("/mvp/preparing?tab=readiness");
  });
  it("keeps routine assigned Nursing patients visible before any discharge instruction", async () => {
    reads.staff.mockResolvedValue({ id: "nurse", role: "NURSE" });
    const html = renderToStaticMarkup(await MvpWorkspace({}));
    expect(queue(html)).toContain("Patient routine");
    expect(queue(html)).not.toContain("Patient pending");
  });
  it("labels Insurance action filtering as readiness only and retains actionable post-exit corrections", async () => {
    reads.staff.mockResolvedValue({ id: "insurance", role: "INSURANCE" });
    const cases = await render("insurance");
    expect(cases).toContain("Readiness checks ·");
    const corrected = { ...historical, insuranceCorrection: true };
    reads.workspace.mockResolvedValue({ ...(await reads.workspace()), episodes: [corrected, exception] });
    const corrections = await render("exceptions", { view: "action" });
    expect(queue(corrections)).toContain("Patient historical");
    expect(queue(corrections)).toContain("/mvp/historical?tab=money");
    expect(queue(corrections)).not.toContain("Patient exception");
    expect(purposeRows([exception], "exceptions", "PHARMACY")).toEqual([]);
  });
  it.each(["INSURANCE", "ADMIN", "BILLING"])("keeps unresolved closed correction in %s exception work without calling it a current inpatient", async role => {
    reads.staff.mockResolvedValue({ id: "staff", role });
    reads.workspace.mockResolvedValue({ ...(await reads.workspace()), episodes: [{ ...historical, insuranceCorrection: true }] });
    const html = renderToStaticMarkup(await MvpWorkspace({ surface: "exceptions" }));
    expect(queue(html)).toContain("Patient historical");
    expect(html).toContain("1 exception episodes for follow-up");
    expect(queue(await render("exceptions", { view: "history" }))).not.toContain("Patient historical");
  });
  it("keeps Pharmacy discharge review limited to its own department", async () => {
    reads.staff.mockResolvedValue({ id: "pharmacy", role: "PHARMACY" });
    reads.episode.mockResolvedValue({ ...(await reads.episode()), checks: [{ check: "PHARMACY", current: false }, { check: "NURSING", current: false }, { check: "INSURANCE", current: false }] });
    const html = await render("discharge");
    expect(html).toContain("pharmacy · Review pending");
    expect(html).not.toContain("nursing · Review pending");
    expect(html).not.toContain("insurance · Review pending");
  });
  it("does not call role-redacted Pharmacy paper or finance sources missing after exit", async () => {
    reads.staff.mockResolvedValue({ id: "pharmacy", role: "PHARMACY" });
    reads.workspace.mockResolvedValue({ ...(await reads.workspace()), episodes: [{ ...historical, medicineCount: 1 }] });
    reads.episode.mockResolvedValue({ ...(await reads.episode()), episode: { status: "DISCHARGED" }, finance: null, documents: [], deliveries: [], departure: null, exceptionalDeparture: null });
    const html = await render("discharge", { view: "history" });
    expect(html).toContain("Episode closed");
    expect(html).not.toContain("Final finance:");
    expect(html).not.toContain("Final papers:");
    expect(html).not.toContain("delivery not recorded");
  });
  it("gives Insurance staff the check action while financial staff review its handoff", () => {
    const check = { ...preparation, caseId: "case", coordination: { ...preparation.coordination!, pendingChecks: ["INSURANCE"] } };
    expect(purposeRows([check], "insurance", "INSURANCE")[0].action).toBe("Complete Insurance readiness check");
    expect(purposeRows([check], "insurance", "ADMIN")[0].action).toBe("Review Insurance readiness handoff");
    expect(purposeRows([check], "insurance", "BILLING")[0].action).toBe("Review Insurance readiness handoff");
  });
  it("shows retained exit authority after a later receipt without implying discharge reopened", async () => {
    reads.episode.mockResolvedValue({ ...(await reads.episode()), episode: { status: "DISCHARGED" }, finance: null, departure: { mvpFinanceId: "original-finance" } });
    const html = await render("discharge", { view: "history" });
    expect(html).toContain("Actual exit recorded");
    expect(html).toContain("Final finance: retained at exit");
    expect(html).not.toContain("requires review");
  });
  it("keeps the hospital patient register broad but discharge limited to actual preparation", async () => { expect(queue(await render())).toContain("Patient routine"); const discharge = queue(await render("discharge")); expect(discharge).toContain("Patient preparing"); expect(discharge).not.toContain("Patient routine"); expect(discharge).not.toContain("Patient pending"); expect(discharge).toContain('/mvp/preparing?tab=exit'); });
  it("shows only recorded exceptions and directs pending intake exceptions to their authorized source", async () => { const html = queue(await render("exceptions")); expect(html).toContain("Patient exception"); expect(html).not.toContain("Patient routine"); expect(html).not.toContain("Patient pending"); expect(html).toContain('/mvp/exception?tab=exceptions'); });
  it("keeps routine admitted medicine work discoverable without presenting another department's task", async () => { reads.staff.mockResolvedValue({ id: "pharmacy", role: "PHARMACY" }); const html = await render("medicine"); expect(queue(html)).toContain("Patient routine"); expect(queue(html)).not.toContain("Patient pending"); expect(html).toContain('/mvp/routine?tab=money'); expect(html).not.toContain("Patient still due"); const actions = queue(await render("medicine", { view: "action" })); expect(actions).toContain("Patient preparing"); expect(actions).not.toContain("Patient routine"); expect(actions).not.toContain("Review nursing check"); });
  it("uses financial task links and a monetary summary without clinical departments", async () => { const html = await render("payments"); expect(queue(html)).toContain('/mvp/routine?tab=money'); expect(html).toContain("Patient still due"); expect(html).not.toContain("Doctor approval pending"); expect(html).not.toContain("Department checks"); });
  it("shows pending, current and retained insurance cases with exact case links and excludes self-pay", async () => { reads.staff.mockResolvedValue({ id: "insurance", role: "INSURANCE" }); const html = await render("insurance"); expect(queue(html)).toContain('/insurance?caseId=case-insured'); expect(queue(html)).toContain('/insurance?caseId=case-pending'); expect(queue(html)).not.toContain("Patient routine"); expect(queue(html)).not.toContain('/patients/'); expect(queue(await render("insurance", { view: "history" }))).toContain('/insurance?caseId=case-history'); });
  it("does not call another department's pending check an Insurance or Pharmacy action", async () => { const other = row("other", { caseId: "case-other", needsAction: true, coordination: { clinical: true, checklist: true, pendingChecks: ["NURSING"], finance: false, finalDelivered: false, exception: false } }); reads.workspace.mockResolvedValue({ ...(await reads.workspace()), episodes: [other] }); expect(queue(await render("medicine", { view: "action" }))).not.toContain("Patient other"); expect(queue(await render("insurance", { view: "action" }))).not.toContain("Patient other"); });
});
