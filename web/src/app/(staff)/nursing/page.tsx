import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { careWorkspace, getCare } from "@/server/clinical/commands";
import { DomainError } from "@/server/contracts";
import { CareField, CareForm } from "@/components/care-forms";
import { saveNursing } from "./actions";
import { TransferTimeline } from "@/components/transfer-timeline";

export default async function NursingPage({
  searchParams,
}: {
  searchParams: Promise<{ admissionId?: string }>;
}) {
  const staff = await requireStaff();
  if (!["NURSE", "DOCTOR"].includes(staff.role)) notFound();
  const ctx = staffContext(staff, "nursing-view");
  const workspace = await careWorkspace(ctx);
  const { admissionId } = await searchParams;
  let chart: Awaited<ReturnType<typeof getCare>> | undefined;
  if (admissionId)
    try {
      chart = await getCare(ctx, admissionId);
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN")
        notFound();
      throw error;
    }
  const writable =
    staff.role === "NURSE" && chart?.episode.status === "ADMITTED";
  const currentShift = chart?.shifts.find(
    (s) => s.nurseId === staff.id && !s.endedAt,
  );
  function action(
    operation: Parameters<typeof saveNursing>[2],
    targetId = "",
    scheduledAt = "",
  ) {
    return saveNursing.bind(
      null,
      admissionId!,
      crypto.randomUUID(),
      operation,
      targetId,
      currentShift?.id ?? "",
      scheduledAt,
    );
  }
  function shiftChoice() {
    return (
      <>
        <label>
          Documenting own shift
          <select
            name="recordingShiftId"
            defaultValue={currentShift?.id ?? ""}
            required
          >
            <option value="">Choose your own current or ended shift</option>
            {chart?.shifts
              .filter((s) => s.nurseId === staff.id)
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.startedAt.toISOString()} →{" "}
                  {s.endedAt?.toISOString() ?? "in progress"} UTC
                </option>
              ))}
          </select>
        </label>
        <p className="caption">
          For late entry, actual care must fall inside your selected shift and
          before any clinical order stop. The signature records the current entry
          time.
        </p>
      </>
    );
  }
  function outcomes(kind: string) {
    if (!chart) return null;
    const c = chart;
    const occurrences = c.occurrences.filter(
      (o) => c.orders.find((order) => order.id === o.orderId)?.kind === kind,
    );
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Scheduled / instruction</th>
              <th>Actual / status / signature</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.map((o) => {
              const order = c.orders.find((order) => order.id === o.orderId)!;
              const mar = c.administrations.find(
                (a) => a.occurrenceId === o.id,
              );
              const reading = c.observations.find(
                (a) => a.occurrenceId === o.id,
              );
              return (
                <tr key={o.id}>
                  <td>
                    {o.scheduledAt.toISOString()} UTC
                    <p>{order.requestedItem}</p>
                    {kind === "MEDICINE" && (
                      <p>
                        {order.details.dose} {order.details.doseUnit} ·{" "}
                        {order.details.route}
                      </p>
                    )}
                    <p className="caption">{order.id}</p>
                  </td>
                  <td>
                    {mar ? (
                      <div data-testid="mar-history">
                        <span className="status">{mar.outcome}</span>
                        <p>
                          {mar.actualAt.toISOString()} UTC · {mar.actualDose}{" "}
                          {mar.doseUnit}
                        </p>
                        <p>{mar.reason}</p>
                        <p className="caption">
                          Nurse signature ·{" "}
                          {c.actors[mar.signedBy] ?? mar.signedBy} ·{" "}
                          {mar.signedAt.toISOString()} UTC
                        </p>
                      </div>
                    ) : reading ? (
                      <div data-testid="observation-history">
                        <p>{reading.observedAt.toISOString()} UTC</p>
                        {Object.entries(reading.values).map(([name, value]) => (
                          <p key={name}>
                            {name}: {value}
                          </p>
                        ))}
                        <p className="caption">
                          Nurse signature ·{" "}
                          {c.actors[reading.signedBy] ?? reading.signedBy} ·{" "}
                          {reading.signedAt.toISOString()} UTC
                        </p>
                      </div>
                    ) : (
                      <>
                        <span className="status">{o.status}</span>
                        {writable &&
                          c.shifts.some((s) => s.nurseId === staff.id) && (
                            <details>
                              <summary>
                                {kind === "MEDICINE"
                                  ? "Record medication outcome"
                                  : "Record actual readings"}
                              </summary>
                              {kind === "MEDICINE" ? (
                                <CareForm
                                  action={action(
                                    "mar",
                                    order.id,
                                    o.scheduledAt.toISOString(),
                                  )}
                                  button="Sign medication outcome"
                                  testId="mar-form"
                                >
                                  {shiftChoice()}
                                  <CareField
                                    label="Actual time (UTC)"
                                    name="actualAt"
                                    type="datetime-local"
                                  />
                                  <CareField
                                    label="Actual dose"
                                    name="actualDose"
                                    defaultValue={order.details.dose}
                                  />
                                  <input
                                    name="doseUnit"
                                    type="hidden"
                                    value={order.details.doseUnit}
                                  />
                                  <p>Dose unit: {order.details.doseUnit}</p>
                                  <label>
                                    Outcome
                                    <select name="outcome">
                                      <option>GIVEN</option>
                                      <option>HELD</option>
                                      <option>REFUSED</option>
                                    </select>
                                  </label>
                                  <CareField
                                    label="Reason"
                                    name="reason"
                                    required={false}
                                  />
                                  <p className="caption">
                                    Held or refused: enter zero actual dose and
                                    a reason. Changed dose requires a reason.
                                  </p>
                                </CareForm>
                              ) : (
                                <CareForm
                                  action={action(
                                    "observation",
                                    order.id,
                                    o.scheduledAt.toISOString(),
                                  )}
                                  button="Sign actual readings"
                                  testId="observation-form"
                                >
                                  {shiftChoice()}
                                  <CareField
                                    label="Observed at (UTC)"
                                    name="observedAt"
                                    type="datetime-local"
                                  />
                                  {[
                                    ["BP systolic", "bpSystolic"],
                                    ["BP diastolic", "bpDiastolic"],
                                    ["Pulse", "pulse"],
                                    ["Temperature (C)", "temperatureC"],
                                    ["SpO2 (%)", "spo2"],
                                    ["Respiratory rate", "respiratoryRate"],
                                    ["Pain score (0–10)", "painScore"],
                                  ].map(([label, name]) => (
                                    <CareField
                                      label={label}
                                      name={name}
                                      type="number"
                                      required={false}
                                      key={name}
                                    />
                                  ))}
                                </CareForm>
                              )}
                            </details>
                          )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!occurrences.length && (
          <p>
            No {kind === "MEDICINE" ? "ward medicine" : "monitoring"}{" "}
            occurrences prescribed. Clinical instructions determine the
            schedule.
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      <p className="eyebrow">02 · Clinical tracking / Nursing</p>
      <h1>A dependable shift handover</h1>
      <p className="page-description">
        Keep medicines, readings and unfinished tasks visible for the next
        nurse.
      </p>
      <section className="card">
        <h2>Assigned care worklist</h2>
        <details open={!chart}>
          <summary>Choose an admission</summary>
          {workspace.length ? (
            <ul className="patient-results">
              {workspace.map((a) => (
                <li key={a.id}>
                  <Link href={`/nursing?admissionId=${a.id}`}>
                    {a.name} · {a.ipCode} · {a.bedLabel}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No active patients assigned. Hospital administration records
              nursing responsibility before chart access.
            </p>
          )}
        </details>
      </section>
      {chart && (
        <>
          <section className="card">
            <h2>{chart.identity.name}</h2>
            <p>
              {chart.identity.uhid} · {chart.episode.ipCode} ·{" "}
              {chart.identity.bedLabel} ·{" "}
              <span className="status">{chart.episode.status}</span>
            </p>
            <p className="caption">
              Admitted {chart.episode.admittedAt?.toISOString()} UTC ·{" "}
              {chart.identity.doctor}
            </p>
          </section>
          <div className="billing-metrics">
            {[
              [
                "Current shift",
                currentShift
                  ? currentShift.startedAt.toISOString()
                  : "No current shift",
              ],
              ["Signed readings", chart.observations.length],
              ["Medication outcomes", chart.administrations.length],
              [
                "Overdue work",
                chart.occurrences.filter((o) => o.status === "OVERDUE").length,
              ],
            ].map(([label, value]) => (
              <section className="card metric" key={label}>
                <p>{label}</p>
                <strong className="care-metric">{value}</strong>
              </section>
            ))}
          </div>
          <div className="care-columns">
            <div>
              <section className="card">
                <h2>Medication administration record</h2>
                <p>
                  Record given, held or refused against the doctor’s exact
                  occurrence. Medicine issue is billed by pharmacy.
                </p>
                {outcomes("MEDICINE")}
              </section>
              <section className="card">
                <h2>Prescribed observations</h2>
                {outcomes("VITALS")}
              </section>
              <section className="card">
                <h2>Diet instructions</h2>
                {chart.orders
                  .filter((o) => o.kind === "DIET")
                  .map((o) => (
                    <article className="care-entry" key={o.id}>
                      <p>
                        {o.requestedItem} ·{" "}
                        {chart.tasks.find((t) => t.orderId === o.id)?.status}
                      </p>
                      {writable &&
                        chart.tasks.find((t) => t.orderId === o.id)?.status ===
                          "PENDING" && (
                          <CareForm
                            action={action("diet", o.id)}
                            button="Record diet task completion"
                          >
                            <CareField
                              label="Completion reason"
                              name="reason"
                            />
                          </CareForm>
                        )}
                    </article>
                  ))}
              </section>
            </div>
            <aside>
              <section className="card">
                <h2>Transfer &amp; actual handover</h2>
                {!chart.transferOrders.some(o => o.status === "PENDING") && <p>No current doctor transfer order. Clinical authority is required before a bed move.</p>}
                {chart.transferOrders.filter(o => o.status === "PENDING").map(o => {
                  const targets = chart.transferBeds.filter(b => b.available && b.category === o.destinationCategory);
                  return <article className="care-entry" key={o.id}>
                    <p>Decision {o.version} · {o.destinationCategory} · {o.reason}</p>
                    <p className="caption">Doctor signature · {chart.actors[o.signedBy]} · {o.signedAt.toISOString()} UTC</p>
                    {!currentShift && <p>Start your assigned shift before signing an actual transfer handover.</p>}
                    {!targets.length && <p>No available target bed in the clinician-selected category. Availability is checked again when saving.</p>}
                    {writable && currentShift && targets.length > 0 && <CareForm action={action("transfer", o.id)} button="Sign handover and transfer" testId="transfer-form">
                      <label>Available target bed<select name="targetBedId" required>{targets.map(b => <option value={b.id} key={b.id}>{b.label} · {b.category}</option>)}</select></label>
                      <CareField label="Actual transfer time (UTC)" name="transferredAt" type="datetime-local" />
                      <label>Actual transfer handover<textarea name="handover" required /></label>
                      <p className="caption">Enter the actual move time after the doctor order, inside your shift and no later than now. Earlier committed room charges or recorded care require the correction workflow.</p>
                    </CareForm>}
                  </article>;
                })}
              </section>
              <TransferTimeline chart={chart} />
              <section className="card">
                <h2>Attendance &amp; handover</h2>
                {writable && !currentShift && (
                  <CareForm
                    action={action("start")}
                    button="Start assigned shift"
                    testId="shift-start"
                  >
                    <CareField
                      label="Shift start (UTC)"
                      name="startedAt"
                      type="datetime-local"
                    />
                    <label>
                      Incoming handover
                      <textarea name="handover" required />
                    </label>
                  </CareForm>
                )}
                {writable && currentShift && (
                  <CareForm
                    action={action("end")}
                    button="Sign handover and end shift"
                    testId="shift-end"
                  >
                    <p>
                      Current attendance starts{" "}
                      {currentShift.startedAt.toISOString()} UTC.
                    </p>
                    <CareField
                      label="Shift end (UTC)"
                      name="endedAt"
                      type="datetime-local"
                    />
                    <label>
                      Outgoing handover
                      <textarea name="handover" required />
                    </label>
                  </CareForm>
                )}
                {chart.shifts.map((s) => (
                  <article className="care-entry" key={s.id}>
                    <p>
                      {s.startedAt.toISOString()} →{" "}
                      {s.endedAt?.toISOString() ?? "In progress"} UTC
                    </p>
                    <p>{s.handover}</p>
                    {s.attendanceEndKind==="ADMIN"&&<p className="notice">Administrator recorded actual attendance end: {s.operationalEndEvidence}. No Nurse handover signature was supplied.</p>}
                    <p>{s.outgoingHandover}</p>
                    <p className="caption">
                      Nurse signature · {chart.actors[s.signedBy] ?? s.signedBy}{" "}
                      · {s.signedAt.toISOString()} UTC
                    </p>
                    {s.hours !== undefined && (
                      <p>
                        Recorded attendance: {s.durationMs! / 1000} seconds (
                        {s.hours.toFixed(6)} hours)
                      </p>
                    )}
                  </article>
                ))}
              </section>
              <section className="card">
                <h2>Consumable use</h2>
                {writable && currentShift && (
                  <CareForm
                    action={action("consumable")}
                    button="Record actual consumable use"
                  >
                    <CareField
                      label="Used at (UTC)"
                      name="usedAt"
                      type="datetime-local"
                    />
                    <CareField label="Consumable item code" name="itemId" />
                    <CareField label="Used quantity" name="quantity" />
                    <CareField label="Used unit" name="unit" />
                    <CareField label="Use reason" name="reason" />
                  </CareForm>
                )}
                {chart.consumables.map((c) => (
                  <article className="care-entry" key={c.id}>
                    <p>
                      {c.itemId} · {c.quantity} {c.unit} ·{" "}
                      {c.usedAt.toISOString()} UTC
                    </p>
                    <p className="caption">
                      Source bed {c.bedId} · stay {c.stayId} ·{" "}
                      {chart.actors[c.signedBy] ?? c.signedBy}
                    </p>
                  </article>
                ))}
                {chart.billing.map((b) => (
                  <article className="care-entry" key={b.id}>
                    <p>
                      {b.itemId} · {b.state}
                    </p>
                    <p>{b.resolutionReason}</p>
                    {writable && b.state === "UNRESOLVED" && (
                      <CareForm
                        action={action("billing", b.id)}
                        button="Resolve consumable billing source"
                      >
                        <CareField label="Resolution reason" name="reason" />
                      </CareForm>
                    )}
                  </article>
                ))}
              </section>
              {staff.role === "DOCTOR" && (
                <Link
                  className="button secondary"
                  href={`/clinical?admissionId=${chart.episode.id}`}
                >
                  Open doctor notes
                </Link>
              )}
            </aside>
          </div>
          <section className="card">
            <h2>Nursing corrections</h2>
            {writable &&
              chart.shifts.length +
                chart.administrations.length +
                chart.observations.length +
                chart.consumables.length >
                0 && (
                <details>
                  <summary>Add a signed correction</summary>
                  <CareForm
                    action={action("addendum")}
                    button="Sign nursing addendum"
                  >
                    <label>
                      Original nursing record
                      <select name="record">
                        {chart.administrations.map((m) => (
                          <option value={`MAR|${m.id}`} key={m.id}>
                            Medicine outcome · {m.actualAt.toISOString()} ·{" "}
                            {m.outcome}
                          </option>
                        ))}
                        {chart.observations.map((v) => (
                          <option value={`OBSERVATION|${v.id}`} key={v.id}>
                            Reading · {v.observedAt.toISOString()}
                          </option>
                        ))}
                        {chart.shifts.map((s) => (
                          <option value={`SHIFT|${s.id}`} key={s.id}>
                            Shift and handover · {s.startedAt.toISOString()}
                          </option>
                        ))}
                        {chart.consumables.map((c) => (
                          <option value={`CONSUMABLE|${c.id}`} key={c.id}>
                            Consumable use · {c.itemId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <CareField label="Correction reason" name="reason" />
                    <label>
                      Addendum text
                      <textarea name="text" required />
                    </label>
                  </CareForm>
                </details>
              )}
            {chart.nursingAddenda.map((a) => (
              <article key={a.id} className="care-entry">
                <p>
                  {a.recordType} · original {a.recordId}
                </p>
                <p>{a.text}</p>
                <p className="caption">
                  {a.reason} · {chart.actors[a.signedBy] ?? a.signedBy} ·{" "}
                  {a.signedAt.toISOString()} UTC
                </p>
              </article>
            ))}
          </section>
          <section className="notice">
            <h2>Missed tasks stay visible</h2>
            <p>
              Prescribed occurrences remain linked to the admission across
              shifts. Financial nursing clearance does not stop monitoring. Only
              explicit clinical instructions or physical departure change
              ongoing care.
            </p>
          </section>
        </>
      )}
    </>
  );
}
