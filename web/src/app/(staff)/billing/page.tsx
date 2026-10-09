import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { billingWorkspace, getBill } from "@/server/billing/commands";
import { formatINR } from "@/server/billing/money";
import { DomainError } from "@/server/contracts";
import { AllocationForm, ReceiptForm, ReconcileRoomForm, ReversalForm } from "@/components/billing-forms";
export default async function BillingPage({ searchParams }: {
    searchParams: Promise<{
        admissionId?: string;
    }>;
}) {
    const staff = await requireStaff();
    if (!["ADMIN", "BILLING"].includes(staff.role))
        notFound();
    const ctx = staffContext(staff, "billing-view");
    const workspace = await billingWorkspace(ctx);
    const { admissionId } = await searchParams;
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
    return <>
    <p className="eyebrow">03 · Charges & money / Billing</p>
    <h1>One bill. Every receipt visible.</h1>
    <p className="page-description">Reconcile posted charges, deposits and manually recorded hospital payments.</p>
    <section className="card">
    <h2>Billing worklist</h2><details open={!bill}><summary>{bill ? "Choose another admission — all ongoing episodes and held-cash reviews" : "Choose an admission"}</summary>{workspace.length ? <ul className="patient-results">{workspace.map((row) => <li key={row.id}>
            <Link href={`/billing?admissionId=${row.id}`}>{row.name} · {row.ipCode} · {row.bedLabel} · {row.status}{row.requiresCashReview ? ` · Never admitted; held cash ${formatINR(row.heldCashPaise)} — admin review required` : ""}</Link>
            </li>)}</ul> : <p>No pending or admitted episodes. Configure financial policies in hospital settings before activation.</p>}</details></section>
    {bill && <>
      {bill.status === "CANCELLED" && <section className="notice"><h2>Cancelled before admission — held cash needs admin review</h2><p>The reservation was cancelled and no occupied stay began. Actual recorded cash remains visible; cancellation does not return money. An administrator-authorized cancelled-deposit return/exception workflow is required and will be available in the exception phase.</p></section>}
      <section className="card billing-identity">
        <h2>{selected?.name ?? bill.ipCode}</h2>
        <p>{bill.ipCode} · {selected?.bedLabel} · <span className="status">{bill.status}</span> · {bill.paymentRoute}</p>
        <p className="caption">Financial revision {bill.revision} · captured {bill.asOf.toISOString()} (UTC)</p>
        </section>
      <div className="billing-metrics">{[["Posted net bill", bill.netPaise, "Gross charges minus linked reversals"], ["Patient cash retained", bill.patientCashPaise, "After actual refunds; allocations add no cash"], ["Unallocated deposit", bill.unallocatedDepositPaise, "Held liability pending allocation"], ["Insurer received", bill.insurerCashPaise, "Actual staff-recorded receipts"]].map(([label, amount, detail]) => <section className="card metric" key={String(label)}>
            <p>{String(label)}</p>
            <strong>{formatINR(amount as bigint)}</strong>
            <p className="caption">{String(detail)}</p>
            </section>)}</div>
      <div className="billing-columns">
        <section className="card">
        <h2>Itemised charges</h2>
        <p>Original charges remain visible; returns and corrections are linked new entries.</p>
        <div className="table-scroll">
        <table>
        <thead>
        <tr>
        <th>Item / source</th>
        <th>Quantity / pinned rate</th>
        <th>Status / amount</th>
        </tr>
        </thead>
        <tbody>{bill.charges.map((line) => <tr key={line.id}>
            <td>{line.description}<p className="caption">{line.category} · {line.sourceEventId}</p>{bill.status === "ADMITTED" && <details>
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
            <td>{line.reason}</td>
            <td>{formatINR(-line.amountPaise)}</td>
            </tr>)}</tbody>
        </table>
        </div>{!bill.charges.length && <p>No posted charge events yet.</p>}<p>Pending department charges: {formatINR(bill.pendingPaise)}.</p>
        <p>Unposted room estimate: {formatINR(bill.unpostedRoomPaise)}. Reading this page does not post charges.</p>{bill.status === "ADMITTED" && <ReconcileRoomForm admissionId={bill.admissionId} cutoff={bill.asOf.toISOString()} requestId={crypto.randomUUID()}/>}</section>
      <section className="card">
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
        <p className="notice">{bill.payerResponsibility === "UNAVAILABLE" ? "Review current externally verified payer responsibility in discharge clearance." : "Self-pay: patient responsibility is the reconciled bill."} Pending charges and room estimates still require reconciliation.</p>
        <p>Staff-recorded; HIMS has not verified bank receipt.</p>
        {["PENDING", "ADMITTED"].includes(bill.status) && <><h2>Record a manual receipt</h2>
        <ReceiptForm admissionId={bill.admissionId} requestId={crypto.randomUUID()}/></>}
        <h2 className="billing-subheading">Refund review</h2>
        <p>{bill.status === "CANCELLED" ? "Cancelled-deposit returns require explicit administrator authority and the exception/return workflow, which is not yet available. This episode was never admitted." : "Refunds and deposit adjustments require Doctor → Pharmacy → Nursing clearances and Gate 4 review. Open discharge clearance for current human reviews and actual refund recording."}</p>
        {bill.status === "ADMITTED" && <Link className="button secondary" href={`/discharge?admissionId=${bill.admissionId}`}>Open discharge and refund review</Link>}
        </section>
        </div>
      <section className="card">
        <h2>Receipt and allocation history</h2>
        <p>Deposits remain held liabilities until allocated; allocation does not create another cash payment. Evidence references are entered manually.</p>
        <div className="table-scroll">
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
                return <tr key={receipt.id}>
                <td>{receipt.reference}<p className="caption">{receipt.party} · {receipt.kind} · {receipt.mode}<br />{receipt.channel} / {receipt.sourceReference}<br />Cashier {receipt.actorId} · {receipt.createdAt.toISOString()}<br />Evidence: {receipt.evidenceId ?? "Not supplied"}</p>
                </td>
                <td>{formatINR(receipt.amountPaise)}<p className="caption">Returned {formatINR(refunded)} · retained {formatINR(receipt.amountPaise-refunded)}</p></td>
                <td>{formatINR(allocated)}{receipt.kind !== "PAYMENT" && bill.status === "ADMITTED" && allocated + refunded < receipt.amountPaise && <AllocationForm admissionId={bill.admissionId} receiptId={receipt.id} requestId={crypto.randomUUID()}/>}</td>
                </tr>;
            })}</tbody>
        </table>
        </div>{!bill.receipts.length && <p>No manual receipts recorded.</p>}{bill.allocations.map((a) => <p className="caption" key={a.id}>Allocation {a.id} · {formatINR(a.amountPaise)} · receipt {a.receiptId} · {a.reason} · {a.createdAt.toISOString()} · {bill.cancellations.some(c=>c.allocationId===a.id)?"Cancelled by linked correction":"Active"}</p>)}{bill.refunds.map(r=><p className="caption" key={r.id}>Refund {formatINR(r.amountPaise)} · original receipt {r.receiptId} · {r.channel} / {r.sourceReference} · {r.refundedAt.toISOString()} · {r.evidence} · {r.reason}</p>)}</section>
    </>}
  </>;
}
