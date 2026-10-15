import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { admissionWorkspace, searchPatients } from "@/server/admissions/commands";
import { getStaffWorklist } from "@/server/overview";
import { AdmissionForm } from "@/components/admission-forms";
import { StaffAlerts, WorkTimestamp } from "@/components/staff-dashboard";
import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { WorkflowTabs } from "@/components/workflow-tabs";
import { getDoctorDirectory } from "@/server/mvp/staff";

export default async function AdmissionsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; patient?: string; view?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "ADMISSION") redirect("/workspace");
  const ctx = staffContext(staff, "admission-worklist");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const [results, workspace, work] = await Promise.all([
    query.length >= 2 ? searchPatients(ctx, query) : Promise.resolve([]),
    admissionWorkspace(ctx),
    getStaffWorklist(staffContext(staff, "admission-current-work")),
  ]);
  const selected = results.find(patient => patient.id === params.patient);
  const doctors = (await getDoctorDirectory(ctx)).filter(doctor => doctor.active);
  const pending = workspace.worklist.filter(episode => episode.status === "PENDING").length;
  const admitted = workspace.worklist.filter(episode => episode.status === "ADMITTED").length;
  return <>
    <WorkflowTabs key={selected?.id ?? "new"} id="admission-work" initialTab={params.view === "intake" || query || selected ? "intake" : "queue"} beforeTabs={<><div className="page-heading">
      <div><h1>Admissions</h1><p className="page-description">Patient identity, pending reservations and traceable intake history.</p></div>
      <Link data-workflow-tab={selected ? undefined : "intake"} className="button" href="/admissions?view=intake">New admission</Link>
    </div>
    <WorkTimestamp work={work} />
    <div className="care-work-metrics">
      {[["Pending reservations", pending, "Before actual arrival and deposit checks"], ["Active stays", admitted, "Admission can record patient deposits or top-ups"], ["Retained closed episodes", workspace.worklist.length - pending - admitted, "Latest 50 cancelled or discharged episodes"]].map(([label, value, detail]) => <div className="card metric" key={label}><p>{label}</p><strong>{value}</strong><p className="caption">{detail}</p></div>)}
    </div></>} items={[
      { id: "queue", label: "Current admission work", children: <>
        <section className="card" data-testid="staff-worklist">
          <h2>Current admission work</h2>
          <p className="caption">Every pending and active episode, followed by the latest 50 closed episodes. Open the patient record for identity, deposits and actual arrival.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Admission worklist table"><table className="staff-table">
            <thead><tr><th>Patient / admission</th><th>Bed / status</th><th>Registered</th><th>Next responsible work</th></tr></thead>
            <tbody>{workspace.worklist.map(episode => <tr key={episode.id}>
              <td><strong>{episode.name}</strong><p className="caption">{episode.ipCode}</p></td>
              <td>{episode.bedLabel}<p><span className="status">{episode.status}</span></p></td>
              <td><HospitalTimestamp value={episode.registeredAt.toISOString()} /></td>
              <td><Link href={`/patients/${episode.id}`}>{work.episodes.find(item => item.id === episode.id)?.action ?? "Review admission record"}</Link></td>
            </tr>)}</tbody>
          </table></div>
          {!workspace.worklist.length && <p>No admission episodes have been registered.</p>}
        </section>
        <div className="operations-columns">
          <section className="card"><h2>Next desk handoff</h2><p>Saving intake reserves a bed. Patient deposits and actual activation stay in the patient record; Billing manages the wider settlement.</p><div className="actions"><Link className="button secondary" href="/insurance">Create limited insurance case</Link><Link href="/exceptions">Urgent authority and identity follow-up</Link></div></section>
          <section className="card"><h2>Identity stays with the patient</h2><p>The permanent UHID is reused for later stays. Each admission receives its own IP code. A shared family phone number does not merge identities.</p></section>
        </div>
      </> },
      { id: "intake", label: "Patient identity & intake", children: <>
        <section className="card patient-search"><h2>Find an existing patient</h2><p className="caption">Select the permanent UHID for a repeat stay, or enter a truthful new identity below.</p>
          <form method="get" className="search-row"><input type="hidden" name="view" value="intake" /><label>Find existing patient by name or UHID<input name="q" defaultValue={query} minLength={2} maxLength={100} /></label><button className="button secondary">Find patient</button></form>
          {query.length >= 2 && <ul className="patient-results">{results.map(patient => <li key={patient.id}><Link href={`/admissions?view=intake&q=${encodeURIComponent(query)}&patient=${patient.id}`}>{patient.name} · {patient.uhid} · {patient.dateOfBirth ?? (patient.ageYearsAtRegistration === null ? "Age unknown" : `${patient.ageYearsAtRegistration} years at registration`)} · {patient.sex}</Link></li>)}{!results.length && <li>No matching identity. Register a new patient if appropriate.</li>}</ul>}
        </section>
        <AdmissionForm requestId={crypto.randomUUID()} doctors={doctors} categories={workspace.categories} beds={workspace.beds} depositRules={workspace.depositRules} patient={selected} />
        <section className="notice"><h2>Same arrival checks for self-pay and insured stays</h2><p>Record actual hospital receipts and the configured deposit before ordinary activation. Urgent temporary identity remains explicit and requires named Administrator authority.</p></section>
      </> },
    ]} />
    <div className="staff-alerts-compact"><StaffAlerts work={work} /></div>
  </>;
}
