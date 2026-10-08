# Confirmed project scope

Recorded **9 October 2026** from the owner's decisions, the supplied requirements source, PDF/image overview and approved Figma prototype. This is the product scope, not an implementation plan.

## What we are building and whom it helps

A standalone inpatient HIMS for **one hospital**. Hospital staff share one admission record from arrival through treatment, charges, paperwork, four human clearances and final discharge. The aim is to reduce missing information, repeated staff work, shift-handover gaps, billing mistakes and discharge delays.

| User | Main responsibility and workspace |
|---|---|
| Hospital admin/head | Operational overview, staff access, beds/tariffs/rules, exceptions and audit visibility |
| Admission/emergency desk | Patient identity, admission, clinician-entered triage, bed allocation and deposit/insurance information |
| Doctor | Rounds, clinical notes, orders, transfers, prescription and clinical discharge approval |
| Nurse/ward team | Shift attendance, vitals, medication administration, handover, consumables and nursing clearance |
| Pharmacy | Medicine stock, issue/return records, take-home preparation and pharmacy clearance |
| Lab/radiology staff | Ordered work, sample/barcode tracking where applicable, results/report completion and charge linkage |
| Insurance desk/staff | Enter externally verified insurance decisions; prepare/check paperwork and manage follow-up tasks |
| Billing/cashier/admin | Charges, deposits, receipts, refunds, final reconciliation and final administrative clearance |

Patients benefit through coordinated care, transparent bills and complete discharge papers. A patient-facing portal, multi-hospital platform and a full outpatient system are outside the confirmed scope.

## Owner decisions that control the scope

| Decision | Confirmed behavior |
|---|---|
| Product coverage | All five inpatient stages below, for a single hospital |
| Pharmacy/lab/barcodes | Native hospital operational workflows are included |
| Insurance authority | Insurer/TPA or hospital staff verify externally; staff feed verified data and decisions into HIMS |
| Insurer connections | No direct insurer tie-up, eligibility verification service or live insurer integration |
| AI boundary | Only insurance paperwork, document completeness and staff follow-up help before discharge; humans verify and approve material actions |
| Payments | Staff record existing cash/card/UPI/bank payments and evidence; payment-service integration is for later |
| Ordinary insured discharge | Actual insurer funds owed must be received, in addition to patient settlement; authorization alone is insufficient |
| Changed information | Repeat only affected checks and dependent approvals, preserving unaffected staff approvals |
| Exceptions | Admin manages exceptional cases, records authority/reason/follow-up and outstanding obligations |
| Design direction | The Figma prototype is approved; preserve its clean, minimal hospital layout and role-specific presentation |
| Technology | Next.js frontend/backend, local PostgreSQL for now, LangGraph human-in-the-loop workflows |

## 1. Patient intake and identity creation

**Actors:** admission/emergency desk, admitting clinician, bed staff and cashier as applicable.

- Find/create the permanent patient identity (UHID/MRN). Create a separate unique IP code for each admission; a patient may have several admissions.
- Source default: `IP-YYYY-NNNNN`, sequence resetting each year. Generate on the server with transactional concurrency protection. Never reuse a code; cancelled admissions retain their code and status. Uniqueness takes priority over a promise of gapless numbering.
- Capture patient details, chief complaint, clinician's vitals/triage assessment, admitting doctor and admission timestamp. Clinicians decide clinical destination; record overrides and reasons.
- Show available ICU/General/Semi-private/Private beds. Allocate and lock a bed with its room category and tariff version. Prevent two admissions from holding the same occupied bed.
- Insured route: staff record insurer/TPA, policy/member details, validity as verified externally, documents, verification provenance and pre-authorization status (`PENDING`, `APPROVED`, `PARTIAL`, `REJECTED`), approved amount, reference, date, co-pay and exclusions. Staff record appeals, enhancements, denial decisions or conversion to self-pay.
- HIMS can assemble paperwork and flag missing fields/documents. It does not establish coverage or communicate autonomously with a payer. Existing insurer/TPA email/portal work stays with staff.
- Self-pay route: show the hospital's configured initial deposit rule (room tariff × expected days × factor, or a room-specific slab). Record any required insured-route deposit separately.
- Record deposit receipts through existing hospital channels. Admin may authorize an urgent admission without deposit and record the follow-up obligation.

**Saved result/exit:** a traceable admission episode, clinician-selected destination/bed, payment route and any pending paperwork/deposit tasks. Urgent exceptions remain visible rather than silently satisfying normal requirements.

## 2. Clinical tracking and attendance logging

**Actors:** doctors, nurses, pharmacy and lab/radiology staff.

