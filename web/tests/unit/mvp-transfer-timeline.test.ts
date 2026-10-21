import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readState } = vi.hoisted(() => ({ readState: vi.fn() }));
vi.mock("../../src/server/access", () => ({ requireStaff: async () => ({ id: "admin", role: "ADMIN" }), staffContext: () => ({ actorId: "admin" }) }));
vi.mock("../../src/server/mvp/transfers", () => ({ getMvpTransferState: readState }));
vi.mock("../../src/server/mvp/staff", () => ({ getDoctorDirectory: async () => [] }));
vi.mock("../../src/app/(staff)/mvp/[admissionId]/transfer-actions", () => ({ saveMvpTransfer: vi.fn() }));
import { MvpTransfers } from "../../src/components/mvp-transfers";
import { HospitalTimeProvider } from "../../src/components/hospital-time-context";

const first = new Date("2026-10-17T23:00:00Z"), moved = new Date("2026-10-18T02:30:00Z"), again = new Date("2026-10-18T05:00:00Z");
const stays = [
  { id: "stay-c", bedId: "bed-a", startedAt: again, endedAt: null },
  { id: "stay-a", bedId: "bed-a", startedAt: first, endedAt: moved },
  { id: "stay-b", bedId: "bed-b", startedAt: moved, endedAt: again },
];
const beds = [{ id: "bed-a", label: "Demo G-104", category: "GENERAL" }, { id: "bed-b", label: "Demo ICU-2", category: "ICU" }];
const transfers = [
  { id: "move-b", newStayId: "stay-c", signedBy: "nurse-b", signedAt: again, recorderName: "Nurse Uma", transferredAt: again, handover: "Return handover", mvpAuthorityId: "authority-b" },
  { id: "move-a", newStayId: "stay-b", signedBy: "nurse-a", signedAt: moved, recorderName: "Nurse Maya", transferredAt: moved, handover: "Destination handover", mvpAuthorityId: "authority-a" },
];
const timeline = [stays[1], stays[2], stays[0]].map(stay => ({ ...stay, bedLabel: stay.bedId === "bed-a" ? "Demo G-104" : "Demo ICU-2", bedCategory: stay.bedId === "bed-a" ? "GENERAL" : "ICU", transfer: transfers.find(transfer => transfer.newStayId === stay.id) ?? null }));

beforeEach(() => readState.mockResolvedValue({ episodeVersion: 1, currentStay: { ...stays[0], lastReconciledAt: again }, timeline, authorities: [{ id: "authority-a", destinationCategory: "ICU", status: "COMPLETED", authorizerName: "Dr Leena", sourceTime: first, evidence: "Retained external evidence", reason: "Higher observation", recordedAt: first, recordedBy: "instruction-recorder" }], cancellations: [], history: transfers, beds, categories: [] }));

async function render() {
  return renderToStaticMarkup(createElement(HospitalTimeProvider, { timezone: "Asia/Kolkata" } as Parameters<typeof HospitalTimeProvider>[0], await MvpTransfers({ admissionId: "episode", open: true, ownShifts: [] })));
}

describe("MVP transfer timeline", () => {
  it("projects repeated moves in effective-time order without mutating the source or dropping a return to the same bed", async () => {
    const { mvpTransferTimeline } = await import("../../src/lib/mvp-transfer-timeline");
    const result = mvpTransferTimeline(stays, beds, transfers);
    expect(result.map(stay => stay.id)).toEqual(["stay-a", "stay-b", "stay-c"]);
    expect(result.map(stay => stay.bedLabel)).toEqual(["Demo G-104", "Demo ICU-2", "Demo G-104"]);
    expect(result.map(stay => stay.transfer?.recorderName ?? null)).toEqual([null, "Nurse Maya", "Nurse Uma"]);
    expect(result[0].endedAt).toEqual(result[1].startedAt);
    expect(result[1].endedAt).toEqual(result[2].startedAt);
    expect(result.filter(stay => stay.endedAt === null)).toHaveLength(1);
    expect(stays.map(stay => stay.id)).toEqual(["stay-c", "stay-a", "stay-b"]);
  });

  it("uses an explicit missing-label fallback without inventing location metadata", async () => {
    const { mvpTransferTimeline } = await import("../../src/lib/mvp-transfer-timeline");
    const [stay] = mvpTransferTimeline([stays[0]], [], []);
    expect(stay.bedLabel).toBe("Bed label unavailable");
    expect(stay.bedCategory).toBe("Category unavailable");
    expect(stay.transfer).toBeNull();
  });

  it("shows ordered stays with local boundaries, one continuing stay and distinct clinical and movement provenance", async () => {
    const html = await render();
    expect(html).toContain("Bed stay timeline");
    expect(html).toContain("Current bed: Demo G-104");
    expect(html).toContain("GENERAL");
    expect(html).toContain("Demo ICU-2");
    expect(html).toContain("18 Oct 2026, 04:30:00");
    expect(html).toContain("18 Oct 2026, 08:00:00");
    expect(html).toContain("Asia/Kolkata");
    expect(html.match(/Continuing/g)).toHaveLength(1);
    expect(html.indexOf('data-stay-id="stay-a"')).toBeLessThan(html.indexOf('data-stay-id="stay-b"'));
    expect(html.indexOf('data-stay-id="stay-b"')).toBeLessThan(html.indexOf('data-stay-id="stay-c"'));
    expect(html).toContain("Dr Leena");
    expect(html).toContain("Retained external evidence");
    expect(html).toContain("Nurse Maya");
    expect(html).toContain("Destination handover");
    expect(html).not.toContain("old stay stay-a");
  });

  it("does not invent an occupied or continuing stay when all effective stays have ended", async () => {
    const endedTimeline = timeline.map(stay => ({ ...stay, endedAt: stay.endedAt ?? new Date("2026-10-18T06:00:00Z") }));
    const state = await readState();
    readState.mockResolvedValue({ ...state, currentStay: null, timeline: endedTimeline });
    const html = await render();
    expect(html).toContain("Bed stay timeline");
    expect(html).not.toContain("Continuing");
    expect(html).not.toContain("Current bed:");
  });
});
