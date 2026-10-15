import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { getOverview } from "@/server/overview";
import { StaffAlerts, StaffWorklist, WorkTimestamp } from "@/components/staff-dashboard";
import { formatINR } from "@/server/billing/money";

export default async function Overview({ searchParams }: {
  searchParams: Promise<{ bedCategory?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "ADMIN") return <><h1>Hospital overview is restricted</h1><p className="page-description">Hospital administrator access is required.</p><Link className="button" href="/workspace">Return to my workspace</Link></>;
  const { bedCategory } = await searchParams;
  const work = await getOverview(staffContext(staff, "hospital-overview"), { asOf: new Date(), ...(bedCategory ? { bedCategory } : {}) });
  const metrics = work.metrics;
  const occupancy = metrics.totalBeds ? (metrics.occupiedBeds / metrics.totalBeds * 100).toFixed(1) : "0";
  return <>
    <h1>Home</h1>
    <p className="page-description">Current hospital operations, physical bed readiness and the next responsible work.</p>
    <WorkTimestamp work={work} />
    <form method="get" className="overview-filter"><input type="hidden" name="legacy" value="1" /><label>Bed category<select name="bedCategory" defaultValue={bedCategory ?? ""}><option value="">All configured categories</option>{work.categories.map(category => <option key={category.code} value={category.code}>{category.name}</option>)}</select></label><button className="button">Apply filter</button></form>
    <p className="caption">Bed category filters episodes, beds and their money. Shared medicine stock alerts remain hospital-wide.</p>
    <div className="operational-metrics" data-testid="overview-metrics">
      {[["Current inpatients", metrics.activeAdmissions, `${metrics.pendingAdmissions} reservations pending actual activation`],
        ["Bed occupancy", `${occupancy}%`, `${metrics.occupiedBeds} occupied / ${metrics.totalBeds} physical beds`],
        ["Beds ready", metrics.availableBeds, `${metrics.reservedBeds} reserved · ${metrics.cleaningBeds} cleaning`],
        ["Discharge waiting", metrics.dischargeWaiting, "Current human gates; earliest incomplete gate owns review"],
        ["Needs attention", metrics.needsAttention, "Named source-linked work for responsible staff"],
      ].map(([label, value, detail]) => <div className="card metric" key={label}><p>{label}</p><strong>{value}</strong><p className="caption">{detail}</p></div>)}
    </div>
    <div className="operations-columns">
      <section className="card"><h2>Bed occupancy</h2><p className="caption">{metrics.occupiedBeds} occupied / {metrics.totalBeds} configured physical beds. Disabled beds remain in the denominator.</p>
        <div className="occupancy-list">{work.bedOccupancy.map(category => <div className="occupancy-row" key={category.code}>
          <div className="occupancy-label"><strong>{category.name}</strong><span className="caption">{category.occupied} / {category.total} · {category.total ? `${(category.occupied / category.total * 100).toFixed(1)}%` : "No physical beds"}</span></div>
          <progress value={category.occupied} max={category.total || 1} aria-label={`${category.name}: ${category.occupied} occupied of ${category.total} physical beds`} />
          <p className="caption">{category.ready} ready · {category.reserved} reserved · {category.cleaning} cleaning · {category.disabled} disabled</p>
        </div>)}</div>
        {!work.bedOccupancy.length && <p>No bed categories or physical beds configured.</p>}
        <Link className="button secondary" href="/admin/beds">Open beds</Link>
      </section>
      <section className="card"><h2>Ready for the next admission</h2><p className="caption">Unoccupied does not always mean ready. A bed hold can remain after actual vacancy.</p>
        <dl className="readiness-counts">{[["Ready", metrics.availableBeds], ["Reserved", metrics.reservedBeds], ["Cleaning", metrics.cleaningBeds], ["Disabled", metrics.disabledBeds]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <Link className="button secondary" href="/discharge">Review turnover</Link>
        <div className="notice"><h3>Operational attention</h3><p>Open the responsible record before an approval or correction.</p><Link href="#operational-attention">Review source-linked alerts</Link></div>
      </section>
    </div>
    <div className="operations-columns">
      <section className="card"><h2>Patients waiting for discharge</h2><p className="caption">Current summary and source-bound human seals. The earliest incomplete gate owns the next review.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Discharge waiting table"><table className="staff-table"><thead><tr><th>Patient / admission</th><th>Current stage</th><th>Owner</th><th>Next action</th></tr></thead><tbody>{work.discharge.map(item => <tr key={item.admissionId}><td>{item.name}<p className="caption">{item.ipCode} · {item.bedLabel}</p></td><td><span className="status">{item.stage}</span></td><td>{item.ownerRole ?? "Billing desk"}</td><td><Link href={item.href}>Open discharge review</Link></td></tr>)}</tbody></table></div>
        {!work.discharge.length && <p>No current signed discharge summaries awaiting review.</p>}
        <p className="caption">{metrics.dischargesToday} actual departures today in the hospital timezone.</p>
        <Link href="/discharge" className="button secondary">Open discharge tracker</Link>
      </section>
      <section className="card"><h2>Current posted money</h2><p className="caption">Open episodes and the latest 50 closed episodes. Recorded cash remains separate from external authorization; room estimates and pending charges are separate from posted totals.</p>
        <dl className="readiness-counts">{[["Posted net bill", work.financialTotals.netPaise], ["Patient cash retained", work.financialTotals.patientCashPaise], ["Insurer cash retained", work.financialTotals.insurerCashPaise], ["Unallocated deposit held", work.financialTotals.heldDepositPaise]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{formatINR(BigInt(amount))}</dd></div>)}</dl>
        <p>{work.financialTotals.unknownResponsibility ? `${work.financialTotals.unknownResponsibility} episodes need current complete responsibility review; their payer dues are unavailable.` : "All displayed episodes have current complete recorded responsibility."}</p>
        <Link className="button secondary" href="/billing">Open charges and receipts</Link>
      </section>
    </div>
    <div id="operational-attention" className="staff-alerts-compact"><StaffAlerts work={work} /></div>
    <details className="work-history"><summary>Operational episodes and retained history</summary><StaffWorklist work={work} title="Operational episode history" /></details>
    <section className="notice"><h2>Configuration and sources</h2><p>Insurer limit: {work.configuration.insurerThreshold.percent}% ({work.configuration.insurerThreshold.configured ? "configured" : "source default; not configured"}). Patient deposit: {work.configuration.depositThreshold.percent}% ({work.configuration.depositThreshold.configured ? "configured" : "source default; not configured"}). Stock thresholds: {work.configuration.stockThresholds.replaceAll("_", " ").toLowerCase()}. An unconfigured threshold is distinct from zero low-stock items.</p></section>
  </>;
}
