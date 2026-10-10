import Link from "next/link";
import type { getStaffWorklist, StaffAlert } from "@/server/overview";
import { formatINR } from "@/server/billing/money";
import { formatHospitalTime } from "@/lib/hospital-time";
type Work = Awaited<ReturnType<typeof getStaffWorklist>>;
export function StaffAlerts({ work }: { work: Work }) {
  const item = (a: StaffAlert) => <li key={a.id}>
      <span className="status">{a.ownerName}</span><h3>{a.action}</h3>
      {a.name && <p>{a.name} · {a.ipCode}<br /><span className="caption">{a.bedLabel}</span></p>}
      <p className="caption">{a.detail}</p>{a.amountPaise !== undefined && <strong>{formatINR(BigInt(a.amountPaise))}</strong>}
      {a.dueAt && <p className="caption">Due {formatHospitalTime(a.dueAt, work.timezone)}</p>}
      <Link href={a.href}>Open responsible work</Link><details><summary>Source reference</summary><p className="caption">{a.id}</p></details>
    </li>;
  return <section className="card staff-alerts"><h2>Attention needed</h2><p className="caption">{work.alerts.length} current source alerts and responsible staff. Refresh to review changes.</p>
    {work.role === "PHARMACY" && <p className="caption">Stock threshold coverage: {work.configuration.stockThresholds.replaceAll("_", " ").toLowerCase()}. Unconfigured thresholds do not mean zero low-stock items.</p>}
    {work.role === "INSURANCE" && <p className="caption">Insurer limit {work.configuration.insurerThreshold.percent}% and patient deposit {work.configuration.depositThreshold.percent}%: {work.configuration.insurerThreshold.configured && work.configuration.depositThreshold.configured ? "configured thresholds" : "unconfigured values use the visible 80% source default"}.</p>}
    {work.alerts.length ? <><ul className="alert-list">{work.alerts.slice(0, 12).map(item)}</ul>{work.alerts.length > 12 && <details><summary>Show {work.alerts.length - 12} more current alerts</summary><ul className="alert-list">{work.alerts.slice(12).map(item)}</ul></details>}</> : <p>No current actionable alerts in your authorized work.</p>}
  </section>;
}
export function StaffWorklist({ work }: { work: Work }) {
  return <section className="card" data-testid="staff-worklist"><h2>Current work</h2><p className="caption">Your authorized open episodes and, where permitted, the latest 50 closed episodes for retained history.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Current staff work table"><table className="staff-table"><thead><tr><th>Patient / admission</th><th>Bed</th><th>Status</th><th>Next action</th></tr></thead>
      <tbody>{work.episodes.map(e => <tr key={e.id}><td><strong>{e.name}</strong><p className="caption">{e.ipCode}</p></td><td>{e.bedLabel}<p className="caption">{e.bedCategory}</p></td><td><span className="status">{e.status}</span></td><td><Link href={e.href}>{e.action}</Link><details><summary>Admission reference</summary><p className="caption">{e.id}</p></details></td></tr>)}</tbody></table></div>
    {!work.episodes.length && <p>No admission episodes currently assigned to this workspace.</p>}
  </section>;
}
export function WorkTimestamp({ work }: { work: Work }) {
  return <p className="page-description">Current records evaluated {formatHospitalTime(work.asOf, work.timezone)}. {work.configuration.hospitalConfigured ? "Hospital timezone configured." : "Asia/Kolkata default; hospital timezone is not configured."}</p>;
}
