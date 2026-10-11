import { HospitalTimestamp } from "@/components/hospital-timestamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import {
  clinicalMedicineCatalog,
  getCare,
} from "@/server/clinical/commands";
import { listBillableItems } from "@/server/billing/commands";
import { DomainError } from "@/server/contracts";
import { CareField, CareForm, RoundForm } from "@/components/care-forms";
import { saveClinical } from "./actions";
import { TransferTimeline } from "@/components/transfer-timeline";
import { WorkflowTabs } from "@/components/workflow-tabs";
import { StaffAlerts, StaffWorklist, WorkTimestamp } from "@/components/staff-dashboard";
import { getStaffWorklist } from "@/server/overview";

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams: Promise<{ admissionId?: string; tab?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "DOCTOR") notFound();
  const ctx = staffContext(staff, "clinical-view");
  const work = await getStaffWorklist(ctx);
  const currentWork = { ...work, episodes: work.episodes.filter(e => ["PENDING", "ADMITTED"].includes(e.status)) };
  const historyWork = { ...work, episodes: work.episodes.filter(e => !["PENDING", "ADMITTED"].includes(e.status)) };
  const { admissionId, tab } = await searchParams;
  let chart: Awaited<ReturnType<typeof getCare>> | undefined;
  if (admissionId)
    try {
      chart = await getCare(ctx, admissionId);
    } catch (e) {
      if (e instanceof DomainError && e.code === "FORBIDDEN") notFound();
      throw e;
    }
  const items = chart
    ? (
        await Promise.all(
          (["consultation", "procedure", "lab", "radiology"] as const).map(
            (kind) => listBillableItems(ctx, kind),
          ),
        )
      )
        .flat()
        .map((i) => ({
          itemId: i.itemId,
          name: i.name,
          category: i.category,
          unit: i.unit,
        }))
    : [];
  const medicines = chart ? await clinicalMedicineCatalog(ctx) : [];
  const active = chart?.episode.status === "ADMITTED";
  function action(
    operation: Parameters<typeof saveClinical>[2],
    targetId = "",
    version = 0,
  ) {
    return saveClinical.bind(
      null,
      admissionId!,
      crypto.randomUUID(),
      operation,
      targetId,
      version,
    );
  }
  return (
    <>
      <p className="eyebrow">Doctor · admitting-doctor episodes</p>
      <h1>{chart ? "Patient chart" : "Patients"}</h1>
      <p className="page-description">Your assigned patients, signed care and the next clinical work.</p>
      <WorkTimestamp work={work} />
      {!chart ? (
        <>
          <div className="care-work-metrics">
            {[
              ["My patients", currentWork.episodes.filter(e => e.status === "ADMITTED").length, "Current admitted episodes under you"],
              ["Care needs attention", work.alerts.filter(a => a.kind !== "PENDING_SEAL").length, "Current authorized care sources"],
              ["Discharge reviews", work.alerts.filter(a => a.kind === "PENDING_SEAL").length, "Your next human Doctor gate"],
            ].map(([label, value, help]) => <section className="card metric" key={label}><p>{label}</p><strong>{value}</strong><p className="caption">{help}</p></section>)}
          </div>
          <div className="care-columns">
            <StaffWorklist work={currentWork} title="My current patients" />
            <aside className="staff-alerts-compact"><StaffAlerts work={work} /></aside>
          </div>
          <details className="card work-history"><summary>Retained patient history · {historyWork.episodes.length} episodes</summary><StaffWorklist work={historyWork} title="Retained patient history" /></details>
        </>
      ) : (
        <>
          <Link className="button secondary" href="/clinical">All my patients</Link>
          <section className="care-patient-context">
            <div><h2>{chart.identity.name} · {chart.identity.uhid}</h2><p>{chart.episode.ipCode} · {chart.identity.bedLabel} · <span className="status">{chart.episode.status}</span></p></div>
            <div><p>{chart.identity.doctor} · Admitting doctor</p><p className="caption">Admitted <HospitalTimestamp value={chart.episode.admittedAt?.toISOString()} /></p></div>
          </section>
          {chart.episode.status === "PENDING" ? <p className="notice">Pending reservation awaiting actual arrival. Admission or Admin must record the arrival and activate the admission before care signatures are available.</p> : !active && <p className="notice">Retained patient history. New care signatures require an active admission; authorized later corrections belong to Exceptions.</p>}
          <WorkflowTabs key={chart.episode.id} id="doctor-chart" initialTab={tab} items={[
            { id: "rounds", label: "Rounds", children: <div className="care-columns"><div><section className="card">
                <h2>Record this round</h2>
                {active && (
                  <details open={!chart.rounds.length}>
                    <summary>Record a new round</summary>
                    <RoundForm
                      action={action("round")}
                      items={items}
                      medicines={medicines}
                    />
                  </details>
                )}
                </section></div><aside><section className="card"><h2>Signed care history</h2><p className="caption">Original rounds and signed corrections retain their author and time.</p>{chart.rounds.map((r) => (
                  <article
                    className="care-entry"
                    key={r.id}
                    data-testid="round-entry"
                  >
                    <p className="caption">
                      Clinical signature ·{" "}
                      {chart.actors[r.signedBy] ?? r.signedBy} ·{" "}
                      <HospitalTimestamp value={r.signedAt.toISOString()}/>
                    </p>
                    <p>{r.notes}</p>
                    {chart.addenda
                      .filter((a) => a.noteId === r.id)
                      .map((a) => (
                        <div className="notice" key={a.id}>
                          <p>Addendum: {a.text}</p>
                          <p className="caption">
                            {a.reason} ·{" "}
                            {chart.actors[a.signedBy] ?? a.signedBy} ·{" "}
                            <HospitalTimestamp value={a.signedAt.toISOString()}/>
                          </p>
                        </div>
                      ))}
                    {active && (
                      <details>
                        <summary>Add a correction</summary>
                        <CareForm
                          action={action("addendum", r.id)}
                          button="Sign addendum"
                        >
                          <CareField label="Correction reason" name="reason" />
                          <label>
                            Addendum text
                            <textarea name="text" required />
                          </label>
                        </CareForm>
                      </details>
                    )}
                  </article>
                ))}
                {!chart.rounds.length && <p>No signed rounds yet.</p>}
              </section></aside></div> },
            { id: "orders", label: "Orders", children: <div className="care-columns"><div><section className="card">
                <h2>Ordered work</h2>
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Clinical orders">
                  <table>
                    <thead>
                      <tr>
                        <th>Ordered work / instructions</th>
                        <th>Team / clinical status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.orders.map((o) => {
                        const task = chart.tasks.find(
                          (t) => t.orderId === o.id,
                        );
                        return (
                          <tr key={o.id}>
                            <td>
                              {o.requestedItem}
                              <p className="caption">{o.kind}</p>
                              <details><summary>Order reference &amp; signed history</summary>
                                <p className="caption">{o.id} · original round {o.roundId}</p>
                                <p className="caption">Doctor signature · {chart.actors[o.signedBy] ?? o.signedBy} · <HospitalTimestamp value={o.signedAt.toISOString()} /></p>
                                {o.medicineCatalogVersionId && <p className="caption">Medicine identity {o.medicineItemId} · version {o.medicineCatalogVersionId}</p>}
                                {chart.events.filter(e => e.orderId === o.id).map(e => <p className="caption" key={e.id}>{e.status} · {e.reason} · {chart.actors[e.signedBy] ?? e.signedBy} · <HospitalTimestamp value={e.signedAt.toISOString()} /></p>)}
                              </details>
                              {o.kind === "MEDICINE" && (
                                <p>
                                  {o.details.dose} {o.details.doseUnit} ·{" "}
                                  {o.details.route} · {o.details.frequency} ·{" "}
                                  {o.details.durationDays} days ·{" "}
                                  {o.details.medicationPurpose}
                                </p>
                              )}
                              {o.kind === "MEDICINE" && !o.medicineItemId && (
                                <p className="notice">
                                  Medicine identity needs doctor review before
                                  pharmacy preparation. The prescribed medicine
                                  and dispensing unit must match the configured
                                  item.
                                </p>
                              )}
                              {o.details.schedule && (
                                <p className="caption">
                                  From <HospitalTimestamp value={o.details.schedule.startsAt} /> · every{" "}
                                  {o.details.schedule.intervalMinutes} minutes ·{" "}
                                  {o.details.schedule.occurrences} occurrences
                                </p>
                              )}
                            </td>
                            <td>
                              {task?.ownerRole} ·{" "}
                              <span className="status">{task?.status}</span>
                              {active &&
                                task?.status === "PENDING" &&
                                o.kind === "PROCEDURE" && (
                                  <details>
                                    <summary>Record actual completion</summary>
                                    <CareForm
                                      action={action("complete", o.id)}
                                      button="Sign procedure completion"
                                    >
                                      <CareField
                                        label="Completion evidence / reason"
                                        name="reason"
                                      />
                                    </CareForm>
                                  </details>
                                )}
                              {active && task?.status !== "STOPPED" && (
                                <details>
                                  <summary>Stop clinical instructions</summary>
                                  <CareForm
                                    action={action("stop", o.id)}
                                    button="Sign order stop"
                                  >
                                    <CareField
                                      label="Clinical stop reason"
                                      name="reason"
                                    />
                                  </CareForm>
                                </details>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="caption">
                  Medicine issue belongs to pharmacy. Lab/radiology completion
                  belongs to its department. Clinical completion and billing
                  resolution remain separate.
                </p>
              </section><p className="caption">Add new linked orders while recording a signed round in the Rounds tab.</p></div><aside><section className="card">
                <h2>Original fee review</h2><p className="caption">Missing configuration does not mean zero-price care. Clinical completion remains separate.</p>
                {chart.billing.map((b) => (
                  <article className="care-entry" key={b.id}>
                    <h3>
                      {b.itemId} · {b.category}
                    </h3>
                    <p>
                      <span className="status">{b.state}</span> · {b.quantity}{" "}
                      {b.unit}
                    </p>
                    <details><summary>Original fee source</summary><p className="caption">{b.id} · order {b.orderId ?? "—"} · round {b.roundId ?? "—"}</p><p className="caption">Recorded <HospitalTimestamp value={b.createdAt.toISOString()} /></p></details>
                    {b.resolutionReason && <p>{b.resolutionReason}</p>}
                    {b.tariffVersionId && (
                      <p className="caption">
                        Pinned price version {b.tariffVersionId}
                      </p>
                    )}
                    {active && b.state === "UNRESOLVED" && (
                      <CareForm
                        action={action("billing", b.id)}
                        button="Resolve recorded billing source"
                      >
                        <CareField label="Resolution reason" name="reason" />
                      </CareForm>
                    )}
                  </article>
                ))}
                {!chart.billing.length && (
                  <p>
                    No consultation, procedure or test billing sources recorded.
                  </p>
                )}
              </section></aside></div> },
            { id: "nursing", label: "Nursing records", children: <div className="care-columns">
                  <div>
                    <section className="card">
                      <h2>Recorded observations</h2>
                      <p>{chart.observations.length} signed readings · {chart.administrations.length} medication outcomes · {chart.occurrences.filter(o => o.status === "OVERDUE").length} overdue occurrences</p>
                      <p className="caption">Actual signed readings. No automated clinical interpretation.</p>
                      {chart.observations.map(v => <article className="care-entry" key={v.id} data-testid="doctor-observation-history">
                        <h3><HospitalTimestamp value={v.observedAt.toISOString()} /></h3>
                        <p className="caption">Scheduled <HospitalTimestamp value={chart.occurrences.find(o => o.id === v.occurrenceId)?.scheduledAt.toISOString()} /></p>
                        {Object.entries(v.values).map(([name, value]) => <p key={name}>{name}: {value}</p>)}
                        <p className="caption">Nurse signature · {chart.actors[v.signedBy] ?? v.signedBy} · <HospitalTimestamp value={v.signedAt.toISOString()} /></p>
                      </article>)}
                      {!chart.observations.length && <p>No signed readings yet.</p>}
                    </section>
                    <section className="card">
                      <h2>Current shift &amp; handover</h2>
                      {chart.shifts.map(shift => <article className="care-entry" key={shift.id}>
                        <p><HospitalTimestamp value={shift.startedAt.toISOString()} /> → {shift.endedAt ? <HospitalTimestamp value={shift.endedAt.toISOString()} /> : "In progress"}</p>
                        <p>{shift.handover}</p><p>{shift.outgoingHandover}</p>
                        {shift.attendanceEndKind === "ADMIN" && <p className="notice">Administrator recorded actual attendance end: {shift.operationalEndEvidence}. No Nurse handover signature was supplied.</p>}
                        <p className="caption">Nurse signature · {chart.actors[shift.signedBy] ?? shift.signedBy} · <HospitalTimestamp value={shift.signedAt.toISOString()} /></p>
                      </article>)}
                      {!chart.shifts.length && <p>No recorded nursing attendance yet.</p>}
                    </section>
                  </div>
                  <aside>
                    <section className="card">
                      <h2>Medication record</h2>
                      {chart.administrations.map(m => <article className="care-entry" key={m.id} data-testid="doctor-mar-history">
                        <h3>{chart.orders.find(o => o.id === chart.occurrences.find(occurrence => occurrence.id === m.occurrenceId)?.orderId)?.requestedItem}</h3>
                        <p className="caption">Scheduled <HospitalTimestamp value={chart.occurrences.find(o => o.id === m.occurrenceId)?.scheduledAt.toISOString()} /></p>
                        <p><span className="status">{m.outcome}</span> · <HospitalTimestamp value={m.actualAt.toISOString()} /> · {m.actualDose} {m.doseUnit}</p>
                        <p>{m.reason}</p>
                        <p className="caption">Nurse signature · {chart.actors[m.signedBy] ?? m.signedBy} · <HospitalTimestamp value={m.signedAt.toISOString()} /></p>
                      </article>)}
                      {!chart.administrations.length && <p>No signed medicine outcomes yet.</p>}
                      <p className="caption">Pharmacy issue and actual Nurse administration remain separate.</p>
                    </section>
                    <section className="card">
                      <h2>Signed nursing corrections</h2>
                      {chart.nursingAddenda.map(a => <article className="care-entry" key={a.id}>
                        <p>{a.recordType} · original {a.recordId}</p><p>{a.text}</p>
                        <p className="caption">{a.reason} · {chart.actors[a.signedBy] ?? a.signedBy} · <HospitalTimestamp value={a.signedAt.toISOString()} /></p>
                      </article>)}
                      {!chart.nursingAddenda.length && <p>No nursing addenda.</p>}
                      <Link className="button secondary" href={`/nursing?admissionId=${chart.episode.id}`}>Open nursing record</Link>
                      <p className="caption">Read only. Nursing signatures stay with the assigned nurse.</p>
                    </section>
                  </aside>
                </div> },
            { id: "reports", label: "Reports", children: <section className="card">
                <h2>Diagnostic reports for doctor review</h2>
                <p className="caption">Human lab/radiology results. The doctor decides the care plan; a stop does not erase completed evidence.</p>
                {chart.diagnosticReports.map(r=><article className="care-entry" data-testid="doctor-diagnostic-report" key={r.id}><h3>{chart.orders.find(o=>o.id===r.orderId)?.requestedItem}</h3><p>{r.result}</p><p className="caption">Lab signer {chart.actors[r.signedBy]??r.signedBy} · <HospitalTimestamp value={r.signedAt.toISOString()}/></p>{chart.diagnosticAddenda.filter(a=>a.reportId===r.id).map(a=><div key={a.id} className="care-entry"><strong>Addendum · {a.reason}</strong><p>{a.text}</p><p className="caption">{chart.actors[a.signedBy]??a.signedBy} · <HospitalTimestamp value={a.signedAt.toISOString()}/></p></div>)}</article>)}
                {!chart.diagnosticReports.length&&<p>No diagnostic reports have been signed for this admission.</p>}
                </section> },
            { id: "transfer", label: "Transfer", children: <div className="care-columns"><div><section className="card">
                <h2>Clinician transfer order</h2>
                {active && !chart.transferCategories.length && <p className="notice">No clinical destination category is configured. Hospital administration must configure the category before a transfer order can be signed.</p>}
                {active && chart.transferCategories.length > 0 && <CareForm action={action("transfer")} button="Sign transfer order" testId="transfer-order-form">
                  <label>Clinical destination<select name="destinationCategory" required>{chart.transferCategories.map(c => <option value={c.code} key={c.code}>{c.name}</option>)}</select></label>
                  <CareField label="Transfer reason / clinical instructions" name="reason" />
                  <p className="caption">Nursing selects an available bed in this category and signs the actual handover. A new order supersedes prior uncompleted transfer authority.</p>
                </CareForm>}
                {chart.transferOrders.map(o => <article className="care-entry" key={o.id}>
                  <p>Decision {o.version} · {o.destinationCategory} · <span className="status">{o.status}</span></p><p>{o.reason}</p>
                  <p className="caption">Doctor signature · {chart.actors[o.signedBy]} · <HospitalTimestamp value={o.signedAt.toISOString()}/></p>
                  {active && o.status === "PENDING" && <CareForm action={action("withdraw-transfer", o.id)} button="Withdraw unperformed transfer" testId="transfer-withdraw-form"><CareField label="Reason for clinical reconsideration" name="reason" /><p className="caption">An actual move or witnessed handover must be recorded; it cannot be withdrawn.</p></CareForm>}
                  {chart.transferCancellations.filter(c => c.transferOrderId === o.id).map(c => <p className="caption" key={c.id}>Withdrawal · {c.reason} · {chart.actors[c.signedBy]} · <HospitalTimestamp value={c.signedAt.toISOString()} /></p>)}
                </article>)}
              </section></div><aside><TransferTimeline chart={chart} /><Link href={`/exceptions?admissionId=${chart.episode.id}`}>Factual transfer correction through Exceptions</Link></aside></div> },
            { id: "summary", label: "Summary & Rx", children: <><section className="card"><h2 >Clinical summary &amp; prescription</h2>
                <p>
                  Sign a new document version. This clinical signature does not
                  issue discharge clearance.
                </p>
                {active && (
                  <CareForm
                    action={action(
                      "summary",
                      "",
                      chart.summaries[0]?.version ?? 0,
                    )}
                    button="Sign clinical summary and prescription"
                    testId="summary-form"
                  >
                    <CareField label="Diagnosis" name="diagnosis" />
                    <label>
                      Course of care
                      <textarea name="course" required />
                    </label>
                    <CareField label="Condition" name="condition" />
                    <CareField label="Follow-up" name="followUp" />
                    <label>
                      Advice
                      <textarea name="advice" required />
                    </label>
                    {chart.orders
                      .filter(
                        (o) =>
                          o.kind === "MEDICINE" &&
                          ["TAKE_HOME", "BOTH"].includes(
                            o.details.medicationPurpose ?? "",
                          ) &&
                          !chart.events.some(
                            (e) => e.orderId === o.id && e.status === "STOPPED",
                          ),
                      )
                      .map((o) => (
                        <label className="checkbox" key={o.id}>
                          <input
                            name="prescriptionOrderIds"
                            type="checkbox"
                            value={o.id}
                          />
                          Include take-home: {o.requestedItem} ·{" "}
                          {o.details.dispensingQuantity}{" "}
                          {o.details.dispensingUnit}
                        </label>
                      ))}
                  </CareForm>
                )}
                <div data-testid="summary-history">
                  {chart.summaries.map((s) => (
                    <article className="care-entry" key={s.id}>
                      <h3>Signed clinical version {s.version}</h3>
                      <p className="caption">
                        Clinical signature ·{" "}
                        {chart.actors[s.signedBy] ?? s.signedBy} ·{" "}
                        <HospitalTimestamp value={s.signedAt.toISOString()}/>
                      </p>
                      <p>{s.diagnosis}</p>
                      <p>{s.course}</p>
                      <p>{s.condition}</p>
                      <p>{s.followUp}</p>
                      <p>{s.advice}</p>
                      {s.prescription.map((p) => (
                        <p key={p.orderId}>
                          {p.requestedItem}: {p.dose} {p.doseUnit} · {p.route} ·{" "}
                          {p.frequency} · {p.durationDays} days. Dispense{" "}
                          {p.dispensingQuantity} {p.dispensingUnit}. Identity:{" "}
                          {p.medicineIdentityState}.
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
              </section><section className="notice"><p>The signed clinical version is reviewed through the separate human Doctor clearance.</p><Link className="button secondary" href={`/discharge?admissionId=${chart.episode.id}`}>Review Doctor clearance</Link></section></> },
          ]} />
          <section className="notice"><h2>Corrections remain visible</h2><p>Original notes, signed orders and prescription versions retain their author and timestamp. Addenda record the correction and its reason.</p><Link href={`/exceptions?admissionId=${chart.episode.id}`}>Open authorized exception follow-up</Link></section>
          <details className="staff-alerts-compact work-history"><summary>Current source alerts · {work.alerts.length}</summary><StaffAlerts work={work} /></details>
        </>
      )}
    </>
  );
}
