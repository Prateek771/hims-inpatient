import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { getMvpWorkspace } from "@/server/mvp/workspace";
import { getMvpEpisode } from "@/server/mvp/commands";
import { MvpSummary } from "./mvp-summary";
import { HospitalTimestamp } from "./hospital-timestamp";

export type MvpFilters = { q?: string; view?: string; selected?: string };
const titles = { ADMIN: "Patients & admissions", NURSE: "My patients", PHARMACY: "Medicine bills & returns", BILLING: "Payments & insurance", INSURANCE: "Insurance cases", ADMISSION: "Admissions", DOCTOR: "Retained records", LAB: "Retained records" };
const homes = { ADMIN: "/overview", NURSE: "/nursing", PHARMACY: "/pharmacy", BILLING: "/billing", INSURANCE: "/insurance", ADMISSION: "/admissions", DOCTOR: "/history", LAB: "/history" };

export async function MvpWorkspace({ filters = {}, surface }: { filters?: MvpFilters; surface?: "payments" | "medicine" | "discharge" | "insurance" | "exceptions" }) {
  const staff = await requireStaff(), ctx = staffContext(staff, "mvp-staff-workspace");
  const work = await getMvpWorkspace(ctx);
  const home = surface === "payments" ? "/billing" : surface === "medicine" ? "/pharmacy" : surface === "discharge" ? "/discharge" : surface === "insurance" ? "/insurance" : surface === "exceptions" ? "/exceptions" : homes[staff.role], query = (filters.q ?? "").trim().slice(0, 100).toLocaleLowerCase();
  const title = surface === "payments" ? "Payments & insurance" : surface === "medicine" ? "Medicine bills & returns" : surface === "discharge" ? "Discharge" : surface === "insurance" ? "Insurance cases" : surface === "exceptions" ? "Exceptions & follow-up" : titles[staff.role];
  const current = work.episodes.filter(row => ["PENDING", "ADMITTED"].includes(row.status));
  const source = filters.view === "history" ? work.episodes.filter(row => !["PENDING", "ADMITTED"].includes(row.status)) : current;
  const rows = source.filter(row => ((filters.view ?? "action") !== "action" || row.needsAction) && (!query || `${row.name} ${row.uhid} ${row.ipCode}`.toLocaleLowerCase().includes(query)));
  const selected = rows.find(row => row.id === filters.selected) ?? rows[0];
  const review = selected ? await getMvpEpisode(ctx, selected.id) : null;
  const makeLink = (view: string, selectedId?: string) => `${home}?${new URLSearchParams({ view, ...(filters.q ? { q: filters.q } : {}), ...(selectedId ? { selected: selectedId } : {}) })}`;
  return <>
    <div className="page-heading"><div><h1>{title}</h1><p className="page-description">{staff.role === "ADMIN" ? "Keep today’s admissions and departures moving." : "Current patients, accountable handoffs and your authorized next work."}</p></div><Link className="button" href={staff.role === "ADMIN" && !surface ? "/overview?view=all" : staff.role === "ADMISSION" ? "/admissions?view=intake" : `${home}?view=all`}>{staff.role === "ADMIN" && !surface ? "View admissions" : "View all patients"}</Link></div>
    <div className="mvp-summary"><strong>{work.metrics.current} current MVP admissions</strong><strong className="mvp-warning">{work.metrics.needsAction} need action</strong><span>{work.metrics.preparing} preparing to leave</span>{staff.role === "ADMIN" && <span>{work.metrics.available} beds available</span>}<span className="caption">Updated <HospitalTimestamp value={work.asOf} /></span></div>
    {staff.role === "ADMIN" && <div className="actions"><Link href="/exceptions">Accountable exceptions</Link><Link href="/documents">Retained final documents</Link><Link href="/history">Earlier workflow episodes</Link></div>}
    {staff.role === "BILLING" && <div className="actions"><Link href="/insurance">Insurance cases & accepted responsibility</Link><Link href="/discharge">Final finance & discharge</Link></div>}
    {staff.role === "INSURANCE" && <p className="caption">Open the assigned case to record externally verified policy, accepted responsibility, protected evidence and staff follow-up.</p>}
    <div className="mvp-workspace">
      <section className="mvp-queue" aria-label="Patient work queue">
        <div className="mvp-queue-heading"><h2>Patient work queue</h2><span className="caption">Current source-based next action</span></div>
        <div className="mvp-filters"><Link className={`button ${filters.view === "action" || !filters.view ? "" : "secondary"}`} href={makeLink("action")}>Needs action · {work.metrics.needsAction}</Link><Link className={`button ${filters.view === "all" ? "" : "secondary"}`} href={makeLink("all")}>All patients · {work.metrics.current}</Link><Link className="button secondary" href={makeLink("history")}>Retained MVP episodes</Link></div>
        <form method="get" className="mvp-filters"><input type="hidden" name="view" value={filters.view ?? "action"} /><label><span className="caption">Search name, UHID or IP</span><input name="q" defaultValue={filters.q} maxLength={100} placeholder="Search name, UHID or IP…" /></label><button className="button secondary">Search patients</button></form>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Patient queue table"><table><thead><tr><th>Patient / episode</th><th>Next action / blocker</th><th>Owner</th><th>Stage</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-selected={selected?.id === row.id}><td><Link aria-current={selected?.id === row.id ? "true" : undefined} href={makeLink(filters.view ?? "action", row.id)}><strong>{row.name}</strong></Link><p className="caption">{row.uhid} · {row.ipCode}</p></td><td><Link href={row.status === "PENDING" ? `/patients/${row.id}` : staff.role === "INSURANCE" ? row.caseId ? `/insurance?caseId=${row.caseId}` : `/mvp/${row.id}` : `/mvp/${row.id}`}>{row.action}</Link><p className="caption">{row.detail}</p></td><td><strong>{row.owner}</strong><p className="caption">{row.ownerRole}</p></td><td><span className="caption">{row.stage}</span></td></tr>)}</tbody></table></div>
        {!rows.length && <div className="mvp-empty"><h3>{query ? "No patients match this search" : "No patients in this queue"}</h3><p>{query ? "Check the name, UHID or admission IP, or clear your search." : "New admissions appear here after Admission staff register a patient. Earlier workflow records remain available in Retained records."}</p>{query && <Link href={home}>Clear search</Link>}</div>}
        <div className="mvp-queue-footer"><p className="caption">Showing {rows.length} {filters.view === "history" ? "retained" : "current"} episodes</p><Link href="/history">Earlier workflow records</Link></div>
      </section>
      {selected && review ? <MvpSummary identity={selected} review={review} showMoney={["ADMIN", "BILLING", "INSURANCE"].includes(staff.role)} /> : <aside className="mvp-detail"><h2>Patient details</h2><p>Select a patient to see current checks, next ownership and exit facts.</p></aside>}
    </div>
    {staff.role === "ADMIN" && <section className="mvp-bed-footer"><div><h3>Beds · physical state stays visible</h3><p>{work.metrics.totalBeds} beds: {work.metrics.occupied} occupied · {work.metrics.available} available · {work.metrics.held} held · {work.metrics.cleaning} cleaning</p><p className="caption">Vacancy ends room use. Exit and turnover release the bed.</p><Link href="/admin/beds">Review physical beds</Link></div><div><h3>Doctor availability · staff operations</h3><p className="caption">Designated shift Nurse and backup maintain availability independently of clinical approval.</p><Link href="/availability">View availability and responsibility</Link></div></section>}
  </>;
}
