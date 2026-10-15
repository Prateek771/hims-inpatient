import { requireStaff, staffContext } from "@/server/access";
import { dischargeWorkspace } from "@/server/discharge/commands";
import { CareField, CareForm } from "./care-forms";
import { dischargeAction } from "@/app/(staff)/discharge/actions";
export async function MvpTurnover() {
  const staff = await requireStaff();
  if (staff.role !== "ADMIN") return null;
  const { turnovers } = await dischargeWorkspace(staffContext(staff, "mvp-bed-turnover"));
  return <section className="card"><h2>Cleaning & turnover before bed reuse</h2>{turnovers.length ? turnovers.map(turnover => <details className="mvp-action" key={turnover.id}><summary>{turnover.bedLabel} · cleaning pending</summary><CareForm action={dischargeAction.bind(null, "turnover", { admissionId: "", requestId: crypto.randomUUID(), gate: "BILLING", reviewHash: "", billVersion: 1 })} button="Record cleaning completion"><input type="hidden" name="turnoverId" value={turnover.id} /><CareField name="completedAt" label="Actual cleaning completed (UTC)" type="datetime-local" /><CareField name="evidence" label="Housekeeping confirmation / evidence" /></CareForm></details>) : <p>No beds currently await authorized cleaning completion.</p>}</section>;
}
