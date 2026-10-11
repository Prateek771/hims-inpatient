import { HospitalTimestamp } from "@/components/hospital-timestamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { billingWorkspace, getBill, getDepositSummary } from "@/server/billing/commands";
import { formatINR } from "@/server/billing/money";
import { DomainError } from "@/server/contracts";
import { AllocationForm, ReceiptForm, ReconcileRoomForm, ReversalForm } from "@/components/billing-forms";
import { getStaffWorklist } from "@/server/overview";
import { StaffAlerts, StaffWorklist, WorkTimestamp } from "@/components/staff-dashboard";
import { WorkflowTabs } from "@/components/workflow-tabs";

export default async function BillingPage({ searchParams }: {
    searchParams: Promise<{
        admissionId?: string;
        tab?: string;
    }>;
}) {
    const staff = await requireStaff();
    if (!["ADMIN", "BILLING"].includes(staff.role))
        notFound();
    const ctx = staffContext(staff, "billing-view");
    const [workspace, work] = await Promise.all([billingWorkspace(ctx), getStaffWorklist(ctx)]);
    const { admissionId, tab } = await searchParams;
    let loadedBill: Awaited<ReturnType<typeof getBill>> | undefined;
    if (admissionId) {
        try {
            loadedBill = await getBill(ctx, admissionId);
        }
        catch (error) {
            if (error instanceof DomainError && error.code === "FORBIDDEN")
                notFound();
            throw error;
        }
    }
    const bill = loadedBill;
    const selected = workspace.find((r) => r.id === admissionId);
    const closed=work.episodes.filter(episode=>!["PENDING","ADMITTED"].includes(episode.status));
    const deposit=bill?.status==="PENDING"?await getDepositSummary(ctx,bill.admissionId):null;
    const selectedEpisode=work.episodes.find(episode=>episode.id===admissionId);
    const relatedCase=work.alerts.find(alert=>alert.admissionId===admissionId&&alert.caseId)?.caseId;
    const financialReviews=new Set(work.alerts.filter(alert=>["RESPONSIBILITY","PENDING_CHARGES"].includes(alert.kind)&&alert.admissionId).map(alert=>alert.admissionId)).size;
    return <>
      <h1>Billing</h1><p className="page-description">Current bills, actual money and responsible financial work.</p><WorkTimestamp work={work}/>
      <details className="staff-alerts-compact"><summary>Attention needed · {work.alerts.length} current source alerts</summary><StaffAlerts work={work}/></details>
      {!bill&&<div className="care-work-metrics">
        <section className="card metric"><p>Financial reviews</p><strong>{financialReviews}</strong><p className="caption">Open responsibility / pending-charge source alerts</p></section>
        <section className="card metric"><p>Pending deposits / arrival</p><strong>{workspace.filter(row=>row.status==="PENDING").length}</strong><p className="caption">Reserved episodes awaiting Admission / Admin activation</p></section>
        <section className="card metric"><p>Final clearance</p><strong>{work.discharge.filter(row=>row.ownerRole==="BILLING").length}</strong><p className="caption">Episodes at the current Billing / Admin human gate</p></section>
      </div>}
      <section className="card"><h2>Billing worklist</h2><details open={!bill}><summary>{bill?"Choose another admission — all ongoing episodes and held-cash reviews":"Current billing work"}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Current billing work"><table><thead><tr><th>Patient / admission</th><th>Posted bill / held cash</th><th>Next work</th></tr></thead><tbody>{workspace.map(row=>{
        const source=work.financial.find(item=>item.admissionId===row.id),alert=work.alerts.find(item=>item.admissionId===row.id);
        return <tr key={row.id}><td><Link href={`/billing?admissionId=${row.id}`}>{row.name} · {row.ipCode}</Link><p className="caption">{row.bedLabel} · {row.status}</p></td><td>{source?formatINR(BigInt(source.netPaise)):"Open the current bill"}<p className="caption">Actual retained cash {formatINR(row.heldCashPaise)}</p></td><td>{row.requiresCashReview?<><Link href={`/exceptions?admissionId=${row.id}`}>Never admitted; held cash — admin review required</Link><p className="caption">{formatINR(row.heldCashPaise)} remains recorded</p></>:row.status==="PENDING"?"Admission / Admin arrival and deposit handoff":alert?<Link href={alert.href}>{alert.action}</Link>:<Link href={`/billing?admissionId=${row.id}`}>Review current charges and receipts</Link>}</td></tr>;
      })}</tbody></table></div>{!workspace.length&&<p>No pending, admitted or cancelled held-cash episodes. Financial settings must be configured before activation.</p>}</details></section>
      {closed.length>0&&<details className="work-history"><summary>Retained episode history · {closed.length} episodes</summary><StaffWorklist work={{...work,episodes:closed}} title="Retained financial history"/></details>}
      {bill&&<>
        <section className="care-patient-context" aria-label="Selected billing admission"><div><h2>{selected?.name??selectedEpisode?.name??bill.ipCode}</h2><p>{bill.ipCode} · {selected?.bedLabel??selectedEpisode?.bedLabel} · <span className="status">{bill.status}</span> · {bill.paymentRoute}</p></div><div><strong>Current financial sources</strong><p className="caption">Financial revision {bill.revision} · captured <HospitalTimestamp value={bill.asOf.toISOString()}/></p></div></section>
        {bill.status==="CANCELLED"&&<section className="notice"><h2>Cancelled before admission — held cash needs admin review</h2><Link href={`/exceptions?admissionId=${bill.admissionId}`}>Open cancelled-deposit return authority</Link><p>The reservation was cancelled and no occupied stay began. Actual recorded cash remains visible; cancellation does not return money. Admin records specific cancelled-deposit authority for the original receipt; Billing then records the actual linked return in Exceptions.</p></section>}
        {deposit&&<section className="notice"><h2>Admission / Admin activation handoff</h2><p>Required initial deposit: {deposit.requiredPaise===null?"Not configured":formatINR(deposit.requiredPaise)} · actual patient deposit: {formatINR(deposit.paidPaise)} · remaining: {deposit.remainingPaise===null?"Policy review needed":formatINR(deposit.remainingPaise)}.</p>{deposit.policyIssue&&<p>{deposit.policyIssue}. Ask the hospital administrator to review financial settings.</p>}<p>Admission / Admin records the actual arrival and activates this episode. The reservation alone has not begun occupancy.</p>{staff.role==="ADMIN"&&<Link href={`/patients/${bill.admissionId}`}>Open the admission record for actual arrival</Link>}</section>}
        <div className="billing-metrics">{[["Posted net bill",bill.netPaise,"Gross charges minus linked reversals"],["Patient cash retained",bill.patientCashPaise,"After actual refunds; allocations add no cash"],["Unallocated deposit",bill.unallocatedDepositPaise,"Held cash pending explicit allocation"],["Insurer received",bill.insurerCashPaise,"Actual staff-recorded receipts"]].map(([label,amount,detail])=><section className="card metric" key={String(label)}><p>{String(label)}</p><strong>{formatINR(amount as bigint)}</strong><p className="caption">{String(detail)}</p></section>)}</div>
        <WorkflowTabs key={bill.admissionId} id="billing-episode" initialTab={tab??"charges"} items={[
          {id:"charges",label:"Charges",children:<div className="financial-work-columns"><section className="card">
        <h2>Itemised charges</h2>
        <p>Original charges remain visible; returns and corrections are linked new entries. Viewing or refreshing this bill posts nothing.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Itemised charges and original sources">
        <table>
        <thead>
        <tr>
        <th>Item / source</th>
        <th>Quantity / pinned rate</th>
        <th>Status / amount</th>
        </tr>
        </thead>
        <tbody>{bill.charges.map((line) => <tr key={line.id}>
            <td>{line.description}<p className="caption">{line.category} · {line.sourceEventId}</p><p className="caption">Charge {line.id} · {line.actorType} {line.actorId} · <HospitalTimestamp value={line.createdAt.toISOString()}/></p>{bill.status === "ADMITTED" && <details>
                <summary>Correct this charge</summary>
                <ReversalForm admissionId={bill.admissionId} chargeId={line.id} requestId={crypto.randomUUID()}/>
                </details>}</td>
            <td>{line.category === "room" ? `Cumulative stay: ${Math.floor(Number(line.quantity) / 3600000)} h ${Math.floor(Number(line.quantity) % 3600000 / 60000)} min ${Math.floor(Number(line.quantity) % 60000 / 1000)} s` : `${line.quantity} ${line.unit}`}<p className="caption">{formatINR(line.ratePaise)} · price version {line.tariffVersionId}</p>
            </td>
            <td>
            <span className="status">{line.status}</span>
            <p>{formatINR(line.amountPaise)}</p>
            </td>
            </tr>)}{bill.reversals.map((line) => <tr key={line.id}>
            <td>Linked reversal<p className="caption">Original charge {line.chargeId}</p>
            </td>
            <td>{line.reason}<p className="caption">{line.actorType} {line.actorId} · <HospitalTimestamp value={line.createdAt.toISOString()}/></p></td>
            <td>{formatINR(-line.amountPaise)}</td>
            </tr>)}</tbody>
        </table>
        </div>{!bill.charges.length && <p>No posted charge events yet.</p>}<p>Pending department charges: {formatINR(bill.pendingPaise)}.</p>
        <p>Unposted room estimate: {formatINR(bill.unpostedRoomPaise)}. Reading this page does not post charges.</p>{bill.status === "ADMITTED" && <ReconcileRoomForm admissionId={bill.admissionId} cutoff={bill.asOf.toISOString()} requestId={crypto.randomUUID()}/>}</section><aside className="card"><h2>Actual receipts and responsibility</h2><p>Patient retained cash {formatINR(bill.patientCashPaise)} · actual insurer receipt {formatINR(bill.insurerCashPaise)}.</p><p className="notice">Authorization is not cash. Current verified responsibility is reviewed separately from amounts received.</p><Link data-workflow-tab="receipts" className="button" href={`/billing?admissionId=${bill.admissionId}&tab=receipts`}>Open receipt work</Link><Link className="button secondary" href={relatedCase?`/insurance?caseId=${relatedCase}&tab=decision`:"/insurance"}>Review external insurance responsibility</Link>{bill.pendingPaise>0n&&<p className="notice">Pending department charges require source follow-up. Ask the source department to resolve the original event shown in Itemised charges. Missing prices or unfinished work cannot be treated as finalized or free.</p>}{bill.status==="ADMITTED"&&<Link className="button secondary" href={`/discharge?admissionId=${bill.admissionId}`}>Open final financial gate</Link>}</aside></div>},
          {id:"receipts",label:"Receipts & deposits",children:<div className="financial-form-columns"><section className="card"><h2>Record an actual receipt</h2><p className="caption">Use the actual hospital channel, source reference and receipt evidence.</p>{["PENDING", "ADMITTED"].includes(bill.status) && <>
        <ReceiptForm admissionId={bill.admissionId} requestId={crypto.randomUUID()}/></>}{!["PENDING","ADMITTED"].includes(bill.status)&&<p>This episode is closed. Later receipts require the authorized original-source Exceptions workflow.</p>}</section><section className="card">
        <h2>Money received & remaining</h2>
        <dl>
        <div>
        <dt>Allocated deposits</dt>
        <dd>{formatINR(bill.depositAllocatedPaise)}</dd>
        </div>
        <div>
        <dt>Payments and allocations against bill</dt>
        <dd>{formatINR(bill.billPaidPaise)}</dd>
        </div>
        <div>
        <dt>Posted bill outstanding</dt>
        <dd>{formatINR(bill.outstandingPaise)}</dd>
        </div>
        <div>
        <dt>Overpayment against posted bill</dt>
        <dd>{formatINR(bill.overpaidPaise)}</dd>
        </div>
        </dl>
        <p className="notice">{bill.payerResponsibility === "UNAVAILABLE" ? "Review current externally verified payer responsibility in discharge clearance." : "Self-pay responsibility, including any retained insurer liability after conversion, needs the current financial review in discharge clearance."} Pending charges and room estimates still require reconciliation.</p>
        <p>Staff-recorded; HIMS has not verified bank receipt.</p><Link data-workflow-tab="allocations" className="button secondary" href={`/billing?admissionId=${bill.admissionId}&tab=allocations`}>Review held deposit allocation</Link></section></div>},
          {id:"allocations",label:"Allocations",children:<div className="financial-work-columns"><section className="card"><h2>Apply an original held deposit</h2><p>Deposits remain held cash until explicitly allocated. Allocation applies money already received and creates no second payment.</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Original deposits and allocation work"><table><thead><tr><th>Original receipt</th><th>Held / allocated / returned</th><th>Allocate to current bill</th></tr></thead><tbody>{bill.receipts.filter(receipt=>receipt.kind!=="PAYMENT").map(receipt=>{
            const allocated=bill.activeAllocations.filter(item=>item.receiptId===receipt.id).reduce((sum,item)=>sum+item.amountPaise,0n),refunded=bill.refunds.filter(item=>item.receiptId===receipt.id).reduce((sum,item)=>sum+item.amountPaise,0n),available=receipt.amountPaise-allocated-refunded;
            return <tr key={receipt.id}><td><Link data-workflow-tab="history" href={`/billing?admissionId=${bill.admissionId}&tab=history#receipt-${receipt.id}`}>{receipt.reference}</Link><p className="caption">{receipt.id} · {receipt.kind} · {receipt.mode}<br/>{receipt.channel} / {receipt.sourceReference}<br/>{receipt.actorId} · <HospitalTimestamp value={receipt.createdAt.toISOString()}/><br/>Evidence: {receipt.evidenceId??"Not supplied"}</p></td><td>{formatINR(available)} held<p className="caption">Original {formatINR(receipt.amountPaise)} · allocated {formatINR(allocated)} · returned {formatINR(refunded)}</p></td><td>{bill.status==="ADMITTED"&&available>0n?<AllocationForm admissionId={bill.admissionId} receiptId={receipt.id} requestId={crypto.randomUUID()}/>:<p>{bill.status==="PENDING"?"Allocation follows actual admission; Admission / Admin owns activation.":available===0n?"No unallocated cash in this receipt.":"Use the authorized exception review for this closed episode."}</p>}</td></tr>;
          })}</tbody></table></div>{!bill.receipts.some(receipt=>receipt.kind!=="PAYMENT")&&<p>No deposit or top-up receipt recorded.</p>}<p className="caption">Allocation cancellation restores held cash and is separate from an actual refund. Gate 4 or specific exception authority controls those actions.</p></section><aside className="card"><h2 className="billing-subheading">Refund review</h2>
        <p>{bill.status === "CANCELLED" ? "Admin authorizes return of the original deposit in Exceptions. Billing records the actual returned money against that authority; this episode was never admitted." : "Refunds and deposit adjustments require Doctor → Pharmacy → Nursing clearances and Gate 4 review. Open discharge clearance for current human reviews and actual refund recording."}</p>
        {bill.status === "ADMITTED" && <Link className="button secondary" href={`/discharge?admissionId=${bill.admissionId}`}>Open discharge and refund review</Link>}
        {!["PENDING","ADMITTED"].includes(bill.status)&&<Link className="button secondary" href={`/exceptions?admissionId=${bill.admissionId}`}>Open authorized original-receipt return / correction</Link>}<h3>Actual refunds already recorded</h3>{bill.refunds.length?bill.refunds.map(refund=><div className="care-entry" key={refund.id}><strong>{formatINR(refund.amountPaise)}</strong><p>Original receipt <Link data-workflow-tab="history" href={`/billing?admissionId=${bill.admissionId}&tab=history#receipt-${refund.receiptId}`}>{refund.receiptId}</Link> · {refund.reason}</p><p className="caption">{refund.mode} · {refund.channel} / {refund.sourceReference} · <HospitalTimestamp value={refund.refundedAt.toISOString()}/> · evidence {refund.evidence}</p></div>):<p>No actual refund recorded. A review or cancelled allocation does not return cash.</p>}</aside></div>},
          {id:"history",label:"History",children:<><section className="card">
        <h2>Receipt and allocation history</h2>
        <p>Deposits remain held liabilities until allocated; allocation does not create another cash payment. Evidence references are entered manually.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Original receipt and allocation history">
        <table>
        <thead>
        <tr>
        <th>Manual receipt / evidence</th>
        <th>Cash received</th>
        <th>Allocated / action</th>
        </tr>
        </thead>
        <tbody>{bill.receipts.map((receipt) => {
                const allocated = bill.activeAllocations.filter((a) => a.receiptId === receipt.id).reduce((n, a) => n + a.amountPaise, 0n);
                const refunded = bill.refunds.filter(r=>r.receiptId===receipt.id).reduce((n,r)=>n+r.amountPaise,0n);
                return <tr key={receipt.id} id={`receipt-${receipt.id}`}>
                <td><strong>{receipt.reference}</strong><p className="caption">Original receipt {receipt.id}</p><p className="caption">{receipt.party} · {receipt.kind} · {receipt.mode}<br />{receipt.channel} / {receipt.sourceReference}<br />Cashier {receipt.actorId} · <HospitalTimestamp value={receipt.createdAt.toISOString()}/><br />Evidence: {receipt.evidenceId ?? "Not supplied"}</p>
                </td>
                <td>{formatINR(receipt.amountPaise)}<p className="caption">Returned {formatINR(refunded)} · retained {formatINR(receipt.amountPaise-refunded)}</p></td>
                <td>{formatINR(allocated)}</td>
                </tr>;
            })}</tbody>
        </table>
        </div>{!bill.receipts.length && <p>No manual receipts recorded.</p>}{bill.allocations.map((a) => <p className="caption" key={a.id}>Allocation {a.id} · {formatINR(a.amountPaise)} · original receipt <Link data-workflow-tab="history" href={`/billing?admissionId=${bill.admissionId}&tab=history#receipt-${a.receiptId}`}>{a.receiptId}</Link> · {a.reason} · recorded by {a.actorId} · <HospitalTimestamp value={a.createdAt.toISOString()}/> · {bill.cancellations.some(c=>c.allocationId===a.id)?"Cancelled by linked correction":"Active"}</p>)}{bill.refunds.map(r=><p className="caption" key={r.id}>Refund {formatINR(r.amountPaise)} · original receipt <Link data-workflow-tab="history" href={`/billing?admissionId=${bill.admissionId}&tab=history#receipt-${r.receiptId}`}>{r.receiptId}</Link> · {r.channel} / {r.sourceReference} · <HospitalTimestamp value={r.refundedAt.toISOString()}/> · {r.evidence} · {r.reason} · recorded by {r.actorId} · recorded <HospitalTimestamp value={r.createdAt.toISOString()}/></p>)}{bill.cancellations.length>0&&<details><summary>Linked allocation cancellations</summary>{bill.cancellations.map(cancellation=><div className="care-entry" key={cancellation.id}><strong>Allocation {cancellation.allocationId}</strong><p>{cancellation.reason}</p><p className="caption">{cancellation.actorId} · <HospitalTimestamp value={cancellation.createdAt.toISOString()}/> · reviewed bill {cancellation.reviewedBillVersion}</p></div>)}</details>}<p className="caption">Later corrections preserve the original financial record and require an accountable source review.</p><Link href={`/exceptions?admissionId=${bill.admissionId}`}>Open authorized financial source amendments</Link><Link className="button secondary" href={`/documents?admissionId=${bill.admissionId}`}>Open retained discharge document versions</Link></section></>},
        ]}/>
      </>}
    </>;
}
