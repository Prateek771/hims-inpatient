import Link from "next/link";
import { requireAdmin, staffContext } from "@/server/access";
import { admissionWorkspace } from "@/server/admissions/commands";
import { getOverview } from "@/server/overview";
import { AddBedForm, DisableBedForm } from "@/components/admission-forms";
import { WorkTimestamp } from "@/components/staff-dashboard";
import { WorkflowTabs } from "@/components/workflow-tabs";

export default async function BedInventoryPage({ searchParams }: {
  searchParams: Promise<{ bedCategory?: string }>;
}) {
  const staff = await requireAdmin();
  const [workspace, work, params] = await Promise.all([
    admissionWorkspace(staffContext(staff, "bed-inventory-view")),
    getOverview(staffContext(staff, "bed-inventory-occupancy"), { asOf: new Date() }),
    searchParams,
  ]);
  const physical = new Map(work.physicalBeds.map(bed => [bed.id, bed]));
  const metrics = work.metrics;
  const pending = workspace.worklist.filter(episode => episode.status === "PENDING");
  function availability(id: string) {
    const bed = physical.get(id);
    return !bed ? "Refresh state" : bed.disabled ? "Disabled" : bed.occupied ? "Occupied" : bed.reserved ? "Reserved" : bed.cleaning ? "Cleaning" : bed.ready ? "Ready" : "Unavailable";
  }
  return <>
    <h1>Beds</h1><p className="page-description">Physical inventory, reservations and actual turnover.</p>
    <WorkTimestamp work={work} />
    <div className="operational-metrics">
      {[["Physical beds", metrics.totalBeds, "All configured beds, including disabled"], ["Occupied", metrics.occupiedBeds, "Actual current physical room stays"], ["Ready", metrics.availableBeds, "Clean, active and available"], ["Reserved / cleaning", `${metrics.reservedBeds} / ${metrics.cleaningBeds}`, "Held outside occupancy / awaiting housekeeping"]].map(([label, value, detail]) => <div className="card metric" key={label}><p>{label}</p><strong>{value}</strong><p className="caption">{detail}</p></div>)}
    </div>
    <div className="operations-columns">
      <div>
        <WorkflowTabs id="physical-bed-categories" initialTab={params.bedCategory} items={work.bedOccupancy.map(category => ({
          id: category.code, label: `${category.name} · ${category.occupied} / ${category.total}`,
          children: <section className="card"><h2>{category.name} · {category.total} physical beds</h2><p className="caption">{category.occupied} occupied · {category.ready} ready · {category.reserved} reserved · {category.cleaning} cleaning · {category.disabled} disabled</p>
            <div className="bed-grid">{workspace.beds.filter(bed => bed.category === category.code).map(bed => {
              const state = availability(bed.id);
              const content = <><strong>{bed.label}</strong><span>{state}</span></>;
              return bed.admissionId ? <Link key={bed.id} className={`bed-tile bed-${state.toLowerCase().replaceAll(" ", "-")}`} href={`/patients/${bed.admissionId}`} aria-label={`${bed.label}: ${state}; open admission record`}>{content}</Link> : <div key={bed.id} className={`bed-tile bed-${state.toLowerCase().replaceAll(" ", "-")}`}>{content}</div>;
            })}</div>
            {!category.total && <p>No physical beds in this category.</p>}
          </section>,
        }))} />
        {!work.bedOccupancy.length && <section className="card"><h2>Physical beds</h2><p>No physical beds configured. Configure an active room category in Settings first.</p></section>}
      </div>
      <section className="card"><h2>Bed controls</h2><p className="caption">Reserved and occupied beds cannot be disabled. Cleaning must be completed before reuse.</p>
        <h3>Add physical bed</h3>{!workspace.categories.length && <p>Configure an active room category in Hospital settings first.</p>}<AddBedForm categories={workspace.categories} />
        <div className="notice"><h3>Actual cleaning completion</h3><p>Admin records the confirmed housekeeping time and evidence in Discharge turnover.</p><Link className="button secondary" href="/discharge">Review cleaning and turnover</Link></div>
      </section>
    </div>
    <section className="card"><h2>Pending reservations</h2><p className="caption">Admin can review an existing reservation, record its patient deposit, activate actual arrival or cancel the pending episode. Admission creates intake.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Pending bed reservations table"><table className="staff-table"><thead><tr><th>Patient / admission</th><th>Reserved bed</th><th>Next responsible work</th></tr></thead><tbody>{pending.map(episode => <tr key={episode.id}><td>{episode.name}<p className="caption">{episode.ipCode}</p></td><td>{episode.bedLabel}<p><span className="status">PENDING</span></p></td><td><Link href={`/patients/${episode.id}`}>Review deposit and actual arrival</Link></td></tr>)}</tbody></table></div>
      {!pending.length && <p>No pending reservations.</p>}
    </section>
    <details className="work-history"><summary>Physical bed inventory and disable controls</summary><section className="card"><h2>Physical bed inventory</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Physical bed inventory table"><table className="staff-table"><thead><tr><th>Bed</th><th>Category</th><th>Availability</th><th>Inventory action</th></tr></thead><tbody>{workspace.beds.map(bed => <tr key={bed.id}><td>{bed.label}</td><td>{bed.category}</td><td>{availability(bed.id)}{bed.admissionId && <p><Link href={`/patients/${bed.admissionId}`}>Open admission record</Link></p>}</td><td>{bed.active && !bed.admissionId && physical.get(bed.id)?.ready ? <details><summary>Disable available bed</summary><DisableBedForm bedId={bed.id} /></details> : "—"}</td></tr>)}</tbody></table></div>
      {!workspace.beds.length && <p>No physical beds configured.</p>}
    </section></details>
  </>;
}
