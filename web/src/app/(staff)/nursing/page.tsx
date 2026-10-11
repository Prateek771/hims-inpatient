import { HospitalTimestamp } from "@/components/hospital-timestamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { getCare } from "@/server/clinical/commands";
import { DomainError } from "@/server/contracts";
import { CareField, CareForm } from "@/components/care-forms";
import { saveNursing } from "./actions";
import { TransferTimeline } from "@/components/transfer-timeline";
import { hospitalTimeConfiguration } from "@/server/hospital-time";
import { formatHospitalTime } from "@/lib/hospital-time";
import { WorkflowTabs } from "@/components/workflow-tabs";
import { StaffAlerts, StaffWorklist, WorkTimestamp } from "@/components/staff-dashboard";
import { getStaffWorklist } from "@/server/overview";

type CareChart = Awaited<ReturnType<typeof getCare>>;

export default async function NursingPage({
  searchParams,
}: {
  searchParams: Promise<{ admissionId?: string; tab?: string }>;
}) {
  const staff = await requireStaff();
  if (!["NURSE", "DOCTOR"].includes(staff.role)) notFound();
  const { timezone } = await hospitalTimeConfiguration();
  const ctx = staffContext(staff, "nursing-view");
  const work = await getStaffWorklist(ctx);
  const currentWork = { ...work, episodes: work.episodes.filter(e => ["PENDING", "ADMITTED"].includes(e.status)) };
  const historyWork = { ...work, episodes: work.episodes.filter(e => !["PENDING", "ADMITTED"].includes(e.status)) };
  const { admissionId, tab } = await searchParams;
  let chart: Awaited<ReturnType<typeof getCare>> | undefined;
  if (admissionId)
    try {
      chart = await getCare(ctx, admissionId);
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN")
        notFound();
      throw error;
    }
  const shiftCharts = !chart && staff.role === "NURSE"
    ? (await Promise.all(currentWork.episodes.filter(e => e.status === "ADMITTED").map(async episode => {
        try { return await getCare(ctx, episode.id); }
        catch (error) {
          // A revoked assignment must remove the chart from this current queue.
          if (error instanceof DomainError && error.code === "FORBIDDEN") return undefined;
          throw error;
        }
      }))).filter((c): c is CareChart => !!c && c.episode.status === "ADMITTED")
    : [];
  const openShifts = shiftCharts.flatMap(c => c.shifts.filter(s => s.nurseId === staff.id && !s.endedAt).map(s => ({ chart: c, shift: s })));
  const prescribedWork = shiftCharts.flatMap(c => c.occurrences
    .filter(o => !["RECORDED", "STOPPED"].includes(o.status))
    .map(o => ({ chart: c, occurrence: o, order: c.orders.find(order => order.id === o.orderId)! })))
    .filter(task => ["MEDICINE", "VITALS"].includes(task.order.kind))
    .sort((a, b) => a.occurrence.scheduledAt.getTime() - b.occurrence.scheduledAt.getTime() || a.occurrence.id.localeCompare(b.occurrence.id));
  const asOf = new Date(work.asOf).getTime();
  const dueWork = prescribedWork.filter(task => task.occurrence.scheduledAt.getTime() <= asOf);
  const nextWork = prescribedWork.filter(task => task.occurrence.scheduledAt.getTime() > asOf);
  const dietWork = shiftCharts.flatMap(c => c.orders.filter(o => o.kind === "DIET" && c.tasks.some(t => t.orderId === o.id && t.status === "PENDING")).map(order => ({ chart: c, order })))
    .sort((a, b) => a.order.signedAt.getTime() - b.order.signedAt.getTime() || a.order.id.localeCompare(b.order.id));
  const transferWork = shiftCharts.flatMap(c => c.transferOrders.filter(o => ["PENDING", "WITNESSED"].includes(o.status) || o.pendingFactualMove).map(order => ({ chart: c, order })))
    .sort((a, b) => a.order.signedAt.getTime() - b.order.signedAt.getTime() || a.order.id.localeCompare(b.order.id));
  const handoverWork = shiftCharts.filter(c => !c.shifts.some(s => s.nurseId === staff.id && !s.endedAt));
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
                  <HospitalTimestamp value={s.startedAt.toISOString()}/> →{" "}
                  {s.endedAt ? <HospitalTimestamp value={s.endedAt.toISOString()} /> : "in progress"}
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
    const hasOwnShift = c.shifts.some(s => s.nurseId === staff.id);
    const occurrences = c.occurrences.filter(
      (o) => c.orders.find((order) => order.id === o.orderId)?.kind === kind,
    );
    return (
      <div className="table-scroll" tabIndex={0} role="region" aria-label={kind === "MEDICINE" ? "Prescribed medicine occurrences" : "Prescribed observation occurrences"}>
        {writable && !hasOwnShift && <p className="notice">Start your assigned attendance in Handover before recording actual care. Late entries require your own recorded shift covering the actual time.</p>}
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
                <tr key={o.id} id={`occurrence-${o.id}`}>
                  <td>
                    <HospitalTimestamp value={o.scheduledAt.toISOString()}/>
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
                          <HospitalTimestamp value={mar.actualAt.toISOString()}/> · {mar.actualDose}{" "}
                          {mar.doseUnit}
                        </p>
                        <p>{mar.reason}</p>
                        <p className="caption">
                          Nurse signature ·{" "}
                          {c.actors[mar.signedBy] ?? mar.signedBy} ·{" "}
                          <HospitalTimestamp value={mar.signedAt.toISOString()}/>
                        </p>
                      </div>
                    ) : reading ? (
                      <div data-testid="observation-history">
                        <p><HospitalTimestamp value={reading.observedAt.toISOString()}/></p>
                        {Object.entries(reading.values).map(([name, value]) => (
                          <p key={name}>
                            {name}: {value}
                          </p>
                        ))}
                        <p className="caption">
                          Nurse signature ·{" "}
                          {c.actors[reading.signedBy] ?? reading.signedBy} ·{" "}
                          <HospitalTimestamp value={reading.signedAt.toISOString()}/>
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
  function taskCards(tasks: typeof prescribedWork) {
    return tasks.map(({ chart: patient, occurrence, order }) => <article className="nursing-task-card" key={occurrence.id} data-testid="shift-prescribed-task" data-scheduled-at={occurrence.scheduledAt.toISOString()}>
      <h3>{patient.identity.name} · {patient.identity.bedLabel}</h3>
      <p>{order.kind === "MEDICINE" ? "Medicine" : "Observation"} · {order.requestedItem}</p>
      <p className="caption">Scheduled <HospitalTimestamp value={occurrence.scheduledAt.toISOString()} /></p>
      <Link className="button quiet" href={`/nursing?admissionId=${patient.episode.id}&tab=${order.kind === "MEDICINE" ? "medicines" : "observations"}#occurrence-${occurrence.id}`}>Open care task</Link>
    </article>);
  }
  return (
    <>
      <p className="eyebrow">{staff.role === "NURSE" ? "Nurse · assigned care" : "Doctor · read-only nursing evidence"}</p>
      <h1>{chart ? "Nursing record" : staff.role === "NURSE" ? "My shift" : "Nursing records"}</h1>
      <p className="page-description">{staff.role === "NURSE" ? "Your assigned care, ordered by the time it needs attention." : "Read the recorded care. Nursing entries remain signed by the nurse."}</p>
      <WorkTimestamp work={work} />
      {!chart ? (
        <>
          {staff.role === "NURSE" && <>
            <section className="nursing-shift-summary">
              <h2>{staff.name} · {openShifts.length ? `${openShifts.length} active patient attendance records` : "No current attendance recorded"}</h2>
              <p>{shiftCharts.length} current assigned patients. Start or review attendance in each patient’s Handover tab.</p>
              {openShifts.map(({ chart: patient, shift }) => <p className="caption" key={shift.id}>{patient.identity.name} · since <HospitalTimestamp value={shift.startedAt.toISOString()} /> · <Link href={`/nursing?admissionId=${patient.episode.id}&tab=handover`}>Attendance &amp; handover</Link></p>)}
            </section>
            <div className="nursing-task-board">
              <section className="nursing-task-lane nursing-task-due"><h2>Due now</h2>{taskCards(dueWork)}{!dueWork.length && <p>No prescribed occurrences due at this evaluation.</p>}</section>
              <section className="nursing-task-lane nursing-task-next"><h2>Next care</h2>{taskCards(nextWork)}
                {dietWork.map(({ chart: patient, order }) => <article className="nursing-task-card" key={order.id}><h3>{patient.identity.name} · {patient.identity.bedLabel}</h3><p>Diet · {order.requestedItem}</p><p className="caption">No prescribed time. Review the recorded clinician instruction.</p><Link className="button quiet" href={`/nursing?admissionId=${patient.episode.id}&tab=observations`}>Open diet task</Link></article>)}
                {!nextWork.length && !dietWork.length && <p>No later prescribed occurrences or pending diet tasks.</p>}
              </section>
              <section className="nursing-task-lane nursing-task-handover"><h2>Handover &amp; move</h2>
                {handoverWork.map(patient => <article className="nursing-task-card" key={patient.episode.id}><h3>{patient.identity.name} · {patient.identity.bedLabel}</h3><p>Start actual assigned attendance and incoming handover.</p><Link className="button quiet" href={`/nursing?admissionId=${patient.episode.id}&tab=handover`}>Open handover</Link></article>)}
                {transferWork.map(({ chart: patient, order }) => <article className="nursing-task-card" key={order.id}><h3>{patient.identity.name} · {patient.identity.bedLabel}</h3><p>Doctor transfer decision {order.version} · {order.destinationCategory} · <span className="status">{order.status}</span></p><p className="caption">Signed <HospitalTimestamp value={order.signedAt.toISOString()} /></p><Link className="button quiet" href={`/nursing?admissionId=${patient.episode.id}&tab=transfer`}>Open transfer work</Link></article>)}
                {!handoverWork.length && !transferWork.length && <p>No outstanding attendance start or Doctor transfer decision.</p>}
              </section>
            </div>
          </>}
          <div className="care-columns">
            <StaffWorklist work={currentWork} title="Assigned patients" />
            <aside className="staff-alerts-compact"><StaffAlerts work={work} /><section className="card"><h2>{staff.role === "NURSE" ? "Discharge nursing review" : "Doctor clinical work"}</h2><p>{staff.role === "NURSE" ? "The Nursing gate follows current Doctor and Pharmacy clearances. Monitoring continues until clinical instructions or actual departure." : "Clinical signatures belong in the Doctor patient chart."}</p><Link className="button secondary" href={staff.role === "NURSE" ? "/discharge" : "/clinical"}>{staff.role === "NURSE" ? "Review my nursing gate" : "Open my patients"}</Link><Link href="/exceptions">Open authorized exception follow-up</Link></section></aside>
          </div>
          {historyWork.episodes.length > 0 && <details className="card work-history"><summary>Retained patient history · {historyWork.episodes.length} episodes</summary><StaffWorklist work={historyWork} title="Retained patient history" /></details>}
        </>
      ) : (
        <>
          <Link className="button secondary" href={staff.role === "NURSE" ? "/nursing" : `/clinical?admissionId=${chart.episode.id}`}>{staff.role === "NURSE" ? "All my shift work" : "Open doctor notes"}</Link>
          <section className="care-patient-context">
            <div><h2>{chart.identity.name} · {chart.identity.uhid}</h2><p>{chart.episode.ipCode} · {chart.identity.bedLabel} · <span className="status">{chart.episode.status}</span></p></div>
            <div><p>{chart.identity.doctor} · Admitting doctor</p><p className="caption">Admitted <HospitalTimestamp value={chart.episode.admittedAt?.toISOString()} /></p></div>
          </section>
          {staff.role === "DOCTOR" && <p className="notice">Read only. Nursing actions and signatures belong to the assigned nurse.</p>}
          {chart.episode.status !== "ADMITTED" && <p className="notice">Retained care history. After actual departure, original attendance closure and source amendments belong to the authorized Exceptions workflow.</p>}
          <div className="billing-metrics">
            {[
              ["Current shift", currentShift ? formatHospitalTime(currentShift.startedAt, timezone) : "No current shift"],
              ["Signed readings", chart.observations.length],
              ["Medication outcomes", chart.administrations.length],
              ["Overdue work", chart.occurrences.filter(o => o.status === "OVERDUE").length],
            ].map(([label, value]) => <section className="card metric" key={label}><p>{label}</p><strong className="care-metric">{value}</strong></section>)}
          </div>
          <WorkflowTabs key={chart.episode.id} id="nursing-chart" initialTab={tab} items={[
            { id: "observations", label: "Observations", children: <div className="care-columns"><div><section className="card">
                <h2>Prescribed observations</h2>
                {outcomes("VITALS")}
              </section></div><aside><section className="card">
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
                {!chart.orders.some(o => o.kind === "DIET") && <p>No recorded diet instruction for this admission.</p>}
              </section></aside></div> },
            { id: "medicines", label: "Medicines", children: <section className="card">
                <h2>Medication administration record</h2>
                <p>
                  Record given, held or refused against the doctor’s exact
                  occurrence. Medicine issue is billed by pharmacy.
                </p>
                {outcomes("MEDICINE")}
              </section> },
            { id: "handover", label: "Handover", children: <section className="card">
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
                      <HospitalTimestamp value={currentShift.startedAt.toISOString()}/>.
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
                      <HospitalTimestamp value={s.startedAt.toISOString()}/> →{" "}
                      {s.endedAt ? <HospitalTimestamp value={s.endedAt.toISOString()} /> : "In progress"}
                    </p>
                    <p>{s.handover}</p>
                    {s.attendanceEndKind==="ADMIN"&&<p className="notice">Administrator recorded actual attendance end: {s.operationalEndEvidence}. No Nurse handover signature was supplied.</p>}
                    <p>{s.outgoingHandover}</p>
                    <p className="caption">
                      Nurse signature · {chart.actors[s.signedBy] ?? s.signedBy}{" "}
                      · <HospitalTimestamp value={s.signedAt.toISOString()}/>
                    </p>
                    {s.hours !== undefined && (
                      <p>
                        Recorded attendance: {s.durationMs! / 1000} seconds (
                        {s.hours.toFixed(6)} hours)
                      </p>
                    )}
                  </article>
                ))}
              </section> },
            { id: "consumables", label: "Consumables", children: <section className="card">
                <h2>Actual consumable use &amp; original fee review</h2>
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
                      <HospitalTimestamp value={c.usedAt.toISOString()}/>
                    </p>
                    <p className="caption">
                      Source bed {chart.stays.find(s => s.id === c.stayId)?.bedLabel ?? c.bedId} · stay {c.stayId} ·{" "}
                      {chart.actors[c.signedBy] ?? c.signedBy} · signed <HospitalTimestamp value={c.signedAt.toISOString()} />
                    </p>
                  </article>
                ))}
                {chart.billing.map((b) => (
                  <article className="care-entry" key={b.id}>
                    <p>
                      {b.itemId} · {b.state}
                    </p>
                    <p>{b.resolutionReason}</p>
                    <p className="caption">Original source {b.id} · {b.quantity} {b.unit} · recorded <HospitalTimestamp value={b.createdAt.toISOString()} /></p>
                    {b.tariffVersionId && <p className="caption">Pinned price version {b.tariffVersionId}</p>}
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
                {!chart.consumables.length && <p>No recorded consumable use yet.</p>}
                {!chart.billing.length && <p>No consumable billing sources recorded.</p>}
              </section> },
            { id: "transfer", label: "Transfer", children: <div className="care-columns"><div><section className="card">
                <h2>Transfer &amp; actual handover</h2>
                {!chart.transferOrders.some(o => o.status === "PENDING") && <p>No current doctor transfer order. Clinical authority is required before a bed move.</p>}
                {chart.transferOrders.filter(o => o.status === "PENDING").map(o => {
                  const targets = chart.transferBeds.filter(b => b.available && b.category === o.destinationCategory);
                  return <article className="care-entry" key={o.id}>
                    <p>Decision {o.version} · {o.destinationCategory} · {o.reason}</p>
                    <p className="caption">Doctor signature · {chart.actors[o.signedBy]} · <HospitalTimestamp value={o.signedAt.toISOString()}/></p>
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
              </section></div><aside><TransferTimeline chart={chart} /><p className="notice">Witnessed or earlier factual moves need their authorized correction route.</p><Link href={`/exceptions?admissionId=${chart.episode.id}`}>Open factual transfer exception</Link></aside></div> },
            { id: "corrections", label: "Corrections", children: <section className="card">
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
                            Medicine outcome · <HospitalTimestamp value={m.actualAt.toISOString()}/> ·{" "}
                            {m.outcome}
                          </option>
                        ))}
                        {chart.observations.map((v) => (
                          <option value={`OBSERVATION|${v.id}`} key={v.id}>
                            Reading · <HospitalTimestamp value={v.observedAt.toISOString()}/>
                          </option>
                        ))}
                        {chart.shifts.map((s) => (
                          <option value={`SHIFT|${s.id}`} key={s.id}>
                            Shift and handover · <HospitalTimestamp value={s.startedAt.toISOString()}/>
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
            {!chart.nursingAddenda.length && <p>No signed nursing corrections yet. An addendum retains the original record and its signing history.</p>}
            {chart.nursingAddenda.map((a) => (
              <article key={a.id} className="care-entry">
                <p>
                  {a.recordType} · original {a.recordId}
                </p>
                <p>{a.text}</p>
                <p className="caption">
                  {a.reason} · {chart.actors[a.signedBy] ?? a.signedBy} ·{" "}
                  <HospitalTimestamp value={a.signedAt.toISOString()}/>
                </p>
              </article>
            ))}
          </section> },
          ]} />
          <section className="notice">
            <h2>Missed tasks stay visible</h2>
            <p>
              Prescribed occurrences remain linked to the admission across
              shifts. Financial nursing clearance does not stop monitoring. Only
              explicit clinical instructions or physical departure change
              ongoing care.
            </p>
          </section>
          <section className="card"><h2>Next human review</h2><p>Financial Nursing clearance does not stop monitoring.</p><Link className="button secondary" href={`/discharge?admissionId=${chart.episode.id}`}>Review discharge clearance</Link><Link href={`/exceptions?admissionId=${chart.episode.id}`}>Open authorized exception follow-up</Link></section>
          <details className="staff-alerts-compact work-history"><summary>Current source alerts · {work.alerts.length}</summary><StaffAlerts work={work} /></details>
        </>
      )}
    </>
  );
}
