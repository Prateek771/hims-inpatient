import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { getMvpWorkspace } from "@/server/mvp/workspace";
import { getMvpEpisode } from "@/server/mvp/commands";
import { MvpWorkspaceSummary } from "./mvp-workspace-summary";
import { HospitalTimestamp } from "./hospital-timestamp";
import { purposeRows, workspacePurpose, workspacePurposes, type WorkspaceSurface } from "@/lib/mvp-workspace-purpose";

export type MvpFilters = { q?: string; view?: string; selected?: string };
export async function MvpWorkspace({ filters = {}, surface }: { filters?: MvpFilters; surface?: WorkspaceSurface }) {
  const staff = await requireStaff(), ctx = staffContext(staff, "mvp-staff-workspace");
  const work = await getMvpWorkspace(ctx), purpose = workspacePurpose(staff.role, surface), config = workspacePurposes[purpose];
  const query = (filters.q ?? "").trim().slice(0, 100).toLocaleLowerCase();
  const view = ["action", "all", "history"].includes(filters.view ?? "") ? filters.view! : staff.role === "ADMIN" || ["nursing", "medicine", "insurance", "payments"].includes(purpose) ? "all" : "action";
  const relevant = purposeRows(work.episodes, purpose, staff.role), current = relevant.filter(row => ["PENDING", "ADMITTED"].includes(row.status) || purpose === "exceptions" && row.insuranceCorrection);
  const history = relevant.filter(row => !["PENDING", "ADMITTED"].includes(row.status) && !(purpose === "exceptions" && row.insuranceCorrection)), actionCount = relevant.filter(row => row.needsAction).length;
  const source = view === "history" ? history : view === "action" ? relevant.filter(row => row.needsAction) : current;
  const rows = source.filter(row => (view !== "action" || row.needsAction) && (!query || `${row.name} ${row.uhid} ${row.ipCode}`.toLocaleLowerCase().includes(query)));
  const selected = rows.find(row => row.id === filters.selected) ?? rows[0];
  const review = selected ? await getMvpEpisode(ctx, selected.id) : null;
  const makeLink = (view: string, selectedId?: string) => `${config.home}?${new URLSearchParams({ view, ...(filters.q ? { q: filters.q } : {}), ...(selectedId ? { selected: selectedId } : {}) })}`;
  return <>
    <div className="page-heading"><div><h1>{config.title}</h1><p className="page-description">{config.description}</p></div>{staff.role === "ADMISSION" && purpose === "admission" && <Link className="button" href="/admissions?view=intake">New admission</Link>}</div>
    <div className="mvp-summary"><strong>{current.length} {config.metric}</strong><strong className="mvp-warning">{actionCount} need {purpose === "insurance" ? "readiness checks" : purpose === "exceptions" ? "follow-up review" : "action"}</strong><span>{history.length} retained {purpose === "insurance" ? "cases" : "episodes"}</span>{purpose === "patients" && staff.role === "ADMIN" && <span>{work.metrics.available} beds available</span>}<span className="caption">Updated <HospitalTimestamp value={work.asOf} /></span></div>
    {staff.role === "ADMIN" && purpose === "patients" && <div className="actions"><Link href="/exceptions">Accountable exceptions</Link><Link href="/documents">Retained final documents</Link><Link href="/history">Earlier workflow episodes</Link></div>}
    {purpose === "payments" && <div className="actions"><Link href="/insurance">Insurance cases & accepted responsibility</Link><Link href="/discharge">Final finance & discharge</Link></div>}
    {purpose === "insurance" && <p className="caption">Open the exact case for externally verified policy, protected evidence, decisions and staff follow-up. The readiness filter covers discharge checks only; use All current cases for policy, decision and follow-up work.</p>}
    <div className="mvp-workspace">
      <section className="mvp-queue" aria-label={config.queue}>
        <div className="mvp-queue-heading"><h2>{config.queue}</h2><span className="caption">Current source-based {purpose === "patients" ? "next action" : "section work"}</span></div>
        <div className="mvp-filters"><Link className={`button ${view === "action" ? "" : "secondary"}`} href={makeLink("action")}>{purpose === "insurance" ? "Readiness checks" : "Needs action"} · {actionCount}</Link><Link className={`button ${view === "all" ? "" : "secondary"}`} href={makeLink("all")}>{config.all} · {current.length}</Link><Link className={`button ${view === "history" ? "" : "secondary"}`} href={makeLink("history")}>Retained MVP {purpose === "insurance" ? "cases" : "episodes"}</Link></div>
        <form method="get" className="mvp-filters"><input type="hidden" name="view" value={view} /><label><span className="caption">Search name, UHID or IP</span><input name="q" defaultValue={filters.q} maxLength={100} placeholder="Search name, UHID or IP…" /></label><button className="button secondary">Search patients</button></form>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${config.queue} table`}><table><thead><tr><th>Patient / episode</th><th>{config.task}</th><th>Owner</th><th>Stage</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-selected={selected?.id === row.id}><td><Link aria-current={selected?.id === row.id ? "true" : undefined} href={makeLink(view, row.id)}><strong>{row.name}</strong></Link><p className="caption">{row.uhid} · {row.ipCode}</p><p className="caption">{row.bedLabel}</p></td><td><Link href={row.href}>{row.action}</Link><p className="caption">{row.detail}</p></td><td><strong>{row.owner}</strong><p className="caption">{row.ownerRole}</p></td><td><span className="caption">{row.stage}</span></td></tr>)}</tbody></table></div>
        {!rows.length && <div className="mvp-empty"><h3>{query ? "No patients match this search" : "No patients in this queue"}</h3><p>{query ? "Check the name, UHID or admission IP, or clear your search." : view === "action" && current.length ? "No current section actions are flagged. Use the all filter to open routine work." : view === "history" ? "No retained episodes match this section. Earlier workflow records remain available below." : config.empty}</p>{query && <Link href={config.home}>Clear search</Link>}</div>}
        <div className="mvp-queue-footer"><p className="caption">Showing {rows.length} {view === "history" ? "retained" : purpose === "exceptions" ? "follow-up" : "current"} {purpose === "insurance" ? "cases" : "episodes"}</p><Link href="/history">Earlier workflow records</Link></div>
      </section>
      {selected && review ? <MvpWorkspaceSummary identity={selected} review={review} purpose={purpose} role={staff.role} showMoney={["ADMIN", "BILLING", "INSURANCE"].includes(staff.role)} /> : <aside className="mvp-detail"><h2>Patient details</h2><p>Select a patient to see this section’s sources, responsible work and next action.</p></aside>}
    </div>
    {staff.role === "ADMIN" && purpose === "patients" && <section className="mvp-bed-footer"><div><h3>Beds · physical state stays visible</h3><p>{work.metrics.totalBeds} beds: {work.metrics.occupied} occupied · {work.metrics.available} available · {work.metrics.held} held · {work.metrics.cleaning} cleaning</p><p className="caption">Vacancy ends room use. Exit and turnover release the bed.</p><Link href="/admin/beds">Review physical beds</Link></div><div><h3>Doctor availability · staff operations</h3><p className="caption">Designated shift Nurse and backup maintain availability independently of clinical approval.</p><Link href="/availability">View availability and responsibility</Link></div></section>}
  </>;
}
