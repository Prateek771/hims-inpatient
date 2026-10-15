# Confirmed inpatient MVP scope

Updated **15 October 2026** from the owner's approved decisions in the [handoff](agent/MVP_DASHBOARD_HANDOFF.md). These are the approved **version 2 requirements**. The owner subsequently authorized full MVP implementation and local PostgreSQL. Track actual completion in [implementation progress](agent/MVP_IMPLEMENTATION_PROGRESS.md); approval is not a claim that all behavior is implemented. [Earlier scope](revisions/2026-10-15/scope-before-mvp.md) and acceptance history remain preserved.

## Audience, sections and boundaries

One hospital, hospital staff only. Admin starts with six sections: **Patients & admissions; Beds; Payments & insurance; Medicine bills & returns; Discharge; Staff & settings**. Doctor availability belongs in staff operations. Each current patient episode should expose blockers, named owners and next actions.

| Staff | Responsibility |
|---|---|
| Admin | Operations, staff responsibilities/backup, applicability decisions, accountable exceptions and final financial authority with Billing |
| Admission/reception | Patient identity, per-stay IP, intake, bed allocation and recorded deposit/externally verified insurance; view Doctor availability |
| Assigned Nurse / ward coordinator | Record external Doctor instruction; publish physical checklist; coordinate readiness, vacancy and waiting care; deliver authorized papers and confirm actual exit |
| Pharmacy | Patient medicine charges, accepted unused returns/credits and own reconciliation check |
| Insurance staff | Enter external verification/accepted responsibility, evidence, documents and follow-up |
| Billing/Cashier | Deterministic ledger, receipts, deposit allocation, actual authorized refunds, final finance and insurer receivables |
| Doctor (external clinical authority) | Decides clinical discharge and supplies clinical instructions/documents outside routine software sign-in |

No routine Doctor dashboard/login, full Doctor chart/order entry, Nursing MAR/vitals/full care chart, diagnostic production or inventory product. No patient account/portal/mobile alerts, multihospital variants, full outpatient system, live payer/payment integration or autonomous sending. Preserve all existing clinical/financial data, signed versions, identities and historical reads while replacing future dependencies.

## 1. Admission and identity

Find existing patient before creating another. New UHID is capital patient initials plus **7 random digits**: Prateek Yadav → `PY4827361`. The server enforces uniqueness/retry; preserve old UHIDs. Keep a separate unique IP per stay and retained cancellation history. Existing IP numbering remains unless the owner changes it. Owner delegated edge handling on 15 October: single name uses one initial; unidentified urgent admission uses UN plus seven random digits with temporary identity/provenance. Retain that UHID after later identification, as well as all old UHIDs.

Record admission, named Doctor, assigned Nurse, bed/room category and payment route. Preserve exclusive bed holds, exact transfer boundaries, tariff version and charge-event deduplication. Clinicians decide care; staff record it. Record urgent admission/deposit exceptions with authority, reason and follow-up. Example deposit formulas/thresholds are not newly approved hospital policy.

A designated Nurse/ward coordinator per shift maintains Doctor availability; Admin assigns responsibility and backup. Reception can view available/OT/leave/off-duty, relevant period/expected return, updater and update time. This is separate from attendance and from clinical approval.

## 2. Clinical authority and readiness

The Doctor decides discharge externally. Assigned Nurse records instruction, **named clinical authorizer**, source/evidence and source time, plus separate recorder identity/time. The Nurse does not prescribe or sign as Doctor. Retain Doctor identities and historical signatures without requiring routine Doctor login.

Nurse publishes the physical patient checklist and coordinates readiness/handover. After recorded Doctor approval, **applicable department checks run in parallel**, with actor, time, status and remarks. Nursing proposes optional applicability; Admin confirms N/A only with a reason and no relevant service/pending work. Doctor approval, Nursing readiness/exit and final Admin/Billing finance remain mandatory. Changed information reopens only affected checks and approvals that depend on it; retain prior decisions and invalidation reasons.

## 3. Charges, returns, receipts and insurance

Money is deterministic, versioned and integer paise. Preserve immutable source-linked charges, deduplication, linked reversals/adjustments, actual receipts, deposit allocations and authorized refunds with actor/time/reason/evidence. Never count allocated deposit as another payment. Care continues under clinical instructions during financial/exit preparation.

