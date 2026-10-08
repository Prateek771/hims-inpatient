"use client";
import { useActionState, type ReactNode } from "react";
import { saveAllocation, saveManualReceipt, saveReversal, startAdmission, postRoomThroughNow, type BillingActionState } from "@/app/(staff)/billing/actions";
const initial: BillingActionState = { message: "" };
function Result({ state }: {
    state: BillingActionState;
}) { return <p role="status" className={state.error ? "notice" : "caption"}>{state.message}</p>; }
function Field({ label, name, type = "text", required = true }: {
    label: string;
    name: string;
    type?: string;
    required?: boolean;
}) {
    return <label>{label}<input name={name} type={type} required={required} min={type === "number" ? "0.01" : undefined} step={type === "number" ? "0.01" : type === "datetime-local" ? "0.001" : undefined}/>
    </label>;
}
function Choice({ label, name, values }: {
    label: string;
    name: string;
    values: string[];
}) {
    return <label>{label}<select name={name}>{values.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}</select>
    </label>;
}
export function ReceiptForm({ admissionId, requestId, depositOnly = false }: {
    admissionId: string;
    requestId: string;
    depositOnly?: boolean;
}) {
    const [state, action, pending] = useActionState(saveManualReceipt.bind(null, admissionId, requestId), initial);
    return <form className="fields" action={action}>
    <Result state={state}/>
    <Choice label="Receipt party" name="party" values={depositOnly ? ["PATIENT"] : ["PATIENT", "INSURER"]}/>
    <Choice label="Receipt kind" name="kind" values={depositOnly ? ["DEPOSIT", "TOP_UP"] : ["DEPOSIT", "TOP_UP", "PAYMENT"]}/>
    <Field label="Amount received (INR)" name="amount" type="number"/>
    <Choice label="Payment mode" name="mode" values={["CASH", "CARD", "UPI", "BANK"]}/>
    <Field label="Cash book / channel account" name="channel"/>
    <Field label="Receipt number / transaction ID" name="sourceReference"/>
    <p className="caption">Use the same book/account and transaction identity for retries, even with a new form. Different book/account identities can use the same receipt number.</p>
    <Field label="Staff reference" name="reference"/>
    <Field label="Evidence reference (staff-entered, optional)" name="evidenceId" required={false}/>
    <button className="button" disabled={pending}>Record manual receipt</button>
    </form>;
}
function CorrectionForm({ action: actionFn, amountLabel, reasonLabel, button, children }: {
    action: (state: BillingActionState, form: FormData) => Promise<BillingActionState>;
    amountLabel: string;
    reasonLabel: string;
    button: string;
    children?: ReactNode;
}) {
    const [state, action, pending] = useActionState(actionFn, initial);
    return <form action={action} className="fields">
    <Result state={state}/>
    <Field label={amountLabel} name="amount" type="number"/>
    <Field label={reasonLabel} name="reason"/>{children}<button className="button secondary" disabled={pending}>{button}</button>
    </form>;
}
export function AllocationForm({ admissionId, receiptId, requestId }: {
    admissionId: string;
    receiptId: string;
    requestId: string;
}) { return <CorrectionForm action={saveAllocation.bind(null, admissionId, receiptId, requestId)} amountLabel="Allocate to bill (INR)" reasonLabel="Allocation reason" button="Allocate deposit"/>; }
export function ReversalForm({ admissionId, chargeId, requestId }: {
    admissionId: string;
    chargeId: string;
    requestId: string;
}) { return <CorrectionForm action={saveReversal.bind(null, admissionId, chargeId, requestId)} amountLabel="Reverse charge (INR)" reasonLabel="Reversal reason" button="Record linked reversal"/>; }
export function ActivationForm({ admissionId, version, requestId }: {
    admissionId: string;
    version: number;
    requestId: string;
}) {
    const [state, action, pending] = useActionState(startAdmission.bind(null, admissionId, version, requestId), initial);
    return <form className="fields" action={action}>
    <Result state={state}/>
    <Field label="Actual bed occupancy start (UTC)" name="arrivedAt" type="datetime-local"/>
    <p className="caption">Record when the patient actually occupied this bed, after reservation and no later than now. Registration and waiting time do not start room charges. The occupied stay snapshots its configured tariff.</p>
    <button className="button" disabled={pending}>Activate admission</button>
    </form>;
}
export function ReconcileRoomForm({ admissionId, cutoff, requestId }: {
    admissionId: string;
    cutoff: string;
    requestId: string;
}) {
    const [state, action, pending] = useActionState(postRoomThroughNow.bind(null, admissionId, cutoff, requestId), initial);
    return <form className="fields" action={action}>
    <Result state={state}/>
    <p className="caption">Posting cutoff: {cutoff} (UTC). Refresh for a later cutoff.</p>
    <button className="button secondary" disabled={pending}>Post room charges through captured cutoff</button>
    </form>;
}
