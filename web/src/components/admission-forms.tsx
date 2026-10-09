"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addBed,
  cancelPendingAdmission,
  removeAvailableBed,
  savePendingAdmission,
  type AdmissionActionState,
} from "@/app/(staff)/admissions/actions";

const initial: AdmissionActionState = { message: "" };
type Option = { id: string; name: string };
type Category = { code: string; name: string };
type DepositRule = {
  category: string;
  route: "self-pay" | "insured";
  amount: string;
  requirement: "required" | "not-required";
  version: number;
};
type Bed = {
  id: string;
  label: string;
  category: string;
  active: boolean;
  admissionId: string | null;
};

function Result({ state }: { state: AdmissionActionState }) {
  return state.message ? (
    <p className="notice" role={state.error ? "alert" : "status"}>
      {state.message}
    </p>
  ) : null;
}

export function AdmissionForm({
  requestId,
  doctors,
  categories,
  beds,
  depositRules,
  patient,
}: {
  requestId: string;
  doctors: Option[];
  categories: Category[];
  beds: Bed[];
  depositRules: DepositRule[];
  patient?: {
    id: string;
    uhid: string;
    name: string;
    dateOfBirth: string | null;
    ageYearsAtRegistration: number | null;
    sex: string;
  };
}) {
  const [state, action, pending] = useActionState(
    savePendingAdmission.bind(null, requestId),
    initial,
  );
  const [temporaryIdentity, setTemporaryIdentity] = useState(false);
  const [assessmentTime, setAssessmentTime] = useState("");
  const [selectedBed, setSelectedBed] = useState("");
  const [paymentRoute, setPaymentRoute] = useState("SELF_PAY");
  const category = beds.find((b) => b.id === selectedBed)?.category;
  const deposit = depositRules.find(
    (rule) =>
      rule.category === category &&
      rule.route === (paymentRoute === "SELF_PAY" ? "self-pay" : "insured"),
  );
  const assessmentDate = new Date(assessmentTime);
  const assessmentIso = Number.isFinite(assessmentDate.getTime())
    ? assessmentDate.toISOString()
    : "";
  const available = beds.filter(
    (b) =>
      b.active &&
      !b.admissionId &&
      !("cleaning" in b && b.cleaning) &&
      categories.some((c) => c.code === b.category),
  );
  const unavailable =
    !available.length || !doctors.length || !categories.length;
  return (
    <form action={action}>
      <div className="admission-columns">
        <section className="card admission-details">
          <h2>Patient &amp; admission details</h2>
          <p className="caption">
            Permanent patient identity stays the same; a new admission code is
            created for each stay.
          </p>
          {patient ? (
            <div className="notice">
              <h3>Existing patient selected</h3>
              <p>
                {patient.name} · {patient.uhid} ·{" "}
                {patient.dateOfBirth ??
                  (patient.ageYearsAtRegistration===null?"Age unknown":`${patient.ageYearsAtRegistration} years at registration`)}{" "}
                · {patient.sex}
              </p>
              <input type="hidden" name="patientId" value={patient.id} />
              <Link href="/admissions">Register a different patient</Link>
            </div>
          ) : (
            <div className="fields admission-fields">
              <label className="span-two">Identity status<select name="identityStatus" value={temporaryIdentity?"TEMPORARY":"KNOWN"} onChange={e=>setTemporaryIdentity(e.target.value==="TEMPORARY")}><option value="KNOWN">Known patient identity</option><option value="TEMPORARY">Urgent temporary identity / facts unknown</option></select></label>
              {temporaryIdentity&&<label className="span-two">Actual intake identity provenance<textarea name="identityProvenance" required minLength={3} maxLength={500}/><span className="caption">Leave unknown name, date of birth and age blank. A unique temporary label is generated. Administrator urgent authority is required before activation.</span></label>}
              <label>
                Patient name
                <input
                  name="name"
                  required={!temporaryIdentity}
                  minLength={2}
                  maxLength={150}
                  autoComplete="off"
                />
              </label>
              <label>
                Date of birth (if known)
                <input name="dateOfBirth" type="date" />
              </label>
              <label>
                Age in years (if birth date unknown)
                <input name="ageYears" type="number" min={0} max={130} />
              </label>
              <label>
                Sex
                <select name="sex" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  {["FEMALE", "MALE", "OTHER", "UNKNOWN"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Contact number (if available)
                <input
                  name="phone"
                  type="tel"
                  minLength={7}
                  maxLength={25}
                  autoComplete="off"
                />
              </label>
            </div>
          )}
          <div className="fields admission-fields">
            <label>
              Admitting doctor
              <select name="admittingDoctorId" required defaultValue="">
                <option value="" disabled>
                  Select active doctor
                </option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assessing clinician
              <select name="clinicianId" required defaultValue="">
                <option value="" disabled>
                  Select active doctor
                </option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assessment time (your local time)
              <input
                name="assessmentLocalTime"
                type="datetime-local"
                required
                value={assessmentTime}
                onChange={(event) => setAssessmentTime(event.target.value)}
              />
              <input type="hidden" name="assessedAt" value={assessmentIso} />
            </label>
            <div className="intake-time">
              <span>Registration time</span>
              <p>
                Recorded on saving. Actual admission starts after deposit
                checks.
              </p>
            </div>
            <label>
              Chief complaint
              <textarea
                name="chiefComplaint"
                required
                minLength={2}
                maxLength={2000}
              />
            </label>
            <label>
              Clinical routing assessment
              <textarea name="triage" required minLength={2} maxLength={500} />
            </label>
            <label>
              Clinician-recorded vitals
              <textarea name="vitals" required minLength={2} maxLength={2000} />
            </label>
            <label>
              Clinician-selected destination
              <select name="destinationCategory" required defaultValue="">
                <option value="" disabled>
                  Select recorded destination
                </option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Reason for destination override (if selected bed differs)
              <input name="overrideReason" minLength={3} maxLength={500} />
            </label>
          </div>
          <div className="notice admission-code">
            <h3>Admission code is generated when saved</h3>
            <p>
              The pending episode reserves a bed. It does not start room charges
              or confirm that a required deposit has been received.
            </p>
          </div>
          {unavailable && (
            <p role="alert">
              An administrator must configure active categories and available
              beds, and provide an active doctor before intake can be saved.
            </p>
          )}
          <button
            className="button"
            disabled={pending || unavailable || Boolean(state.admissionId)}
          >
            Save pending admission
          </button>
        </section>
        <section className="card admission-payment">
          <h2>Bed &amp; payment route</h2>
          <div className="fields">
            <label>
              Payment route
              <select
                name="paymentRoute"
                value={paymentRoute}
                onChange={(event) => setPaymentRoute(event.target.value)}
              >
                <option value="SELF_PAY">Self-pay</option>
                <option value="INSURED">Insurance</option>
              </select>
            </label>
            <label>
              Bed assignment
              <select
                name="bedId"
                required
                value={selectedBed}
                onChange={(event) => setSelectedBed(event.target.value)}
              >
                <option value="" disabled>
                  Select available bed
                </option>
                {available.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} · {b.category} · Available
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expected stay (days)
              <input
                name="expectedStayDays"
                type="number"
                min={1}
                max={365}
                required
                defaultValue={1}
              />
            </label>
          </div>
          {category && (
            <div className="notice">
              <h3>Configured initial deposit</h3>
              <p>
                {deposit
                  ? deposit.requirement === "required"
                    ? `₹${(Number(deposit.amount) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} required · rule version ${deposit.version}`
                    : `No initial deposit required · rule version ${deposit.version}`
                  : "No deposit rule configured for this room and payment route. Configure the rule before activation."}
              </p>
              <p>
                Saving this episode does not record a receipt or satisfy the
                deposit rule.
              </p>
            </div>
          )}
          <p>
            Insurance verification is completed externally by the insurer / TPA
            or hospital staff. Verified records will be entered in the insurance
            workflow.
          </p>
          <div className="notice">
            <h3>Pending deposit checks</h3>
            <p>
              Cashier receipts and activation become available in the deposit
              workflow. Urgent no-deposit exceptions require administrator
              authority.
            </p>
          </div>
        </section>
      </div>
      <Result state={state} />
      {state.admissionId && (
        <div className="actions">
          <Link className="button" href={`/patients/${state.admissionId}`}>
            Open admission record
          </Link>
          <a className="button secondary" href="/admissions">
            Start another admission
          </a>
        </div>
      )}
    </form>
  );
}

export function CancelAdmissionForm({ admissionId }: { admissionId: string }) {
  const [state, action, pending] = useActionState(
    cancelPendingAdmission.bind(null, admissionId),
    initial,
  );
  return (
    <form action={action} className="fields">
      <label>
        Cancellation reason
        <input name="reason" required minLength={3} maxLength={500} />
      </label>
      <button className="button" disabled={pending}>
        Cancel pending admission
      </button>
      <Result state={state} />
    </form>
  );
}

export function AddBedForm({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState(addBed, initial);
  return (
    <form action={action} className="fields">
      <label>
        Bed label
        <input name="label" required minLength={2} maxLength={80} />
      </label>
      <label>
        Room category
        <select name="category" defaultValue="" required>
          <option value="" disabled>
            Select configured category
          </option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason for adding bed
        <input name="reason" required minLength={3} maxLength={500} />
      </label>
      <button className="button" disabled={pending || !categories.length}>
        Add bed
      </button>
      <Result state={state} />
    </form>
  );
}

export function DisableBedForm({ bedId }: { bedId: string }) {
  const [state, action, pending] = useActionState(
    removeAvailableBed.bind(null, bedId),
    initial,
  );
  return (
    <form action={action} className="fields">
      <label>
        Reason for disabling bed
        <input name="reason" required minLength={3} maxLength={500} />
      </label>
      <button className="button secondary" disabled={pending}>
        Disable bed
      </button>
      <Result state={state} />
    </form>
  );
}
