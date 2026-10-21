import { requireStaff, staffContext } from "@/server/access";
import { getMvpTransferState } from "@/server/mvp/transfers";
import { getDoctorDirectory } from "@/server/mvp/staff";
import { saveMvpTransfer } from "@/app/(staff)/mvp/[admissionId]/transfer-actions";
import { CareField, CareForm } from "./care-forms";
import { HospitalTimestamp } from "./hospital-timestamp";
import { SearchableSelect } from "./searchable-select";
const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
export async function MvpTransfers({ admissionId, open, ownShifts }: { admissionId: string; open: boolean; ownShifts: { id: string; startedAt: string }[] }) {
  const staff = await requireStaff(), ctx = staffContext(staff, "mvp-transfer-view");
  const [state, doctors] = await Promise.all([getMvpTransferState(ctx, admissionId), getDoctorDirectory(ctx)]);
  const writable = staff.role === "NURSE" && open;
  const currentBed = state.timeline.find(stay => stay.id === state.currentStay?.id);
  const action = (operation: string, authorityId = "") => saveMvpTransfer.bind(null, admissionId, operation, state.episodeVersion, authorityId, crypto.randomUUID());
  const externalAuthority = <><SearchableSelect name="externalDoctorId" label="Doctor directory identity" required placeholder="Choose the external clinical authorizer" options={doctors.filter(doctor => doctor.active).map(doctor => ({ value: doctor.id, label: doctor.name }))} /><CareField name="authorizerName" label="Named external transfer authorizer" /><CareField name="sourceTime" label="External transfer instruction time (UTC)" type="datetime-local" /><CareField name="evidence" label="External transfer instruction / evidence" /><CareField name="reason" label="Transfer instruction reason" /></>;
  return <>
    <h2>Bed transfer & actual handover</h2><p>Record the external Doctor’s instruction, then the assigned Nurse records the real move. Old and new room-use boundaries meet exactly; reserved or unclean beds cannot be reused.</p>
    {state.currentStay ? <p className="caption">Current bed: {currentBed?.bedLabel ?? "Bed label unavailable"} · {currentBed?.bedCategory ?? "Category unavailable"} · room use started <HospitalTimestamp value={date(state.currentStay.startedAt)} /> · reconciled through <HospitalTimestamp value={date(state.currentStay.lastReconciledAt)} /></p> : <p className="notice">No current occupied stay. A return to a bed requires its separate recorded authority and history.</p>}
    <section className="card"><h3>Bed stay timeline</h3><p className="caption">Oldest stay first. Bed labels and categories reflect the current configuration; times use the hospital timezone.</p>
      <ol>{state.timeline.map(stay => {
        const transfer = stay.transfer;
        const authority = transfer && state.authorities.find(source => source.id === transfer.mvpAuthorityId);
        return <li className="mvp-action" key={stay.id} data-stay-id={stay.id}>
          <h4>{stay.bedLabel} · {stay.bedCategory}</h4>
          <p>From <HospitalTimestamp value={date(stay.startedAt)} /> · To {stay.endedAt ? <HospitalTimestamp value={date(stay.endedAt)} /> : "Continuing"}</p>
          {transfer && <><p className="caption">Actual move <HospitalTimestamp value={date(transfer.transferredAt)} /> · recorded by {transfer.recorderName ?? transfer.signedBy} at <HospitalTimestamp value={date(transfer.signedAt)} /></p><p className="caption">Handover: {transfer.handover}</p>{authority && <p className="caption">External clinical authorizer: {authority.authorizerName} · instruction <HospitalTimestamp value={date(authority.sourceTime)} /></p>}</>}
        </li>;
      })}</ol>{!state.timeline.length && <p>No bed stay is recorded for this episode.</p>}
    </section>
    {writable && state.currentStay && <details className="mvp-action"><summary>Record external transfer authority</summary><CareForm action={action("record")} button="Record transfer authority" testId="mvp-transfer-authority">{externalAuthority}<label>Doctor-selected destination category<select name="destinationCategory" required defaultValue=""><option value="">Choose recorded destination</option>{state.categories.map(category => <option value={category.code} key={category.code}>{category.name}</option>)}</select></label></CareForm></details>}
    <section className="card"><h3>Retained transfer instructions</h3>{state.authorities.map(authority => <section className="mvp-action" key={authority.id}><h3>{authority.destinationCategory} · {authority.status}</h3><p>{authority.authorizerName} · source <HospitalTimestamp value={date(authority.sourceTime)} /></p><p className="caption">{authority.evidence} · {authority.reason}</p><p className="caption">Recorded <HospitalTimestamp value={date(authority.recordedAt)} /> · separate staff recorder {authority.recordedBy}</p>
      {writable && authority.status === "PENDING" && <><details className="mvp-action"><summary>Record actual transfer & handover</summary><CareForm action={action("execute", authority.id)} button="Record actual transfer" testId="mvp-transfer"><SearchableSelect name="targetBedId" label="Available matching bed" required placeholder="Choose currently available destination bed" options={state.beds.filter(bed => bed.available && bed.category === authority.destinationCategory).map(bed => ({ value: bed.id, label: `${bed.label} · ${state.categories.find(c => c.code === bed.category)?.name ?? bed.category}` }))} /><label>Your care shift<select name="shiftId" required defaultValue=""><option value="">Choose recorded care shift</option>{ownShifts.map(shift => <option value={shift.id} key={shift.id}>{shift.startedAt}</option>)}</select></label><CareField name="transferredAt" label="Actual transfer time (UTC)" type="datetime-local" /><CareField name="handover" label="Actual destination nursing handover" /></CareForm></details><details className="mvp-action"><summary>Record external cancellation instruction</summary><CareForm action={action("cancel", authority.id)} button="Record transfer cancellation">{externalAuthority}</CareForm></details></>}
    </section>)}{!state.authorities.length && <p>No external transfer instruction is recorded for this episode.</p>}</section>
  </>;
}
