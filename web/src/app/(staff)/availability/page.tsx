import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { getDoctorAvailability, getDoctorDirectory } from "@/server/mvp/staff";
import { CareField, CareForm } from "@/components/care-forms";
import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { saveAvailability } from "./actions";

export default async function DoctorAvailabilityPage() {
  const staff = await requireStaff();
  if (!["ADMIN", "NURSE", "ADMISSION"].includes(staff.role)) notFound();
  const ctx = staffContext(staff, "doctor-availability-view");
  const [doctors, data] = await Promise.all([getDoctorDirectory(ctx), getDoctorAvailability(ctx)]);
  const nurseName = (id: string | null) => data.nurses.find(nurse => nurse.id === id)?.name ?? (id ? "Retained Nurse identity" : "No backup assigned");
  const coordinator = data.coordinator, canUpdate = staff.role === "NURSE" && !!coordinator && [coordinator.nurseId, coordinator.backupNurseId].includes(staff.id);
  const action = (operation: string) => saveAvailability.bind(null, operation, crypto.randomUUID());
  return <>
    <h1>Doctor availability</h1><p className="page-description">A staff operations register maintained by the designated shift Nurse. Availability is separate from attendance and clinical discharge authority.</p>
    {staff.role === "ADMIN" && <div className="actions"><Link href="/admin/staff">Staff & settings</Link><Link href="/admin/care">Patient nursing assignments</Link></div>}
    <section className="mvp-summary">{coordinator ? <><strong>{nurseName(coordinator.nurseId)} · shift owner</strong><span>Backup: {nurseName(coordinator.backupNurseId)}</span><span><HospitalTimestamp value={coordinator.startsAt.toISOString()} /> – <HospitalTimestamp value={coordinator.endsAt.toISOString()} /></span></> : <p>No current availability coordinator assigned. Admin must record the shift owner and backup.</p>}</section>
    <section className="card"><h2>Current directory availability</h2>
      <p className="caption">Availability evaluated <HospitalTimestamp value={data.asOf.toISOString()} />. Refresh to review a changed period.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Doctor availability table"><table><thead><tr><th>Doctor</th><th>Recorded availability</th><th>Relevant period / expected return</th><th>Updated by / time</th></tr></thead><tbody>{doctors.filter(doctor => doctor.active).map(doctor => {
        const latest = data.records.find(record => record.doctorId === doctor.id);
        const current = data.currentRecords.find(record => record.doctorId === doctor.id);
        const entry = current ?? latest;
        const scheduled = !current && !!entry && entry.startsAt > data.asOf;
        return <tr key={doctor.id}>
          <td><strong>{doctor.name}</strong><p className="caption">{doctor.specialty}</p></td>
          <td>{current ? current.status.replaceAll("_", " ") : entry ? `No current status · ${scheduled ? "scheduled" : "last recorded"} ${entry.status.replaceAll("_", " ")}` : "No current status · not recorded"}{entry && <p className="caption">{entry.remarks}</p>}</td>
          <td>{entry ? <><p className="caption">{current ? "Current effective period" : scheduled ? "Scheduled period" : "Last recorded period"}</p><HospitalTimestamp value={entry.startsAt.toISOString()} /> – <HospitalTimestamp value={entry.endsAt.toISOString()} />{entry.expectedReturn && <p>{current || scheduled ? "Expected return" : "Recorded expected return"} <HospitalTimestamp value={entry.expectedReturn.toISOString()} /></p>}</> : "Ask the designated shift Nurse"}</td>
          <td>{entry ? <>{nurseName(entry.recordedBy)}<p className="caption">{current ? "Current record updated" : "Recorded"} <HospitalTimestamp value={entry.recordedAt.toISOString()} /></p></> : "Awaiting update"}</td>
        </tr>;
      })}</tbody></table></div>
      {!doctors.some(doctor => doctor.active) && <p>No active treating Doctor is configured. Admin can add a named external Doctor below; this does not create a login.</p>}
    </section>
    {canUpdate && <section className="card"><h2>Record actual availability</h2><CareForm action={action("availability")} button="Record Doctor availability" testId="mvp-availability"><label>Doctor<select name="doctor" required defaultValue=""><option value="">Choose active Doctor</option>{doctors.filter(doctor => doctor.active).map(doctor => <option value={`${doctor.id}|${data.records.find(record => record.doctorId === doctor.id)?.version ?? 0}`} key={doctor.id}>{doctor.name}</option>)}</select></label><label>Actual status<select name="status">{["AVAILABLE", "OT", "LEAVE", "OFF_DUTY"].map(status => <option key={status}>{status}</option>)}</select></label><CareField name="startsAt" label="Availability period starts (UTC)" type="datetime-local" /><CareField name="endsAt" label="Availability period ends (UTC)" type="datetime-local" /><CareField name="expectedReturn" label="Expected return (UTC, if known)" type="datetime-local" required={false} /><CareField name="remarks" label="Availability source and remarks" /></CareForm></section>}
    {staff.role === "NURSE" && !canUpdate && <p className="notice">Only the current designated shift owner or backup can update this register. Your patient nursing assignment does not grant that separate responsibility.</p>}
    {staff.role === "ADMIN" && <>
      <details className="mvp-action"><summary>Assign availability shift owner & backup</summary><CareForm action={action("coordinator")} button="Assign availability responsibility" testId="mvp-availability-owner"><input type="hidden" name="expectedVersion" value={data.coordinatorVersion} /><label>Designated shift Nurse<select name="nurseId" required defaultValue=""><option value="">Choose owner</option>{data.nurses.map(nurse => <option value={nurse.id} key={nurse.id}>{nurse.name}</option>)}</select></label><label>Backup Nurse<select name="backupNurseId" defaultValue=""><option value="">No backup recorded</option>{data.nurses.map(nurse => <option value={nurse.id} key={nurse.id}>{nurse.name}</option>)}</select></label><CareField name="startsAt" label="Responsibility starts (UTC)" type="datetime-local" /><CareField name="endsAt" label="Responsibility ends (UTC)" type="datetime-local" /><CareField name="reason" label="Responsibility assignment reason" /></CareForm></details>
      <details className="mvp-action"><summary>Add a treating Doctor to the directory</summary><CareForm action={action("doctor")} button="Add directory Doctor" testId="mvp-doctor-directory"><input type="hidden" name="expectedVersion" value="0" /><CareField name="name" label="Doctor name" /><CareField name="specialty" label="Specialty (optional)" required={false} /><label><input type="checkbox" name="active" value="true" defaultChecked />Active treating Doctor</label><CareField name="reason" label="Directory entry reason" /><p className="caption">A directory Doctor is an external clinical identity. Adding one creates no staff login.</p></CareForm></details>
      <details className="mvp-action"><summary>Manage retained Doctor directory versions</summary>{doctors.map(doctor => <details key={doctor.id}><summary>{doctor.name} · {doctor.active ? "Active" : "Inactive"}</summary><CareForm action={action("doctor")} button="Save directory version"><input type="hidden" name="id" value={doctor.id} /><input type="hidden" name="expectedVersion" value={doctor.version} /><CareField name="name" label="Doctor name" defaultValue={doctor.name} /><CareField name="specialty" label="Specialty (optional)" required={false} defaultValue={doctor.specialty ?? ""} /><label><input type="checkbox" name="active" value="true" defaultChecked={doctor.active} />Active treating Doctor</label><CareField name="reason" label="Directory change reason" /></CareForm></details>)}</details>
    </>}
  </>;
}
