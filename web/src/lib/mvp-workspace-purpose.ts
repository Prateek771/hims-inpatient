import type { StaffRole } from "@/server/contracts";
import type { MvpQueueRow } from "@/server/mvp/workspace";

export type WorkspacePurpose = "patients" | "admission" | "nursing" | "payments" | "medicine" | "insurance" | "discharge" | "exceptions";
export type WorkspaceSurface = "payments" | "medicine" | "discharge" | "insurance" | "exceptions";
export type PurposeRow = MvpQueueRow & { href: string };
export function workspacePurpose(role: StaffRole, surface?: WorkspaceSurface): WorkspacePurpose {
  if (surface) return surface;
  return ({ ADMIN: "patients", ADMISSION: "admission", NURSE: "nursing", BILLING: "payments", PHARMACY: "medicine", INSURANCE: "insurance", DOCTOR: "patients", LAB: "patients" } as const)[role];
}
export const workspacePurposes = {
  patients: { title: "Patients & admissions", home: "/overview", queue: "Patient work queue", description: "Keep today’s admissions and departures moving.", empty: "New admissions appear here after Admission staff register a patient.", all: "All patients", metric: "current MVP admissions", task: "Next action / blocker" },
  admission: { title: "Admissions", home: "/admissions", queue: "Admission work", description: "Review patient identity, reservations, deposits and actual arrival.", empty: "Registered admissions appear here for arrival and intake follow-up.", all: "All admissions", metric: "current admissions", task: "Admission task" },
  nursing: { title: "My patients", home: "/nursing", queue: "Assigned patient work", description: "Record external instructions, coordinate readiness and confirm actual movement.", empty: "Admin assigns patient nursing responsibility before episodes appear here.", all: "All patients", metric: "assigned current patients", task: "Nursing task" },
  payments: { title: "Payments & insurance", home: "/billing", queue: "Financial work", description: "Review charges, actual receipts, refunds and accepted insurer responsibility.", empty: "Current admissions appear here for financial work. Later receipts remain available in retained episodes.", all: "All financial episodes", metric: "current financial episodes", task: "Financial task" },
  medicine: { title: "Medicine bills & returns", home: "/pharmacy", queue: "Patient medicine work", description: "Record patient medicine bills, accepted unused returns and Pharmacy reconciliation.", empty: "Admitted patients appear here for new medicine charges. Retained medicine sources remain in history.", all: "All medicine patients", metric: "admitted medicine patients", task: "Medicine task" },
  insurance: { title: "Insurance cases", home: "/insurance", queue: "Insurance case work", description: "Review assigned cases, external verification, accepted responsibility and staff follow-up.", empty: "Only episodes with an insurance case appear here. Admission, Admin or Billing creates and assigns cases.", all: "All current cases", metric: "current insurance cases", task: "Insurance task" },
  discharge: { title: "Discharge", home: "/discharge", queue: "Discharge preparation", description: "Review patients preparing to leave, required checks, authorized papers and actual exit.", empty: "Patients appear after a recorded discharge instruction, readiness work, vacancy or exceptional disposition.", all: "All preparing patients", metric: "preparing to leave", task: "Discharge handoff" },
  exceptions: { title: "Exceptions & follow-up", home: "/exceptions", queue: "Recorded exceptions & obligations", description: "Review recorded exceptional decisions, urgent authority and identity follow-up.", empty: "Only recorded exceptions or temporary identity obligations appear here. Open a patient record to record new authority.", all: "All exception work", metric: "exception episodes for follow-up", task: "Exception follow-up" },
} as const;

