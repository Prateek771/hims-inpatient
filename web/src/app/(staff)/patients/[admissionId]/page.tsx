import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { getAdmission } from "@/server/admissions/commands";
import { DomainError } from "@/server/contracts";
import { CancelAdmissionForm } from "@/components/admission-forms";
import { getDepositSummary } from "@/server/billing/commands";
import { formatINR } from "@/server/billing/money";
import { ActivationForm, ReceiptForm } from "@/components/billing-forms";
import { HospitalTimestamp } from "@/components/hospital-timestamp";
import { WorkflowTabs } from "@/components/workflow-tabs";
import { isMvpEpisode } from "@/server/mvp/workspace";

export default async function PatientAdmissionPage({ params }: {
  params: Promise<{ admissionId: string }>;
}) {
  const staff = await requireStaff();
  const { admissionId } = await params;
  let record;
  try {
    record = await getAdmission(staffContext(staff, "admission-record"), admissionId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
  const operator = ["ADMISSION", "ADMIN"].includes(staff.role);
  const mvp = await isMvpEpisode(admissionId);
  const pending = record.status === "PENDING";
  const canReceive = operator && (pending || (staff.role === "ADMISSION" && record.status === "ADMITTED"));
  const deposit = operator ? await getDepositSummary(staffContext(staff, "deposit-summary"), admissionId) : null;
  const depositCheck = deposit && <section className="card"><h2>Deposit check</h2>
    <dl><div><dt>Configured required patient deposit</dt><dd>{deposit.requiredPaise === null ? "Policy unavailable" : formatINR(deposit.requiredPaise)}</dd></div>
      <div><dt>Actual patient deposits received</dt><dd>{formatINR(deposit.paidPaise)}</dd></div>
      <div><dt>Remaining initial deposit</dt><dd>{deposit.remainingPaise === null ? "Policy unavailable" : formatINR(deposit.remainingPaise)}</dd></div></dl>
    {deposit.policyIssue && <p className="notice">{deposit.policyIssue}</p>}
    <p>Recorded receipts remain separate from external insurer authorization. Billing manages allocation, wider settlement and actual refunds.</p>
  </section>;
  return <>
    <Link href={staff.role === "ADMIN" ? "/admin/beds" : staff.role === "ADMISSION" ? "/admissions" : "/clinical"}>Back to {staff.role === "ADMIN" ? "Beds" : staff.role === "ADMISSION" ? "Admissions" : "Patients"}</Link>
    <h1>{record.name}</h1>
    <p className="page-description">Patient admission record · permanent UHID and separate admission episode.</p>
    {mvp && <Link className="button secondary" href={`/mvp/${admissionId}`}>Open patient coordination, papers & exit</Link>}
    <section className="care-patient-context" aria-label="Current admission context">
      <div><strong>{record.uhid} · {record.ipCode}</strong><p>{record.bedLabel} · <span className="status">{record.status}</span></p></div>
      <div><strong>{record.identityStatus === "TEMPORARY" ? "Temporary identity" : "Recorded patient identity"}</strong><p>{pending ? "Bed reserved. Room charges have not started." : record.admittedAt ? <>Actual admission <HospitalTimestamp value={record.admittedAt.toISOString()} /></> : "No actual admission recorded."}</p></div>
    </section>
    <WorkflowTabs id={`admission-${admissionId}`} items={[
      { id: "intake", label: "Identity & intake", children: <div className="operations-columns">
        <section className="card"><h2>Stay status</h2><dl>
          <div><dt>Permanent patient identity</dt><dd>{record.uhid}</dd></div>
          <div><dt>Admission episode</dt><dd>{record.ipCode}</dd></div>
          <div><dt>Status</dt><dd><span className="status">{record.status}</span></dd></div>
          <div><dt>Bed</dt><dd>{record.bedLabel}</dd></div>
          <div><dt>Registration</dt><dd><HospitalTimestamp value={record.registeredAt.toISOString()} /></dd></div>
          <div><dt>Actual admission</dt><dd>{record.admittedAt ? <HospitalTimestamp value={record.admittedAt.toISOString()} /> : "Not yet admitted"}</dd></div>
          <div><dt>Identity age / sex</dt><dd>{record.dateOfBirth ?? (record.ageYearsAtRegistration === null ? "Age unknown" : `${record.ageYearsAtRegistration} years recorded at identity registration (${record.identityRegisteredAt.toLocaleDateString("en-IN")})`)} · {record.sex}</dd></div>
          {"phone" in record && <div><dt>Contact</dt><dd>{record.phone ? String(record.phone) : "Not provided"}</dd></div>}
          {"paymentRoute" in record && <div><dt>Payment route</dt><dd>{String(record.paymentRoute)}</dd></div>}
          {record.identityStatus === "TEMPORARY" && <div><dt>Temporary identity provenance</dt><dd>{record.identityProvenance ?? "Retained temporary identity"}</dd></div>}
          {record.identityAmendmentId && <div><dt>Verified identification version</dt><dd>{record.identityAmendmentId}</dd></div>}
        </dl></section>
        <div>
          {"clinicianAssessment" in record && record.clinicianAssessment && <section className="card"><h2>Recorded clinician assessment</h2><dl>
            <div><dt>Chief complaint</dt><dd>{record.clinicianAssessment.chiefComplaint}</dd></div>
            <div><dt>Vitals</dt><dd>{record.clinicianAssessment.vitals}</dd></div>
            <div><dt>Routing assessment</dt><dd>{record.clinicianAssessment.triage}</dd></div>
            <div><dt>Selected destination</dt><dd>{record.clinicianAssessment.destinationCategory}</dd></div>
            <div><dt>Assessing clinician / assessment time</dt><dd>{record.clinicianAssessment.clinicianId} · <HospitalTimestamp value={record.clinicianAssessment.assessedAt} /></dd></div>
            {record.clinicianAssessment.overrideReason && <div><dt>Destination override reason</dt><dd>{record.clinicianAssessment.overrideReason}</dd></div>}
          </dl><p className="caption">Recorded clinician-provided intake is distinct from a professional clearance seal.</p></section>}
          {pending && <section className="notice"><h2>Awaiting activation</h2><p>The reservation creates no occupied stay. Record actual patient deposits, then review actual arrival.</p></section>}
          {operator && <section className="card"><h2>Next responsible work</h2><div className="actions">
            {"paymentRoute" in record && record.paymentRoute === "INSURED" && <Link href={`/insurance?admissionId=${admissionId}`}>Create limited insurance case</Link>}
            <Link href={`/exceptions?admissionId=${admissionId}`}>{record.identityStatus === "TEMPORARY" ? "Urgent authority and verified identification" : "Exception authority and retained follow-up"}</Link>
          </div>{record.status === "CANCELLED" && <p>Cancellation retains the UHID, IP code and any held cash. Admin/Billing records a source-bound cancelled-deposit return through Exceptions.</p>}</section>}
        </div>
      </div> },
      ...(canReceive ? [{ id: "deposit", label: "Patient deposit", children: <div className="operations-columns">
        <section className="card"><h2>Patient deposits and top-ups</h2><p className="caption">Record actual hospital receipt evidence. This form accepts patient deposits and top-ups only.</p><ReceiptForm admissionId={admissionId} requestId={crypto.randomUUID()} depositOnly /></section>{depositCheck}
      </div> }] : []),
      ...(pending && operator ? [
        { id: "activate", label: "Actual arrival", children: <div className="operations-columns"><section className="card"><h2>Actual arrival and deposit check</h2><ActivationForm admissionId={admissionId} version={record.version} requestId={crypto.randomUUID()} /></section><div>{depositCheck}<section className="notice"><h2>Urgent no-deposit route</h2><p>Current named Admin authority is required for urgent activation. The configured deposit obligation remains outstanding.</p><Link href={`/exceptions?admissionId=${admissionId}`}>Review urgent exception</Link></section></div></div> },
        { id: "cancel", label: "Cancel pending episode", children: <section className="card"><h2>Cancel pending episode</h2><p className="caption">The permanent identity, episode code, reason and any held money remain in history. Active admissions cannot be cancelled here.</p><CancelAdmissionForm admissionId={admissionId} /></section> },
      ] : []),
    ]} />
  </>;
}
