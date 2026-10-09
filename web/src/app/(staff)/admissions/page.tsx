import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import {
  admissionWorkspace,
  searchPatients,
} from "@/server/admissions/commands";
import { AdmissionForm } from "@/components/admission-forms";

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; patient?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "ADMISSION") redirect("/workspace");
  const ctx = staffContext(staff, "admission-worklist");
  const params = await searchParams;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const results = query.length >= 2 ? await searchPatients(ctx, query) : [];
  const selected = results.find((p) => p.id === params.patient);
  const workspace = await admissionWorkspace(ctx);
  return (
    <>
      <p className="eyebrow">
        01 · Admission &amp; identity / Used by admission
      </p>
      <h1>A smooth start to the stay</h1>
      <p className="page-description">
        Register the patient, choose a bed and record the payment route.
      </p>
      <section className="patient-search">
        <form method="get" className="search-row">
          <label>
            Find existing patient by name or UHID
            <input
              name="q"
              defaultValue={query}
              minLength={2}
              maxLength={100}
            />
          </label>
          <button className="button secondary">Find patient</button>
        </form>
        {query.length >= 2 && (
          <ul className="patient-results">
            {results.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admissions?q=${encodeURIComponent(query)}&patient=${p.id}`}
                >
                  {p.name} · {p.uhid} ·{" "}
                  {p.dateOfBirth ??
                    (p.ageYearsAtRegistration===null?"Age unknown":`${p.ageYearsAtRegistration} years at registration`)}{" "}
                  · {p.sex}
                </Link>
              </li>
            ))}
            {!results.length && (
              <li>
                No matching identity. Register a new patient if appropriate.
              </li>
            )}
          </ul>
        )}
      </section>
      <AdmissionForm
        requestId={crypto.randomUUID()}
        doctors={workspace.doctors}
        categories={workspace.categories}
        beds={workspace.beds}
        depositRules={workspace.depositRules}
        patient={selected}
      />
      <section className="notice">
        <h2>Self-pay patients follow the same admission journey</h2>
        <p>
          Deposit checks and staff-recorded receipts precede activation. A
          shared family phone number does not identify a patient; select their
          permanent UHID for a repeat stay.
        </p>
      </section>
      <section className="card">
        <h2>Admission worklist</h2>
        <p>
          All pending and admitted episodes, followed by the latest 50 closed
          episodes.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Patient / IP code</th>
                <th>Bed</th>
                <th>Status</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {workspace.worklist.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/patients/${a.id}`}>
                      {a.name} · {a.ipCode}
                    </Link>
                  </td>
                  <td>{a.bedLabel}</td>
                  <td>
                    <span className="status">{a.status}</span>
                  </td>
                  <td>{a.registeredAt.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!workspace.worklist.length && (
            <p>No admission episodes have been registered.</p>
          )}
        </div>
      </section>
    </>
  );
}
