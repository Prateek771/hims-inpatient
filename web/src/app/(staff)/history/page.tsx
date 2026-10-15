import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireStaff, staffContext } from "@/server/access";
import { getStaffWorklist } from "@/server/overview";
import { db } from "@/server/db";
import { admissions } from "@/server/admissions/schema";
export default async function RetainedHistory() {
  const staff = await requireStaff();
  const work = await getStaffWorklist(staffContext(staff, "retained-workflow-history"));
  const legacy = new Set((await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.workflowVersion, 1))).map(episode => episode.id));
  const rows = work.episodes.filter(episode => legacy.has(episode.id));
  const home = staff.role === "DOCTOR" ? "/clinical?legacy=1" : staff.role === "LAB" ? "/lab?legacy=1" : staff.role === "NURSE" ? "/nursing?legacy=1" : staff.role === "PHARMACY" ? "/pharmacy?legacy=1" : staff.role === "INSURANCE" ? "/insurance?legacy=1" : staff.role === "ADMISSION" ? "/admissions" : "/billing?legacy=1";
  return <><h1>Retained records</h1><p className="page-description">Earlier workflow episodes retain their original clinical, stock, financial and signed document sources. Access follows your existing role and assignments.</p><div className="actions"><Link className="button secondary" href={home}>Open earlier role workspace</Link>{["ADMIN", "BILLING"].includes(staff.role) && <Link href="/documents">Retained document versions</Link>}{staff.role === "ADMIN" && <Link href="/overview?legacy=1">Earlier operational overview</Link>}<Link href="/exceptions">Source corrections & obligations</Link></div><section className="card"><h2>Authorized earlier episodes</h2><div className="table-scroll" tabIndex={0} role="region" aria-label="Retained episode table"><table><thead><tr><th>Patient / admission</th><th>Bed / status</th><th>Retained work</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}<p className="caption">{row.ipCode}</p></td><td>{row.bedLabel} · {row.status}</td><td><Link href={`${row.href}${row.href.includes("?") ? "&" : "?"}legacy=1`}>{row.action}</Link></td></tr>)}</tbody></table></div>{!rows.length && <p>No earlier workflow episodes are available in your authorized scope.</p>}</section></>;
}