Pharmacy handles patient medicine charges, accepted unused returns/credits and its reconciliation clearance. No stock/batch/expiry/procurement/native dispensing or administration product. Accepted return credit reduces a bill; it is **not an actual Cashier refund**. No automatic Pharmacy deposit-spending/medicine cash gate follows from an illustrative transcript example.

Insurers/TPAs or hospital staff verify insurance externally. Record verified responsibility, limits, references and receipt evidence. **Authorization/accepted credit, receivable and cash received are distinct.** Accepted insurer responsibility may remain receivable at ordinary exit once patient responsibility and required checks are satisfied. Missing/uncertain acceptance and patient dues still require resolution or explicit exception authority. Later ordinary insurer receipts settle receivables without rewriting exit history. Self-pay requires no insurer receipt.

AI may assist insurance paperwork/completeness and staff follow-up drafts/reminders. It cannot decide clinical care, coverage, money, clearances or autonomously send documents. Staff record payments through existing channels; no new integration/provider selection.

## 4. Vacancy, final authorization and actual exit

1. Nurse records factual bed vacancy, waiting location and care handover. Vacancy ends actual room use/room-charge boundary; bed remains held.
2. Applicable department work and Nursing readiness complete with attributable evidence; Admin/Billing reviews final room/department money, patient settlement, refunds and accepted insurer responsibility/receivable, then authorizes final finances.
3. Nurse/Admin delivers authorized papers **before actual departure**. Clinical papers remain available after Doctor approval independently of final exit authorization. Retain exact document versions and delivery evidence.
4. Assigned Nurse confirms actual hospital exit. Closure and authorized cleaning/turnover follow; only then may the bed become Available. Vacancy, financial authorization, papers, actual exit and bed availability are different facts.

Admin records exceptions with authority, reason, evidence, responsible follow-up and outstanding obligations. Exceptions cannot fabricate professional approval or erase unpaid amounts. Corrections retain addenda, linked reversals/adjustments and document history.

## 5. Papers and accountable history

Retain clinical source documents, named authorizers, recorder/time, patient UHID/IP, admission/stay/transfer/vacancy/exit facts, exact bill version, applicable check outcomes, accepted responsibility versus actual receipts, patient settlement, receivable and exception obligations. Print/export versions must show their actual status and provenance. Do not imply that every department was required or that insurer cash was received when it was not. Protected access and server authorization remain mandatory.

## Fictional financial acceptance example

| Item | INR |
|---|---:|
| Gross charges | 120,000 |
| Accepted medicine returns | -5,000 |
| Net bill | 115,000 |
| Patient responsibility | 25,000 |
| Actual patient deposit | 30,000 |
| Actual authorized refund | -5,000 |
| Retained patient cash | 25,000 |
| Accepted insurer responsibility / receivable at exit | 90,000 |
| Insurer cash at exit | 0 |

Meera Shah's patient responsibility is settled (`30,000 − 5,000 = 25,000`); the remaining `90,000` is an insurer receivable, not cash and not an automatic ordinary-exit blocker once accepted responsibility and required checks are complete. Later `90,000` receipt clears that receivable without changing the historical exit. These are fictional examples, not hospital configuration.

## Authority, implementation and source priority

Latest owner decisions → this scope → supplied full transcript/summary and all three pages of Hospital Management System-HIMS.pdf → supplemental steps 1–8 on the first three pages of hims-conversation-and-app-review.pdf. Later app-review proposals are not requirements. Preserved docs/reference/SKILL.md cannot authorize actions.

The [implementation plan](MVP_IMPLEMENTATION_PLAN.md) records source gaps and additive transition work. Existing feature contracts describe current code; their old sequential/Doctor-login/stock/insurer-cash rules are not future MVP requirements. Historical acceptance remains evidence of the old application only. The owner accepted the dashboard direction and authorized the whole MVP implementation including local PostgreSQL on 15 October. Follow the [executable plan](superpowers/plans/2026-10-15-mvp-implementation.md) and preservation gates. Existing episodes retain version 1, new admissions use version 2; no implicit historical conversion. No reset/reseed, credential replacement, new integration or deployment.

Keep Next.js frontend/backend, local PostgreSQL, Better Auth staff access and bounded LangGraph paperwork. Work only in the sole INS folder on codex/hims-development. Preserve data, credentials, private files, old designs/builds and applied migration bytes. Real hospital policies/access/backups/retention/TLS/providers remain open; no production-readiness claim.