export function purposeRows(episodes: MvpQueueRow[], purpose: WorkspacePurpose, role: StaffRole): PurposeRow[] {
  return episodes.flatMap(row => {
    const current = ["PENDING", "ADMITTED"].includes(row.status), admitted = row.status === "ADMITTED", c = row.coordination;
    const preparing = c ? c.clinical || c.checklist || row.vacant || c.exception : !["Inpatient care", "Admission", "Staff assignment", "Cancelled", "Exited"].includes(row.stage);
    const recordedException = !!(c?.exception || row.temporaryIdentity || row.intakeException);
    const ownCheck = (check: string) => !!c?.clinical && !!c.checklist && c.pendingChecks.includes(check);
    const patientHref = row.status === "PENDING" && ["ADMIN", "ADMISSION"].includes(role) ? `/patients/${row.id}` : `/mvp/${row.id}`;
    let action = row.action, detail = row.detail, owner = row.owner, ownerRole = row.ownerRole, needsAction = row.needsAction, href = patientHref;
    if (purpose === "medicine") {
      if (current ? !admitted : row.medicineCount === 0) return [];
      needsAction = admitted && ownCheck("PHARMACY");
      action = current ? needsAction ? "Complete Pharmacy reconciliation" : role === "PHARMACY" ? "Record medicine bill or accepted return" : "Review medicine bills & returns" : "Review retained medicine sources";
      detail = `${row.medicineCount ?? 0} recorded medicine charge / return sources. Accepted return credit is separate from an actual refund.`;
      owner = "Pharmacy"; ownerRole = "Pharmacy";
      href = `/mvp/${row.id}?tab=${needsAction && role === "PHARMACY" ? "readiness" : "money"}`;
    } else if (purpose === "insurance") {
      if (!row.caseId) return [];
      needsAction = current && ownCheck("INSURANCE"); action = needsAction ? role === "INSURANCE" ? "Complete Insurance readiness check" : "Review Insurance readiness handoff" : current ? "Review policy, acceptance & follow-up" : "Review retained insurance case";
      detail = "External acceptance, insurer receivable and actual receipts remain separate.";
      owner = row.insuranceOwner ?? "Unassigned · Insurance"; ownerRole = "Insurance";
      href = `/insurance?caseId=${row.caseId}`;
    } else if (purpose === "payments") {
      needsAction = current && (row.status === "PENDING" || row.stage === "Final review");
      action = current ? row.stage === "Final review" ? "Review final settlement & finances" : "Review charges, receipts & refunds" : "Review retained money & receivables";
      detail = row.status === "PENDING" ? "Review recorded deposits; Admission / Admin records actual arrival." : "Keep patient settlement, accepted insurer responsibility and actual cash separate.";
      owner = "Billing / Admin"; ownerRole = "Billing / Admin"; href = `/mvp/${row.id}?tab=money`;
    } else if (purpose === "exceptions") {
      if (role === "PHARMACY" || role === "INSURANCE" && !row.insuranceCorrection || role === "ADMISSION" && !row.temporaryIdentity && !row.intakeException) return [];
      if (!recordedException && !row.insuranceCorrection) return [];
      needsAction = current || !!row.insuranceCorrection; action = row.insuranceCorrection ? "Review authorized insurance correction" : row.temporaryIdentity ? "Review temporary identity follow-up" : "Review recorded authority & follow-up";
      detail = "Review actual authority, accountable follow-up and remaining obligations; retained decisions remain visible.";
      href = ["PENDING", "CANCELLED"].includes(row.status) ? `/exceptions?admissionId=${row.id}` : `/mvp/${row.id}?tab=exceptions`;
      if (row.insuranceCorrection) { href = `/mvp/${row.id}?tab=money`; owner = row.insuranceOwner ?? "Insurance / Billing / Admin"; ownerRole = "Insurance / Billing / Admin"; }
    } else if (purpose === "discharge") {
      if (current ? !admitted || !preparing : row.status !== "DISCHARGED") return [];
      href = `/mvp/${row.id}?tab=exit`;
      needsAction = admitted && (role === "PHARMACY" ? ownCheck("PHARMACY") : role === "BILLING" ? row.stage === "Final review" : role === "NURSE" ? ["Readiness", "Vacancy", "Papers", "Awaiting exit"].includes(row.stage) || ownCheck("NURSING") || ownCheck("DIAGNOSTICS") : row.needsAction);
      if (role === "PHARMACY") { action = needsAction ? "Complete Pharmacy readiness check" : "Review Pharmacy check & exit status"; owner = "Pharmacy"; ownerRole = "Pharmacy"; href = `/mvp/${row.id}?tab=readiness`; }
      else if (role === "BILLING") action = needsAction ? "Authorize final finances" : "Review final-finance handoff";
      else if (role === "NURSE" && current) { action = needsAction ? ["Vacancy", "Papers", "Awaiting exit"].includes(row.stage) ? row.action : "Review Nursing readiness & instructions" : "Review discharge handoff & waiting care"; href = `/mvp/${row.id}?tab=${["Vacancy", "Papers", "Awaiting exit"].includes(row.stage) ? "exit" : "readiness"}`; }
      else if (role === "ADMIN" && current) action = "Review discharge checks & final authority";
      else if (!current) action = "Review retained papers & exit";
    } else if (purpose === "nursing") {
      if (current && !admitted) return [];
      needsAction = admitted && (c ? !!(c.clinical && (!c.checklist || ownCheck("NURSING") || ownCheck("DIAGNOSTICS")) || ["Vacancy", "Papers", "Awaiting exit"].includes(row.stage)) : row.needsAction && ["Assigned Nurse", "Nurse"].includes(row.ownerRole));
      action = needsAction ? ["Vacancy", "Papers", "Awaiting exit"].includes(row.stage) ? row.action : "Review Nursing readiness & instructions" : current ? "Open assigned patient & movement" : "Review retained nursing handoff";
      owner = row.nurseName ?? "Unassigned · Nursing"; ownerRole = "Assigned Nurse"; href = `/mvp/${row.id}?tab=${["Vacancy", "Papers", "Awaiting exit"].includes(row.stage) ? "exit" : "readiness"}`;
    }
    return [{ ...row, action, detail, owner, ownerRole, needsAction, href }];
  });
}
