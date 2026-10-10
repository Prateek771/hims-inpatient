import Link from "next/link";
import { requireStaff, staffContext } from "@/server/access";
import { getStaffWorklist } from "@/server/overview";
import { StaffAlerts, StaffWorklist, WorkTimestamp } from "@/components/staff-dashboard";
import { AccountControls } from "@/components/account-controls";
import type { StaffRole } from "@/server/contracts";
const areas: Record<StaffRole, { title: string; purpose: string; links: [string, string][] }> = {
  ADMIN: { title: "Hospital administration", purpose: "Beds, discharge blockers, money and accountable exceptions", links: [["Open hospital overview", "/overview"], ["Manage staff", "/admin/staff"], ["Hospital settings", "/admin/settings"], ["Bed inventory", "/admin/beds"]] },
  ADMISSION: { title: "Admission desk", purpose: "Patient identity, bed allocation, pending admission and initial deposits", links: [["Admissions & beds", "/admissions"]] },
  DOCTOR: { title: "Doctor workspace", purpose: "Assigned patients, rounds, orders and clinical discharge review", links: [["Open doctor workspace", "/clinical"]] },
  NURSE: { title: "Nursing workspace", purpose: "Assigned patients, prescribed care, shifts and handover", links: [["Open nursing workspace", "/nursing"]] },
  PHARMACY: { title: "Pharmacy workspace", purpose: "Actual stock, medicine issues and returns, signed prescription preparation", links: [["Open pharmacy workspace", "/pharmacy"]] },
  LAB: { title: "Lab worklist", purpose: "Department orders, samples, processing and signed human reports", links: [["Open lab worklist", "/lab"]] },
  INSURANCE: { title: "Insurance paperwork", purpose: "Assigned cases, externally verified decisions and current manual-paperwork reviews", links: [["Open insurance paperwork", "/insurance"]] },
  BILLING: { title: "Charges and receipts", purpose: "Posted charges, real receipts, held deposits, refunds and final human clearance", links: [["Open charges and receipts", "/billing"]] },
};
export default async function Workspace() {
  const staff = await requireStaff(), area = areas[staff.role];
  const work = await getStaffWorklist(staffContext(staff, "staff-dashboard"));
  return <><p className="eyebrow">{area.title} · {staff.role}</p><h1>Welcome, {staff.name}</h1><p className="page-description">{area.purpose}.</p>
    <div className="actions">{area.links.map(([label, href]) => <Link key={href} className="button" href={href}>{label}</Link>)}</div><WorkTimestamp work={work} />
    <div className="overview-columns"><StaffWorklist work={work} /><StaffAlerts work={work} /></div><AccountControls /></>;
}
