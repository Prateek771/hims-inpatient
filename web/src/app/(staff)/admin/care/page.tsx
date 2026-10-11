import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { requireStaff, staffContext } from "@/server/access";
import { assignmentWorkspace } from "@/server/nursing/commands";
import { CareField, CareForm } from "@/components/care-forms";
import { saveNursing } from "../../nursing/actions";

export default async function CareAssignments() {
  const staff = await requireStaff();
  const data = await assignmentWorkspace(staffContext(staff, "nursing-assignment-view"));
  return <>
    <h1>Assignments</h1>
    <p className="page-description">Assign actual nursing responsibility without opening a clinical chart.</p>
    <div className="operations-columns">
      <section className="card"><h2>Current nursing responsibility</h2><p className="caption">Operational identity, authority and assignment history. Clinical signatures belong to the treating professionals.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Nursing assignment history table"><table className="staff-table">
          <thead><tr><th>Admission / nurse</th><th>Authority / reason</th><th>Assigned by / time</th></tr></thead>
          <tbody>{data.assignments.map(assignment => {
            const episode = data.episodes.find(item => item.id === assignment.admissionId);
            return <tr key={assignment.id}>
              <td>{episode?.name}<p>{episode?.ipCode ?? assignment.admissionId} · {data.nurses.find(nurse => nurse.id === assignment.nurseId)?.name ?? assignment.nurseId}</p>{episode && <p className="caption">{episode.bedLabel}</p>}</td>
              <td>{assignment.authority}<p>{assignment.reason}</p>
                {assignment.revokedAt ? <><p className="status">REVOKED</p><p>{assignment.revocationReason} · {assignment.revokedBy} · <HospitalTimestamp value={assignment.revokedAt.toISOString()} /></p></> : <details><summary>Revoke nursing responsibility</summary>
                  <CareForm action={saveNursing.bind(null, "", crypto.randomUUID(), "revoke", assignment.id, "", "")} button="Revoke recorded assignment">
                    <CareField label="Revocation authority" name="authority" /><CareField label="Revocation reason" name="reason" />
                    <p className="caption">The nurse must sign any open shift handover first. History and overdue work are retained.</p>
                  </CareForm>
                </details>}
              </td>
              <td>{assignment.assignedBy}<p><HospitalTimestamp value={assignment.assignedAt.toISOString()} /></p></td>
            </tr>;
          })}</tbody>
        </table></div>
        {!data.assignments.length && <p>No recorded nursing assignments.</p>}
      </section>
      <section className="card"><h2>Record nursing assignment</h2><p className="caption">Choose an active admission and nurse account, then record scheduling authority and reason. Current staff access is rechecked when saved.</p>
        {data.episodes.length && data.nurses.length ? <CareForm action={saveNursing.bind(null, "", crypto.randomUUID(), "assign", "", "", "")} button="Record nursing assignment">
          <label>Admission<select name="admissionId">{data.episodes.map(episode => <option value={episode.id} key={episode.id}>{episode.name} · {episode.ipCode} · {episode.bedLabel}</option>)}</select></label>
          <label>Nurse<select name="nurseId">{data.nurses.map(nurse => <option value={nurse.id} key={nurse.id}>{nurse.name}</option>)}</select></label>
          <CareField label="Scheduling authority" name="authority" /><CareField label="Assignment reason" name="reason" />
        </CareForm> : <p>No active admission or nurse account available.</p>}
      </section>
    </div>
  </>;
}