- Doctor rounds record doctor, date/server timestamp, notes, ordered interventions and consultation-fee flag. Orders create linked nurse/pharmacy/lab tasks and pending billable events where applicable.
- Clinical notes are append-only. Corrections are signed addenda with a reason, retaining the original record.
- Nurse records include shift start/end, assigned patient, prescribed vitals interval, actual readings (BP, pulse, temperature, oxygen saturation, breathing rate and pain where applicable), handover notes and attendance/hours.
- Medication administration records (MAR) contain medicine, dose, route, scheduled/actual time, given/held/refused status and nurse signature. Missed/overdue work alerts the responsible staff; AI does not prescribe or change clinical instructions.
- Native pharmacy stock supports tracked receipts, issue/return movements and reconciliation; capture batch/expiry and barcode identity where applicable. Do not charge both medicine issue and administration for the same event.
- Lab work links orders, sample identity/barcode, collection/status, results/report completion and billable events. Radiology reports follow the corresponding order/completion flow. Instrument integrations and procurement/vendor accounting are not assumed.
- Transfers require a clinician order, target-bed availability/lock and nursing handover. At exact timestamp `T`, close the old room stay and begin the new one, without gaps/overlaps. Split charges at `T`; retain consumables against the unit where used.
- Staff record any externally confirmed insurance implications of a transfer. The system does not independently re-verify eligibility.

**Saved result/exit:** attributable clinical/shift records, actionable orders, reconciled operational movements and a continuous room-stay history ready for charging and discharge review.

## 3. Live cash flow and charge capturing

**Actors:** departments creating billable events, billing/cashier and authorized reviewers.

- Each ledger entry links admission, category, item, quantity, rate/version, amount, source event/department, timestamp, actor and status. Protect against repeated posting of the same event.
- Room charges use the configured hourly/daily basis and exact stay segments. Consumables/medicines link to actual issue/use; lab/radiology charges move from pending at order to finalized at completion; doctor/procedure charges follow the configured fee/package rule.
- Keep posted ledger history immutable. Correct errors with linked reversal/adjustment lines, reviewer, reason and audit trail.
- Show gross charges, returns/adjustments, net bill, insurance-eligible portion, co-pay, non-payables and patient responsibility. Co-pay is part of patient responsibility, not an additional charge counted twice.
- Track every deposit/top-up/payment with receipt/reference, mode, amount, time, cashier and evidence. Deposits are held against the admission as a liability until allocated; they are not treated as hospital income immediately.
- Refunds and deposit adjustments require authorization and occur at final billing (Gate 4). Any later correction follows the attributable post-discharge correction/exception process.
- Separate payer authorization from actual insurer receipt. Track patient deposits/payments, allocations, receipts and authorized refunds independently. Record partial receipts, patient dues and any remaining insurer dues.
- Use deterministic calculations; AI cannot set tariffs, infer financial authority or declare a bill settled.
- Source defaults propose alerts at 80% of approved insurer limit and 80% of the patient-payable deposit. Keep thresholds configurable and visibly tied to staff follow-up; they are not payer approvals.

**Saved result/exit:** a continuously updated, explainable bill and receipt/deposit ledger, with outstanding amounts and action owners visible. Finalization happens through the last discharge gate.

## 4. Four-tier discharge and clearance gateway

**Ordinary sequence:** Doctor → Pharmacy → Nursing → Billing/Admin. Each human seal records admission, gate, authorized signer/role, timestamp and the version/hash of the information reviewed. Work may be prepared beforehand; a gate cannot begin its formal clearance or issue its seal before the preceding gate is cleared. No user or AI may issue another role's seal.

| Gate | Human review and result |
|---|---|
| 1. Doctor | Clinical readiness; signed diagnosis/course/condition/follow-up summary; take-home prescription; doctor seal |
| 2. Pharmacy | Prepare take-home medicines against the prescription; reconcile ward issues, returns and billing; pharmacy seal |
| 3. Nursing | Review chart, consumables and nursing hours; resolve discrepancies; nursing seal |
| 4. Billing/Admin | Final room/department charges, bill version, payer authorization versus received money, all patient payments/refunds/dues; final admin seal |

- Changes reopen the seal(s) whose reviewed information changed and downstream approvals that rely on that change. A billing correction must not automatically force an unrelated doctor to repeat clinical approval. Record dependency/invalidation reason and preserve the history of previous seals.
- Nursing financial clearance does not automatically stop vitals, medicines or monitoring. Care continues under clinical instructions until the appropriate transition.
- Final room charges account for actual exit time and transfer history. If departure is delayed after an estimate, changes affecting the final bill require the relevant billing review and a new document version.
- For ordinary insured discharge, a recorded approval is insufficient: insurer money owed must actually be received and evidenced. Patient dues must be paid and excess deposits refunded/recorded appropriately. Self-pay follows patient settlement without an insurer-receipt condition.
- On final clearance and recorded departure, mark the episode discharged, release the bed and create the housekeeping turnover task. Keep physical departure and bill/document timestamps traceable.
- Preserve finalized bill/document versions. Corrections after discharge create attributable amendments/reversals, never silent edits to previously signed records.

