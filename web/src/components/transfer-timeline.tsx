import { HospitalTimestamp } from "@/components/hospital-timestamp";
import type { getCare } from "@/server/clinical/commands";
export function TransferTimeline({ chart }: { chart: Awaited<ReturnType<typeof getCare>> }) {
  return <section className="card" data-testid="transfer-history">
    <h2>Stay &amp; transfer timeline</h2>
    {chart.stays.map(s => <article className="care-entry" key={s.id}>
      <p>{s.bedLabel} · {s.category}</p>
      <p className="caption"><HospitalTimestamp value={s.startedAt.toISOString()}/> → {s.endedAt ? <HospitalTimestamp value={s.endedAt.toISOString()} /> : "Occupied"}</p>
    </article>)}
    {chart.transferHistory.map(t => <article className="notice" key={t.id}>
      <h3>{chart.stays.find(s => s.id === t.oldStayId)?.bedLabel} → {chart.stays.find(s => s.id === t.newStayId)?.bedLabel}</h3>
      <p><HospitalTimestamp value={t.transferredAt.toISOString()}/> · Exact room boundary</p>
      <p>{t.handover}</p>
      <p className="caption">Nurse signature · {chart.actors[t.signedBy]} · <HospitalTimestamp value={t.signedAt.toISOString()}/></p>
      <p className="caption">Doctor authority · {chart.actors[chart.transferOrders.find(o => o.id === t.transferOrderId)!.signedBy]} · Decision {chart.transferOrders.find(o => o.id === t.transferOrderId)!.version}</p>
    </article>)}
    {chart.insuranceTransferTasks.map(t => <p className="notice" key={t.id}>Insurance staff follow-up pending: {t.reason}.</p>)}
    <p className="caption">Old room ends and the next room begins at the same actual time. Consumables keep their source bed and stay. Prescribed monitoring continues.</p>
  </section>;
}
