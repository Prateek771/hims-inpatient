# Dashboard sections and patient-cycle review — 19 October 2026

Start with the [focused Sameer patient guide (18-page PDF)](../../output/pdf/sameer-admission-to-discharge-visual-guide.pdf): one hospital, all six roles, full portal screenshots and arrows to exact buttons. The [larger staff reference](../../output/pdf/hims-patient-process-dashboard-guide.pdf) remains available for every dashboard section; it includes the earlier completed Rohan journey.

Owner requested localhost, section-by-section verification in Admission → Admin → Nurse → Billing → Pharmacy → Insurance order, clear intake-to-exit movement, and realistic fictional hospital/staff/patient records afterward. ProWork subagents use GPT-6.1 Sol; main chat integrates and verifies. Existing accounts, data and applied migration bytes must remain. Database migrations and Vercel remain on hold.

## Acceptance and ownership

- Shared identity/UHID/IP and necessary handoff status may appear across roles. Each section must have its own relevant work queue, summary and correct task destination; no title-only copies.
- Keep existing authority boundaries, deterministic money, named external clinical instruction, parallel checks, physical vacancy, exact paper delivery, actual exit and bed turnover distinct.
- Fix in-scope source-backed handoff defects, including the two previously paused bugs, under this newer request to verify the complete patient cycle. No schema change, new provider, inventory or patient portal.
- Three Sol workers audit paired roles, then own separate workspace, episode/document and Insurance slices. Controller owns medicine-source projection, integration, browser checks, preservation and fictional data. Independent review follows integration.
- Run unit/SSR, lint/types/build, live role-section checks and an additive fictional browser journey. Do not run the migration/fixture-reset wrappers while the migration hold remains. Record tested scope explicitly.

## Completed outcome

