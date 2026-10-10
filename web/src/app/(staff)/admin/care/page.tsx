import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { requireStaff, staffContext } from "@/server/access";
import { assignmentWorkspace } from "@/server/nursing/commands";
import { CareField, CareForm } from "@/components/care-forms";
import { saveNursing } from "../../nursing/actions";
export default async function CareAssignments() {
  const staff = await requireStaff();
  const data = await assignmentWorkspace(
    staffContext(staff, "nursing-assignment-view"),
  );
  return (
    <>
      <p className="eyebrow">Hospital administration / Ward responsibility</p>
      <h1>Nursing assignments</h1>
      <p className="page-description">
        Assign operational responsibility with a reason and authority. Clinical
        signatures belong to the treating professionals.
      </p>
      <section className="card">
        <h2>Assign a nurse to an active admission</h2>
        {data.episodes.length && data.nurses.length ? (
          <CareForm
            action={saveNursing.bind(
              null,
              "",
              crypto.randomUUID(),
              "assign",
              "",
              "",
              "",
            )}
            button="Record nursing assignment"
          >
            <label>
              Admission
              <select name="admissionId">
                {data.episodes.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name} · {e.ipCode} · {e.bedLabel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nurse
              <select name="nurseId">
                {data.nurses.map((n) => (
                  <option value={n.id} key={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <CareField label="Scheduling authority" name="authority" />
            <CareField label="Assignment reason" name="reason" />
          </CareForm>
        ) : (
          <p>No active admission or nurse account available.</p>
        )}
      </section>
      <section className="card">
        <h2>Recorded responsibility</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Admission / nurse</th>
                <th>Authority / reason</th>
                <th>Assigned by / time</th>
              </tr>
            </thead>
            <tbody>
              {data.assignments.map((a) => (
                <tr key={a.id}>
                  <td>
                    {data.episodes.find((e) => e.id === a.admissionId)
                      ?.ipCode ?? a.admissionId}{" "}
                    ·{" "}
                    {data.nurses.find((n) => n.id === a.nurseId)?.name ??
                      a.nurseId}
                  </td>
                  <td>
                    {a.authority}
                    <p>{a.reason}</p>
                    {a.revokedAt ? (
                      <>
                        <p className="status">REVOKED</p>
                        <p>
                          {a.revocationReason} · {a.revokedBy} ·{" "}
                          <HospitalTimestamp value={a.revokedAt.toISOString()}/>
                        </p>
                      </>
                    ) : (
                      <details>
                        <summary>Revoke nursing responsibility</summary>
                        <CareForm
                          action={saveNursing.bind(
                            null,
                            "",
                            crypto.randomUUID(),
                            "revoke",
                            a.id,
                            "",
                            "",
                          )}
                          button="Revoke recorded assignment"
                        >
                          <CareField
                            label="Revocation authority"
                            name="authority"
                          />
                          <CareField label="Revocation reason" name="reason" />
                          <p className="caption">
                            The nurse must sign any open shift handover first.
                            History and overdue work are retained.
                          </p>
                        </CareForm>
                      </details>
                    )}
                  </td>
                  <td>
                    {a.assignedBy}
                    <p><HospitalTimestamp value={a.assignedAt.toISOString()}/></p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