**Admin-managed exceptions:** urgent admission without deposit, delayed/denied insurance, unpaid balance/credit, unavailable approver, leaving early/against medical advice, external hospital transfer, death and post-discharge corrections. Record case type, responsible admin, authority, reason, supporting evidence, actual clinical/disposition status, unpaid obligations and follow-up owner. Admin handles routing/authorized exception disposition without fabricating a clinical decision, another professional's signature or a zero balance. Required clinical documentation remains the responsibility of the relevant professional.

**Saved result/exit:** ordinary discharge has the four human clearances, financial reconciliation and recorded departure. Exceptional exits have their actual status, explicit exception authority, supporting professional records and visible remaining obligations.

## 5. Artifact generation — final discharge copy

**Actors:** clinical signers, billing/admin and staff delivering the document.

Produce a printable/exportable discharge copy containing:

- Hospital identity/logo/address and document title/version.
- Patient identity, UHID/IP, age/sex, admitting/attending doctor, admission/discharge timestamps and ward/ICU transfer history.
- Diagnosis, procedures, course of care, condition at discharge, signed prescription, follow-up and advice.
- Itemized financial statement: gross charges, returns/adjustments, net bill, payer authorization, actual insurer receipts, patient deposits/payments and allocations, refunds and outstanding obligations.
- Four clearance seals with signer, role and timestamp for an ordinary discharge. Exceptional documents must reflect actual approvals and status rather than imply four completed seals or full settlement.
- Verification reference/QR tied to an admission/document hash, page numbers and document version. Any verification view must control disclosure of patient details.

**Saved result/exit:** an attributable document consistent with the reviewed clinical and financial records. The prototype's verification link is a design preview; real document generation and verification remain to be implemented.

## Financial example used in the approved design

All patient names, dates, hospital details and values in the prototype are synthetic, not configured hospital rules.

| Item | INR |
|---|---:|
| Gross charges | 120,000 |
| Medicine returns/adjustments | -5,000 |
| Net bill | 115,000 |
| Eligible bill | 100,000 |
| Patient co-pay (10% of eligible bill) | 10,000 |
| Non-payables owed by patient | 15,000 |
| Total patient responsibility | 25,000 |
| Insurer authorization | 90,000 |
| Patient deposit received | 30,000 |
| Patient refund | -5,000 |
| Actual insurer receipt in the cleared state | 90,000 |
| Retained payments after refund | 115,000 |
| Outstanding after settlement | 0 |

The waiting screen records insurer receipt as zero, so ordinary insured discharge remains blocked. The cleared state records receipt and refund: `90,000 + 30,000 - 5,000 = 115,000`. Deposits allocated to the bill are not counted again as a second payment. Approved amounts never count as received cash.

## Reference conflicts and configuration boundaries

1. The original `SKILL.md` asks software to verify eligibility. The owner superseded this: external verification with staff-entered results only.
2. The PDF's direct payer/clearinghouse integration proposal is superseded. Its coding terminology (such as CPT) is reference material, not an owner-selected coding standard.
3. The source's broad seal-invalidation wording is superseded by the owner's affected/dependent approvals rule.
4. The source's simplified `bill - approved insurance - initial deposit` formula does not determine cash settlement. Include all receipts, co-pay/non-payables, later deposits, adjustments and refunds, and distinguish authorization from receipt.
5. The JPEG shows a zero balance for `111,300 - 80,000 - 10,000`; the correct remaining amount is `21,300`. Do not reuse that erroneous balance.
6. Example rates, room categories, numbering, triage scales, tax treatment, daily grace/rounding rules, deposit factors, alert thresholds and approval delegation are defaults or hospital configuration choices. No specific hospital/payer policy or regulatory certification has been verified.
7. Authentication, role permissions, access/audit protection and safe document storage are required capabilities. Concrete library/provider choices, deployment and detailed schema/endpoints belong to later design/planning, not this scope record. No AI/OCR/payment provider has been selected in this project.

## Source navigation and evidence

- [Supplied requirements, PDF and image](reference/README.md): original files preserved separately from the controlling scope.
- [Approved Figma reference](DESIGN_REFERENCE.md): role screens, node locators, prototype behavior and design approval.
- Owner decisions above come from this project's conversation, including the insurance/payment correction and UI approval recorded on 9 October 2026. They must not be replaced by assumptions from another project.
