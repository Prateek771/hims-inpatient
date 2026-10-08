import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { admissionWorkspace } from "@/server/admissions/commands";
import { AccountControls } from "@/components/account-controls";
const areas = {
  ADMIN: ["Hospital overview", "Beds, discharge blockers and exceptions"],
  ADMISSION: [
    "Admission desk",
    "Patient identity, clinician-entered intake, bed allocation and initial deposit requirements",
  ],
  DOCTOR: [
    "Doctor workspace",
    "Assigned patients, rounds, orders, prescriptions and clinical discharge review",
  ],
  NURSE: [
    "Nursing workspace",
    "Assigned ward patients, shifts, vitals, medication administration and handover",
  ],
  PHARMACY: [
    "Pharmacy workspace",
    "Department prescriptions, medicine issues, returns and pharmacy clearance",
  ],
  LAB: [
    "Lab worklist",
    "Linked department orders, samples, results and report status",
  ],
  INSURANCE: [
    "Insurance paperwork",
    "Assigned cases, externally verified payer decisions and reviewed paperwork",
  ],
  BILLING: [
    "Charges and receipts",
    "Charges, manual receipts, reconciliation and final administrative clearance",
  ],
};
export default async function Workspace() {
  const staff = await requireStaff();
  const [title, work] = areas[staff.role];
  const doctorWorklist =
    staff.role === "DOCTOR"
      ? (await admissionWorkspace(staffContext(staff, "doctor-worklist")))
          .worklist
      : [];
  return (
    <>
      <p className="eyebrow">
        {title} · {staff.role}
      </p>
      <h1>Welcome, {staff.name}</h1>
      <section className="notice">
        <h2>{title}</h2>
        <p>
          {work}. This department’s inpatient records and actions will be
          available when its workflow is implemented.
        </p>
      </section>
      {staff.role === "ADMIN" && (
        <section className="card">
          <h2>Hospital administration</h2>
          <div className="actions">
            <Link className="button" href="/admin/staff">
              Manage staff
            </Link>
            <Link className="button" href="/admin/settings">
              Hospital settings
            </Link>
            <Link className="button" href="/admin/beds">
              Bed inventory
            </Link>
          </div>
        </section>
      )}
      {staff.role === "ADMISSION" && (
        <section className="card">
          <h2>Patient intake</h2>
          <p>
            Find permanent patient identities, reserve an available bed and
            register a pending admission.
          </p>
          <Link className="button" href="/admissions">
            Admissions &amp; beds
          </Link>
        </section>
      )}
      {staff.role === "DOCTOR" && (
        <section className="card">
          <h2>Patients admitted under you</h2>
          <p>
            All your pending and admitted episodes, followed by your latest 50
            closed episodes.
          </p>
          {doctorWorklist.length ? (
            <ul className="patient-results">
              {doctorWorklist.map((a) => (
                <li key={a.id}>
                  <Link href={`/patients/${a.id}`}>
                    {a.name} · {a.ipCode} · {a.status}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No admission episodes recorded under you.</p>
          )}
        </section>
      )}
      <AccountControls />
    </>
  );
}
