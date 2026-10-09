import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import {
  careWorkspace,
  clinicalMedicineCatalog,
  getCare,
} from "@/server/clinical/commands";
import { listBillableItems } from "@/server/billing/commands";
import { DomainError } from "@/server/contracts";
import { CareField, CareForm, RoundForm } from "@/components/care-forms";
import { saveClinical } from "./actions";
import { TransferTimeline } from "@/components/transfer-timeline";

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams: Promise<{ admissionId?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "DOCTOR") notFound();
  const ctx = staffContext(staff, "clinical-view");
  const workspace = await careWorkspace(ctx);
  const { admissionId } = await searchParams;
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
      <p className="eyebrow">02 · Clinical tracking / Doctor</p>
      <h1>Care history, without the searching</h1>
      <p className="page-description">
        Keep signed rounds, explicit orders and the clinical summary together.
      </p>
      <section className="card">
        <h2>Assigned care worklist</h2>
        <details open={!chart}>
          <summary>Choose an admission</summary>
          {workspace.length ? (
            <ul className="patient-results">
              {workspace.map((a) => (
                <li key={a.id}>
                  <Link href={`/clinical?admissionId=${a.id}`}>
                    {a.name} · {a.ipCode} · {a.bedLabel}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No active patients admitted under you.</p>
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
          <div className="care-columns">
            <div>
              <section className="card">
                <h2>Latest round &amp; clinical notes</h2>
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
                {chart.rounds.map((r) => (
                  <article
                    className="care-entry"
                    key={r.id}
                    data-testid="round-entry"
                  >
                    <p className="caption">
                      Clinical signature ·{" "}
                      {chart.actors[r.signedBy] ?? r.signedBy} ·{" "}
                      {r.signedAt.toISOString()} UTC
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
                            {a.signedAt.toISOString()} UTC
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
              </section>
              <section className="card">
                <h2>Ordered work</h2>
                <div className="table-scroll">
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
                              <p className="caption">
                                {o.kind} · {o.id}
                              </p>
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
                                  From {o.details.schedule.startsAt} · every{" "}
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
              </section>
            </div>
            <aside>
              <section className="card">
                <h2>Clinician transfer order</h2>
                {active && chart.transferCategories.length > 0 && <CareForm action={action("transfer")} button="Sign transfer order" testId="transfer-order-form">
                  <label>Clinical destination<select name="destinationCategory" required>{chart.transferCategories.map(c => <option value={c.code} key={c.code}>{c.name}</option>)}</select></label>
                  <CareField label="Transfer reason / clinical instructions" name="reason" />
                  <p className="caption">Nursing selects an available bed in this category and signs the actual handover. A new order supersedes prior uncompleted transfer authority.</p>
                </CareForm>}
                {chart.transferOrders.map(o => <article className="care-entry" key={o.id}>
                  <p>Decision {o.version} · {o.destinationCategory} · <span className="status">{o.status}</span></p><p>{o.reason}</p>
                  <p className="caption">Doctor signature · {chart.actors[o.signedBy]} · {o.signedAt.toISOString()} UTC</p>
                </article>)}
              </section>
              <TransferTimeline chart={chart} />
              <section className="card">
                <h2>Clinical summary &amp; prescription</h2>
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
                        {s.signedAt.toISOString()} UTC
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
              </section>
              <section className="card">
                <h2>Care billing work</h2>
                {chart.billing.map((b) => (
                  <article className="care-entry" key={b.id}>
                    <h3>
                      {b.itemId} · {b.category}
                    </h3>
                    <p>
                      <span className="status">{b.state}</span> · {b.quantity}{" "}
                      {b.unit}
                    </p>
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
              </section>
              <section className="card">
                <h2>Nursing records</h2>
                <p>
                  {chart.observations.length} signed readings ·{" "}
                  {chart.administrations.length} medication outcomes ·{" "}
                  {
                    chart.occurrences.filter((o) => o.status === "OVERDUE")
                      .length
                  }{" "}
                  overdue occurrences
                </p>
                <Link
                  className="button secondary"
                  href={`/nursing?admissionId=${chart.episode.id}`}
                >
                  Open nursing record
                </Link>
              </section>
            </aside>
          </div>
          <section className="notice">
            <h2>Corrections remain visible</h2>
            <p>
              Original notes, signed orders and prescription versions retain
              their author and timestamp. Addenda record the correction and its
              reason.
            </p>
          </section>
        </>
      )}
    </>
  );
}