The local application is running at [localhost:3000](http://localhost:3000/login). The tested ordinary patient cycle works. This is not a production-readiness sign-off or proof that every exceptional path has been exercised.

Completed purpose-specific queues and summaries; safe case/financial/discharge links; Admission saved-insurance confirmation and patient preselection; Nurse end-shift handover; correct MVP final-document route; retained paper status after later receipts; original medicine item/price/return balance presentation. Existing workflow commands and server role boundaries remain authoritative. Shared patient identity and necessary handoff status intentionally repeat; whole generic work panels no longer repeat across these sections. Empty Exceptions sections are legitimate when no recorded exception belongs to that desk.

## 1. Admission

| Section | Purpose and action |
|---|---|
| Admissions → Current admission work | Pending reservations, active stays and retained intake. Open a patient to record deposits and actual arrival. Registration alone does not start room occupancy. |
| Admissions → Patient identity & intake | Search before creating a patient; enter identity, payment route, configured Doctor and bed. Existing identities/UHIDs remain intact. |
| Doctor availability | View the maintained external Doctor directory. Availability is separate from clinical discharge approval. |
| Insurance | Create the admission-linked handoff or see the saved case and assigned owner. The saved-case confirmation now works without exposing the specialist's full case workspace. |
| Exceptions | Relevant intake/identity exceptions and recorded follow-up. Ordinary clinical/financial work belongs to its owning desk. |
| Retained records | Authorized historical records and their intake/history links. |

**Try:** Demo Ananya Rao, IP-2026-00009. Her General bed is reserved; she needs the configured ₹3,000 deposit and actual arrival. Do not create another copy of the patient.

## 2. Admin

| Section | Purpose and action |
|---|---|
| Patients & admissions | Hospital-wide coordination: next responsible desk, blockers and responsible Nurse assignment. Broad oversight belongs here. |
| Beds | Physical bed states and category grouping: Ready, occupied, reserved/held and cleaning. Record authorized cleaning/turnover after exit before reuse. Vacancy alone does not release a bed. |
| Payments & insurance | Financial review and authorized settlement work. Opens the money task rather than generic readiness. |
| Medicine bills & returns | Patient medicine sources and reconciliation oversight. Original quantities/prices and accepted return credits remain traceable. This is not a stock inventory module. |
| Discharge | Patients actually preparing for discharge, applicable checks, authorized N/A decisions, final finance, papers and turnover. |
| Staff & settings | Staff accounts, hospital configuration and operational responsibilities. Existing credentials and policy/tariff versions were retained. |
| Retained records | Authorized earlier episodes and their retained history. |

**Try:** Beds shows 16 configured beds, including four new training beds; five are Ready in the final snapshot. New named Nurse/Insurance staff are intentionally unassigned until Admin assigns responsibility.

## 3. Nurse

| Section | Purpose and action |
|---|---|
| My patients | Assigned patients only: start care shift, record named external Doctor instructions, maintain the patient checklist and record movement. Start discharge and shift-patient shortcuts retain drafts. |
| Discharge | Assigned patients preparing to leave: Nursing readiness, named external diagnostic confirmation, physical vacancy/waiting care, authorized paper delivery and actual exit. |
| Doctor availability | The designated Nurse maintains factual availability, separately from attendance and external Doctor approval. |
| Exceptions | Relevant recorded exceptions and remaining obligations; no copy of unrelated Admin/financial exception work. |
| Retained records | Authorized historical episodes. The patient's readiness workspace now provides signed end-of-shift handover with existing actor/time and server time constraints. |

**Try:** Demo Kabir Sethi for ongoing care, or Demo Arjun Iyer for discharge preparation with Pharmacy reconciliation still pending. Nurse cannot impersonate Pharmacy, Insurance or final financial approval.

## 4. Billing

| Section | Purpose and action |
|---|---|
| Billing | Itemized charges, patient money received, deposit allocation, actual refunds and final financial review. Keep patient liability, accepted insurer responsibility, receivable and actual cash separate. |
| Insurance | Admissions with insurance cases, exact case links and accepted responsibility/receipt context; unrelated self-pay cases are excluded. |
| Discharge | Financial handoff and blockers for patients preparing to leave, rather than everyday billing for every patient. |
| Documents | Retained authorized documents. An MVP episode opens its own papers/exit workspace instead of the older workflow's approval screen. |
| Exceptions | Recorded financial/authorized exceptional obligations. Corrections and reversals retain source history. |
| Retained records | Later insurer receipts and historical review remain linked to the original admission. Later cash does not rewrite completed exit or its final PDF. |

**Try:** Demo Pooja Nair has a frozen ₹1,400 bill, ₹3,000 received and ₹1,400 allocated. Record the remaining **₹1,600 actual refund**, then review final finance. Do not enter the original deposit again.

## 5. Pharmacy

| Section | Purpose and action |
|---|---|
| Medicine bills & returns | All admitted medicine patients, including those not preparing for discharge. See item name, original quantity/price, linked returns and remaining returnable quantity. Accepted returns reduce the bill; Billing handles actual cash refunds. |
| Discharge | Pharmacy reconciliation for patients in discharge preparation. Shows its own readiness and factual departure status; restricted paper data is not misreported as missing. |
| Exceptions | Relevant recorded Pharmacy obligations, rather than unrelated clinical/financial exceptions. |
| Retained records | Authorized medicine history. Final discharge PDF access remains denied to Pharmacy. |

**Try:** Demo Arjun Iyer needs Pharmacy reconciliation. Demo Kabir Sethi demonstrates five packs charged and one accepted return: four packs / ₹400 remain posted.

## 6. Insurance

| Section | Purpose and action |
|---|---|
| Cases | Assigned cases only. All current cases includes routine policy verification and follow-up; the narrower Readiness checks filter concerns discharge checks only. |
| Individual case | Externally verified policy, evidence, external payer decisions, accepted responsibility and staff follow-up. Exact case links retain patient context; the authorized handoff opens Insurance discharge readiness. |
| Exceptions | Recorded insurance obligations, including authorized unapplied post-exit corrections. Closed-admission correction work remains accessible without reopening unrelated approvals. |
| Retained records | Authorized retained cases and history. Accepted insurer credit remains distinct from actual cash/receivable. |

**Try:** Demo Tara Mehta has an assigned case awaiting policy verification and external payer decision. The app does not contact or approve an insurer automatically. There is no routine Doctor dashboard: Doctors decide externally and the assigned Nurse records that authority.

## Verified patient movement: Demo Rohan Desai

**IP-2026-00008 · UHID DRD8354056 · Demo G-104 · insured.** Completed through the real localhost browser using the six existing role accounts:

1. Admission registered Rohan, recorded ₹2,000 deposit/actual arrival and created the Insurance handoff. Admin assigned the Nurse; Nurse opened the care shift.
2. Pharmacy recorded six ₹100 medicine packs and one accepted return. Consultation ₹800, blood count ₹400 and actual room use ₹1,200 produced a **₹2,900 net bill**.
3. Nurse recorded named external Doctor approval, prepared clinical paperwork, published the checklist and completed Nursing/externally confirmed Diagnostics work. Pharmacy completed its own check.
4. Nurse recorded physical vacancy and waiting care; the bed stayed held. Insurance recorded verified policy/decision evidence, ₹2,000 accepted responsibility and its readiness check.
5. Billing allocated ₹900 of the deposit and recorded the **₹1,100 actual excess refund**. Final finance was authorized with the accepted insurer ₹2,000 still receivable.
6. Authorized final paperwork was generated/delivered with acknowledgment. Nurse recorded actual exit; Admin recorded cleaning/turnover and G-104 became Ready. Nurse subsequently signed end-of-shift handover at the actual exit time.
7. Billing later recorded ₹2,000 insurer cash. The receivable settled; original exit, delivered-paper status and exact final PDF bytes remained unchanged.

This proves one complete ordinary insured cycle, not every cancellation, transfer or exceptional-exit variant. Staged self-pay cases provide additional starting points without consuming all unfinished training work.

## Fictional operating dataset

User explicitly selected realistic fictional records. Lotus Grove Demo Hospital now has **16 beds, 13 patient/admission episodes, 14 staff accounts, three external Doctors and six priced catalogue items**. Added six named staff, four beds and six episodes: completed Rohan plus five open staged patients. Existing tariff/category/catalogue settings were reused. See [training cases and next actions](../FICTIONAL_HOSPITAL_TESTING.md).

Existing role-name logins/passwords still work. New named credentials remain only in the owner's ignored `tmp/section-review-2026-10-19/new-staff-logins.txt`; do not publish it. A separate clone generates fresh credentials using [the clone demo guide](../CLONE_DEMO.md). Existing Nurse/Insurance role accounts own the prepared cases for easy testing. New named Nurse/Insurance accounts are unassigned and were verified unable to open Rohan's patient/case. Account creation does not confer an assignment.

A readable pre-addition PostgreSQL backup and protected-file copies were retained. No restore/reset/reseed was performed. Original **560 non-counter rows across 96 tables and all 134 original protected files** compare unchanged. Final snapshot has 836 non-counter rows / 138 protected files; six admission-counter increments match the six new episodes.

## Verification and local evidence

| Check | Observed result |
|---|---|
| `npm --prefix web run test:unit` | 163 tests passed, including role-specific navigation, Admission handoff, redacted closure summaries, original medicine prices/returns and retained-paper status. |
| `npm --prefix web run lint`, `typecheck`, `build` | Passed on the integrated source. |
| Ordinary PostgreSQL role projections | Read-only checks passed for all six roles. |
| Final populated desktop browser crawl | 36 section/action-link visits, all HTTP 200, zero page errors. This verifies navigation/rendering, not every form mutation on those pages. |
| Mobile browser | All six role homes at 390 × 844 returned 200 with no page-level horizontal overflow/page errors; screenshots visually reviewed. Wide tables retain local scrolling. No physical-phone test claimed. |
| Rohan browser journey | 28 workflow steps / 41 screenshots, then signed shift-end verification. Final PDF retained the same SHA-256 after insurer receipt. |
| Role restrictions | New unassigned Nurse/Insurance could sign in but could not access another staff member's patient/case; Pharmacy final PDF returned 403. |
| Preservation | Original records/files unchanged; expected additive training/session/audit/document history and six admission-counter increments only. |

Ignored local evidence: [desktop routes](../../tmp/section-review-2026-10-19/final/sections.json), [mobile/access/document checks](../../tmp/section-review-2026-10-19/final-verification.json), [patient journey](../../tmp/section-review-2026-10-19/journey/journey.json), [desktop screenshots overview](../../tmp/section-review-2026-10-19/final/desktop-overview.png), [mobile screenshots overview](../../tmp/section-review-2026-10-19/final/mobile-overview.png).

Preview: `tmp/local-preview-task21-618fdbe`, BUILD_ID `-gnbRBLWKF0VZ-pNwtbvr`, source fingerprint `618fdbe3bb1628491c2d5967f91bf5b60459fd1561e91cc8d23c37ea224e9e6a`. Source remains uncommitted on development checkpoint `0b99b43`.

## Still on hold or requiring attention

- **No migration or Vercel deployment.** Revised admission reason/optional-Doctor behavior and structured ward → room → bed storage still require the separate migration phase. Current UI uses existing labels/categories.
- Full `npm --prefix web run check` integration/e2e/recovery wrappers were not run this turn because their setup performs migrations/fixture resets. Above checks are current evidence; older full-suite results are historical.
- Retained MVP queues show the latest 50 closed episodes. Complete paginated historical discovery remains a future improvement.
- Doctor availability duty ends **22 October 2026, 4:38 pm IST**; Admin must renew it for continued testing. Occupied stays continue accumulating room units, so use live bills. Pooja's and completed Rohan's totals are frozen by recorded vacancy.
- Actual hospital policies, access/assignment review, production hosting/security/backups and provider choices remain separate pilot requirements. No real patient records, live insurer/payment integration or autonomous AI approvals were introduced.
