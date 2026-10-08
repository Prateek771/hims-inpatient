import { notFound } from "next/navigation";
import { requireStaff, staffContext } from "@/server/access";
import { getAdmission } from "@/server/admissions/commands";
import { DomainError } from "@/server/contracts";
import { CancelAdmissionForm } from "@/components/admission-forms";

export default async function PatientAdmissionPage({
  params,
}: {
  params: Promise<{ admissionId: string }>;
}) {
  const staff = await requireStaff();
  const { admissionId } = await params;
  let record;
  try {
    record = await getAdmission(
      staffContext(staff, "admission-record"),
      admissionId,
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
  return (
    <>
      <p className="eyebrow">Patient admission record</p>
      <h1>{record.name}</h1>
      <p className="page-description">
        {record.uhid} · {record.ipCode}
      </p>
      <section className="card">
        <h2>Stay status</h2>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>
              <span className="status">{record.status}</span>
            </dd>
          </div>
          <div>
            <dt>Bed</dt>
            <dd>{record.bedLabel}</dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>{record.registeredAt.toLocaleString("en-IN")}</dd>
          </div>
          <div>
            <dt>Actual admission</dt>
            <dd>
              {record.admittedAt?.toLocaleString("en-IN") ?? "Not yet admitted"}
            </dd>
          </div>
          <div>
            <dt>Identity age / sex</dt>
            <dd>
              {record.dateOfBirth ??
                `${record.ageYearsAtRegistration} years recorded at identity registration (${record.identityRegisteredAt.toLocaleDateString("en-IN")})`}{" "}
              · {record.sex}
            </dd>
          </div>
          {"phone" in record && (
            <div>
              <dt>Contact</dt>
              <dd>{record.phone ? String(record.phone) : "Not provided"}</dd>
            </div>
          )}
          {"paymentRoute" in record && (
            <div>
              <dt>Payment route</dt>
              <dd>{String(record.paymentRoute)}</dd>
            </div>
          )}
        </dl>
      </section>
      {"clinicianAssessment" in record && record.clinicianAssessment && (
        <section className="card">
          <h2>Recorded clinician assessment</h2>
          <dl>
            <div>
              <dt>Chief complaint</dt>
              <dd>{record.clinicianAssessment.chiefComplaint}</dd>
            </div>
            <div>
              <dt>Vitals</dt>
              <dd>{record.clinicianAssessment.vitals}</dd>
            </div>
            <div>
              <dt>Routing assessment</dt>
              <dd>{record.clinicianAssessment.triage}</dd>
            </div>
            <div>
              <dt>Selected destination</dt>
              <dd>{record.clinicianAssessment.destinationCategory}</dd>
            </div>
            <div>
              <dt>Assessing clinician / assessment time</dt>
              <dd>
                {record.clinicianAssessment.clinicianId} ·{" "}
                {record.clinicianAssessment.assessedAt}
              </dd>
            </div>
            {record.clinicianAssessment.overrideReason && (
              <div>
                <dt>Destination override reason</dt>
                <dd>{record.clinicianAssessment.overrideReason}</dd>
              </div>
            )}
          </dl>
        </section>
      )}
      {record.status === "PENDING" && (
        <section className="notice">
          <h2>Awaiting activation</h2>
          <p>
            A bed is reserved. Room charges have not started. Deposit checks and
            activation are handled in the deposit workflow.
          </p>
        </section>
      )}
      {record.status === "PENDING" &&
        ["ADMISSION", "ADMIN"].includes(staff.role) && (
          <section className="card">
            <h2>Cancel pending episode</h2>
            <CancelAdmissionForm admissionId={admissionId} />
          </section>
        )}
    </>
  );
}
