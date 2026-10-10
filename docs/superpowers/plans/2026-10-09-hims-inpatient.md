# HIMS Inpatient Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one hospital's staff-facing inpatient journey, from admission through care, charges, externally verified insurance records, human discharge clearances and final documents, following the approved Figma design.

**Architecture:** One Next.js application in `web/`, one local PostgreSQL database and feature-owned server modules. Server Components read authorized data; Server Actions call the same transactional domain commands used by the few required Route Handlers. A small Node worker posts due room charges; LangGraph JS uses PostgreSQL checkpoints only for insurance-paperwork assistance.

**Tech Stack:** Owner-selected Next.js, PostgreSQL, LangGraph and Better Auth (staff login confirmed 9 October 2026). Foundation uses TypeScript, Tailwind from the official Next.js scaffold, Drizzle/node-postgres, Zod, Vitest and Playwright. Add barcode/QR libraries only when their tasks need them. AI/OCR providers remain unselected.

**Spec:** [Confirmed scope](../../PROJECT_SCOPE.md), [approved design reference](../../DESIGN_REFERENCE.md) and [agent rules](../../../AGENTS.md). Recorded 9 October 2026 against setup baseline `8c674f7633883d690d717015ec58b64e03c5d701`. Tasks 1–16 are implemented and independently reviewed; Task 16's exact-commit complete development CI is its final checkpoint gate. Task 14 uses manual/synthetic text with live model/OCR providers unconfigured. On 10 October 2026 the owner authorized a single GPT-6.1 Sol / Extra High successor in this same folder to finish Task 16, save verification and limitations, then pause before further work. See [setup status](../../SETUP_STATUS.md) for actual evidence, installed packages and limitations.

## Global constraints

- One hospital, staff-facing inpatient system; no multi-hospital infrastructure, patient portal or full outpatient module.
- Next.js frontend/backend, local PostgreSQL for now, LangGraph human-in-the-loop workflows.
- Insurance verification remains external. Staff enter verified insurer/TPA decisions and evidence. No direct insurer tie-up, payer API or autonomous document transmission.
- AI helps insurance paperwork, missing-document checks and staff follow-up drafts/reminders only. No clinical, coverage, payment or clearance authority.
- Payment-service integration is deferred. Record existing cash/card/UPI/bank payments manually.
- Ordinary insured discharge requires actual insurer money owed, patient settlement and the four current human clearances. Self-pay has no insurer-receipt requirement.
- Doctor -> Pharmacy -> Nursing -> Billing/Admin. Changes reopen affected checks and approvals depending on changed inputs, preserving unaffected approvals.
- Admin owns exceptions; professional signatures, real departure status and outstanding obligations remain truthful.
- Clinical addenda, ledger reversals, actor/time/reason audit and document versions preserve history.
- Use synthetic data until the relevant real-use decisions and safeguards below are complete. Preserve original reference bytes, owner instructions and existing work.

## Review focus

1. Concurrent admission/transfer requests and request retries must not double-book beds, reuse IP codes or double-post charges: Tasks 4, 5 and 7.
2. Insurer authorization, partial receipts, deposits, allocations and refunds must not manufacture a zero balance: Tasks 5, 10 and 11.
3. Changed charts/charges, stale review screens and delayed physical departure must preserve unrelated seals and prevent stale finalization: Tasks 11 and 13.
4. A wrong role, disabled account, edited actor ID or guessed admission/document ID must not read or change unauthorized records: Tasks 3, 10, 13 and 14.
5. AI interruptions, retries, document changes and hostile document text must not bypass a human or duplicate approved follow-up tasks: Task 14.

## Delivery order and agent ownership

| Stage | Tasks | Reviewable result |
|---|---|---|
| Foundation | 1-3 | Running application, database migrations, staff access and approved visual shell |
| Admission and charges | 4-5 | Real admission/bed record, deposits and explainable running bill |
| Department work | 6-9 | Clinical/shift work, transfers, pharmacy stock and lab/barcode flow |
| Settlement and discharge | 10-13 | Manual insurance records, human gates, admin exceptions and versioned final documents |
| Paperwork assistance | 14 | Durable, bounded LangGraph workflow with human review |
| Whole hospital review | 15-16 | Accurate overview/alerts, integrated checks and local pilot readiness evidence |

Work only in `C:\Users\prate\OneDrive\Desktop\INS`, per the owner's 9 October 2026 decision. Do not create separate worktrees or external project-output folders. Finish and review one slice before starting a dependent slice; commit each accepted task. Branches may be used within this checkout. One integrator owns the schema export, migrations, package lock and shared contracts; do not have several agents edit them simultaneously. A graph/index is a navigation aid, never permission or proof. No task requires Graphify.

## Proposed file and interface map

| Location | Responsibility |
|---|---|
| `web/src/app/` | Next.js pages, thin actions and the few upload/document/AI handlers |
| `web/src/components/` | Figma-derived shell and genuinely reused UI elements |
| `web/src/server/db.ts`, `schema/index.ts` | Single pooled connection, feature schema exports; migrations under `web/drizzle/` |
| `web/src/server/contracts.ts`, `auth.ts`, `access.ts`, `audit.ts` | Shared command types, identity, server permission checks, attributable audit |
| `web/src/server/{admissions,billing,clinical,nursing,pharmacy,lab,insurance,discharge,documents}/` | Feature-owned schema and commands; export their input types from the same module |
| `web/tests/{unit,integration,e2e}/` | Domain arithmetic/state checks, actual PostgreSQL checks and real browser journeys |
| `docs/agent/project-context.md` | Verified commands, current completed task, decisions and useful entrypoints |

Keep modules together by feature. Do not create a generic repository layer, plugin framework, microservices, vector database, payment adapter or separate Python backend.

Define in Task 2 and reuse: `Money = bigint` (integer paise); `StaffRole = ADMIN | ADMISSION | DOCTOR | NURSE | PHARMACY | LAB | INSURANCE | BILLING`; `Gate = DOCTOR | PHARMACY | NURSING | BILLING`; `CommandContext = { actor: AuditActor; source: string; requestId: string }`, where `AuditActor` distinguishes authenticated staff from the internal room-charge job. Context is built server-side from the authenticated session; commands recheck active staff/permission before writes. Client bodies never supply actor/role. IDs are strings; timestamps are ISO instants at boundaries; money crosses JSON as decimal paise strings. Domain commands return typed values or a typed error with `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `CONFLICT` or `PRECONDITION` codes; adapters translate safely without patient data in logs.

Store times as `timestamptz`; display/configure the hospital timezone (initial synthetic default `Asia/Kolkata`). Store money as `bigint` paise and co-pay as basis points, never binary floating-point money. Database constraints protect unique IP/source-event/receipt identities and active bed occupancy. Short transactions lock admissions and beds in a consistent order; do not hold locks across AI/network calls. Runtime DB credentials are distinct from migration credentials; the runtime is not a PostgreSQL superuser.

## Verification commands to establish in Task 1

Tasks 1-3 provide application, database, staff access and unit/integration/browser commands. At the accepted staff-access checkpoint, checks cover 20 unit tests, four actual PostgreSQL integration checks and six browser/HTTP cases, plus lint/typecheck/build. Task 5 adds the room worker when its real entrypoint exists. Record subsequent verified commands and results in context.

| Command from repository root | Script/result |
|---|---|
| `npm --prefix web run dev` | Start the Next.js development application |
| `npm --prefix web run lint` | ESLint, exit 0 |
| `npm --prefix web run typecheck` | `tsc --noEmit`, exit 0 |
| `npm --prefix web run test:unit` | Vitest Node project `unit`, all assertions pass |
| `npm --prefix web run test:integration` | Vitest project `integration`, real isolated PostgreSQL, all assertions pass |
| `npm --prefix web run test:e2e` | Playwright against the test app/database, all selected journeys pass |
| `npm --prefix web run build` | Next.js production build, exit 0 |
| `npm --prefix web run db:generate` / `db:migrate` | Generate reviewed SQL / apply tracked migrations to an explicitly configured database |
| `npm --prefix web run worker:rooms` | Task 5's room-charge worker; safe retry/restart |

Tests use a separate synthetic PostgreSQL database. The fixture/reset helper refuses any database not explicitly identified as a test database and never uses the ordinary `DATABASE_URL` as an implicit fallback. No resets/reseeds of existing hospital data. Failure or unavailable PostgreSQL is a failed/blocked integration check, not a silently skipped pass. Every task runs its targeted checks plus lint/typecheck; run build at foundation and integration milestones, and broaden tests after shared-contract changes or failures.

## Task 1: Runnable Next.js shell and verification harness

**Files:** create `web/package.json`, `web/package-lock.json`, `web/next.config.ts`, `web/tsconfig.json`, `web/eslint.config.mjs`, `web/src/app/{layout.tsx,page.tsx,globals.css}`, `web/src/components/app-shell.tsx`, `web/vitest.config.ts`, `web/playwright.config.ts`, `web/tests/e2e/shell.spec.ts`, `web/.env.example`; update README/context and applicable ignore rules. Preserve the root AGENTS.md; review generated `web/AGENTS.md` for the framework's bundled-doc instructions without replacing project rules.

**Interfaces:** consumes the approved Figma foundations; produces the app shell, planned scripts above and HTTP `/api/health` reporting liveness without secrets (DB readiness is added in Task 2).

- [x] Scaffold with the official CLI into `web/`, avoiding a nested Git repository. Next.js/create-next-app `16.4.0` was reverified with installed Node `24.11.1` and locked. Used the suggested TypeScript/ESLint/Tailwind/App Router/src-dir CLI flags, disabled nested Git/compiler/cache-components/agent-feedback and retained framework agent guidance.
- [x] Inspect Figma frame `4:3` through the required design-to-code skill before UI code. Implement the shared shell with local IBM Plex Sans, teal `#087F82`, navy `#122C3A`, light canvas, readable sections, honest setup status and keyboard focus. The actual overview/role data remains in later tasks.
- [x] Configure the Vitest Node unit project and Playwright; write `shell.spec.ts` for real landmarks, keyboard focus, prototype link, browser errors, narrow-screen overflow and minimal health JSON. Observe the starter fail for missing shell/HTTP 404, then pass all three cases after implementation. The final suite uses the built production app.
- [x] Create dev/start/lint/typecheck/unit/browser/build scripts; keep `.env.example` trackable and browser/npm cache/report output ignored inside this project. Database/integration/worker scripts remain in their owning tasks.
- [x] Run lint, typecheck, production build and shell E2E; visually inspect desktop/narrow shell screenshots against approved foundations and record evidence in setup status. Commit the foundation checkpoint with the repository workflow updates.

**Owner-authorized setup adjustment:** Install and lock the selected PostgreSQL/Drizzle, LangGraph/PostgreSQL saver and Zod foundation packages now, before the later feature tasks consume them. This is package setup only; no schema, authentication, provider or AI workflow is activated. The explicit single-folder/development-to-main branch workflow supersedes any isolated-worktree instructions from earlier planning. Full audit's upstream dev-tool findings are retained in setup status; production audit reports zero findings.

## Task 2: PostgreSQL foundation, audit and safe test fixtures

**Files:** create `web/src/server/{db.ts,contracts.ts,audit.ts}`, `web/src/server/schema/{index.ts,core.ts}`, `web/drizzle.config.ts`, `web/scripts/{migrate.ts,test-database.ts}`, `web/tests/integration/database.test.ts`; add separate `web/src/app/api/health/ready/route.ts` readiness checks and generated reviewed migrations.

**Interfaces:** produces pooled `db`, exported schema, `appendAudit(tx, ctx, { event, entityType, entityId, reason, beforeVersion, afterVersion })`, and `withTestDatabase` fixtures for subsequent tests. Settings contain hospital identity/timezone and versioned tariffs/rules; do not create all future tables now.

- [x] Inspect existing PostgreSQL availability without changing services, reading credential values into output or resetting data. Configure a new project database/runtime role and separate synthetic test DB through an explicitly supplied local setup; preserve anything already present.
- [x] Write `database.test.ts`: migrations build an empty dedicated test DB; foreign-key failures roll back; runtime cannot update/delete audit rows; test reset refuses the ordinary app DB. Verify the tests fail until the foundation exists.
- [x] Implement the pool with bounded connections, separate migration privileges, transaction helpers and append-only audit; add source/actor/time/version references and indexes on the actual lookup/FK paths. Distinguish human actors from the internal room-charge system actor; an automated job cannot claim a staff signature or invoke human-clearance commands.
- [x] Generate and inspect SQL, apply it only to the intended new/test DB, rerun integration tests plus lint/typecheck and commit `feat: add PostgreSQL foundation and audit`.

**Verified adjustment:** Browser tests explicitly use the guarded synthetic database. Both URL diagnostics and CLI setup errors avoid disclosing credentials. Vitest temporary output stays in `INS/tmp/vitest`. Independent review accepted both corrections. No staff authorization or hospital financial policy is implied by this foundation.

## Task 3: Staff login, server permissions and hospital settings

**Files:** create `web/src/server/{auth.ts,access.ts}`, `web/src/server/schema/auth.ts`, `web/src/app/api/auth/[...all]/route.ts`, `web/src/app/login/page.tsx`, `web/src/app/(staff)/layout.tsx`, `web/src/app/(staff)/admin/{staff,settings}/page.tsx`, `web/tests/integration/access.test.ts`, `web/tests/e2e/staff-access.spec.ts`; update schema export/migrations.

**Interfaces:** produces `requireStaff(): Promise<{ id: string; role: StaffRole }>`, `requireAdmissionAccess(ctx, admissionId, action)`, and admin-only staff/settings commands used by later features. Better Auth owns passwords/session handling; domain checks own professional/financial authority.

- [x] Write negative tests for public signup, forged role/actor fields, disabled staff, unauthorized patient lookup and direct wrong-role mutations. Verify failure before implementing guards. Define a small explicit role/action/field matrix, including assigned-care access and department worklists; do not return all clinical fields to every staff role.
- [x] Use Better Auth's Next.js/Drizzle integration and admin-managed accounts; disable public signup. Configure only staff-account management permissions needed here, excluding impersonation/deletion powers. Recheck active role/access on the server; administrative status does not confer doctor/pharmacy/nursing signing authority.
- [x] Implement admin staff/bed-category/tariff/deposit/alert-rule screens. Version changes instead of repricing existing stays. Use password/session library controls, login throttling, safe errors and session revocation; no plaintext passwords in seeds/logs. Synthetic test credentials stay confined to test fixtures.
- [x] Run access integration tests, `staff-access.spec.ts`, lint/typecheck/build; verify direct requests fail even when UI controls are hidden; commit `feat: add hospital staff access and settings`.

## Task 4: Patient identity, admission and occupied beds

**Files:** create `web/src/server/admissions/{schema.ts,commands.ts}`, `web/src/app/(staff)/admissions/{page.tsx,actions.ts}`, `web/src/app/(staff)/patients/[admissionId]/page.tsx`, `web/tests/integration/admission.test.ts`, `web/tests/e2e/admission.spec.ts`; add migrations. Figma `4:4`.

**Interfaces:** consumes server context/access, settings and audit. Produces `createAdmission(ctx, { patientId?, patientDetails?, admittingDoctorId, clinicianAssessment, bedId, paymentRoute, expectedStayDays, requestId }): Promise<{ admissionId, patientId, ipCode }>` and `cancelAdmission(ctx, { admissionId, reason })`. `paymentRoute` is `SELF_PAY | INSURED`; verified insurance data belongs to Task 10.

- [x] Write assertions: 20 simultaneous admissions yield 20 unique IP codes; cancelling never reuses a code; two requests for one bed yield one success; failure leaves no partial occupancy; a repeat admission keeps UHID but gets a new IP. Retry the same request and assert one episode.
- [x] Implement a transactional yearly counter/unique code, permanent patient identity, clinician-entered complaint/vitals/triage, destination override reason and bed reservation. Keep registration time and actual admission/occupancy time distinct; the room-stay segment begins when the admission is activated, with its tariff version. Handle sequence overflow without truncation or reuse.
- [x] Add minimal administrator bed-inventory controls using configured room categories, so beds can be created and safely disabled through the application. Do not require SQL seeds or silently remove an occupied/reserved bed. Task 3 defines categories; this task owns physical beds and their availability.
- [x] Build the admission form/worklist with validated inputs and explicit `PENDING` versus `ADMITTED` state. Saving/reserving a pending episode does not satisfy a required deposit or start room charging. Task 5 activates it after deposit checks; urgent no-deposit admission uses the admin exception command introduced in Task 12. Do not invent a bypass meanwhile.
- [x] Run the admission integration/E2E files, lint/typecheck; inspect Figma alignment; commit `feat: add patient admission and bed allocation`.

## Task 5: Deterministic ledger, deposits, receipts and room charges

**Files:** create `web/src/server/billing/{schema.ts,money.ts,commands.ts,room-charges.ts,room-worker.ts}`, `web/src/app/(staff)/billing/{page.tsx,actions.ts}`, `web/tests/unit/money.test.ts`, `web/tests/integration/billing.test.ts`; modify `web/src/server/admissions/commands.ts` for activation; add migrations. Figma `4:9`.

**Interfaces:** produces the internal `postCharge(ctx, { admissionId, sourceEventId, category, itemId, quantity, unit, tariffVersionId, status })`, `reverseCharge(ctx, { chargeId, amountPaise, reason })`, `recordReceipt(ctx, { admissionId, party, kind, amountPaise, mode, reference, evidenceId?, requestId })`, `getBill(admissionId, cutoff)` and idempotent `postDueRoomCharges(cutoff)`. Server code resolves authorized rates and computes amounts; ordinary form bodies never set charge totals. `quantity` is a validated decimal string with explicit unit/scale; calculate fractions/rounding exactly. `party` is `PATIENT | INSURER`; `kind` distinguishes deposit/top-up/payment/refund; refund links its original receipt. Task 10 adds verified payer responsibility.

- [x] Write tests for exact paise arithmetic, same event/receipt retried once, pending-to-final charge without an extra line, excessive reversal rejection, allocation not creating a second payment, unauthorized/premature refunds and partial receipts. Assert net `12000000n - 500000n = 11500000n` paise. Tampered client totals/rates and invalid fractional quantities must fail rather than override server tariffs.
- [x] Implement `activateAdmission(ctx, { admissionId, arrivedAt, expectedVersion, exceptionId?, requestId })` using the configured deposit requirement and recorded receipts. Ordinary activation without a required deposit fails and leaves the episode pending/bed reserved; a sufficient deposit activates it and starts the stay once. Task 12 adds a validated admin exception path and its no-deposit test; an arbitrary exception ID is not a bypass.
- [x] Implement immutable posted charges/receipts with linked reversals, deterministic totals and versioning; deposits stay liabilities until allocated. Refund/deposit-adjustment commands require billing authority/reason during Gate 4 audit after the first three current clearances, before the final seal; Task 11 supplies that precondition. Show receipt evidence as manually entered, never bank-verified by HIMS.
- [x] Extend the existing versioned administrator settings with non-room billable items and prices (doctor/procedure, medicine/consumable, lab/radiology), explicit units and permitted quantity scale. Keep stable item identity separate from price version; internal posting resolves/pins the configured rate and validates the source department. Later department tasks link their actual orders/movements to these items. No client-entered rate override, guessed unit conversion or SQL-only price setup. Package pricing must prevent duplicate constituent charges before it can be offered; ordinary item fees remain the initial supported configuration.
- [x] Implement configurable hourly/24-hour-block tariff arithmetic including grace/rounding inputs; test exact full-day boundaries and transfer cutoffs. No guessed tax or grace policy for real bills. Rates are snapshotted/versioned for the stay.
- [x] Add a small recoverable room worker using persisted per-stay cursors, source-event uniqueness and a PostgreSQL advisory lock. On restart it catches up missed intervals; concurrent workers do not double-post. Final bill calculation catches up through the exact cutoff even if the worker was unavailable.
- [x] Run money/billing/worker restart tests, lint/typecheck; show charges, manual receipts, top-ups, allocations/refunds and outstanding amounts; commit `feat: add live ledger and manual receipts`.

## Task 6: Clinical orders, nursing shifts and medication records

**Files:** create `web/src/server/clinical/{schema.ts,commands.ts}`, `web/src/server/nursing/{schema.ts,commands.ts}`, `web/src/app/(staff)/clinical/{page.tsx,actions.ts}`, `web/src/app/(staff)/nursing/{page.tsx,actions.ts}`, `web/tests/integration/care.test.ts`; add migrations. Figma `4:5`, `4:6`.

**Interfaces:** produces `recordRound(ctx, { admissionId, notes, orders, feeScheduleId?, requestId })`, `addClinicalAddendum(ctx, { noteId, reason, text })`, `recordShift(ctx, { admissionId, startedAt, endedAt?, handover, requestId })`, `recordObservation(ctx, { admissionId, shiftId, scheduledFor, observedAt, values, requestId })` and `recordAdministration(ctx, { orderId, shiftId, scheduledAt, actualAt, actualDose, doseUnit, outcome, reason?, requestId })`; outcomes are `GIVEN | HELD | REFUSED`. `values` names BP systolic/diastolic, pulse, temperature C, SpO2, respiratory rate and pain score. Nurse/signature identity comes from context. Orders carry kind, requested item/procedure, dose/route/frequency/duration as applicable and create assigned work tasks/stable billable source IDs.

- [x] Write tests that a repeated round/order creates one task/fee; notes cannot be overwritten; addenda retain the original; held/refused medication is preserved; unauthorized edits fail; missed prescribed observations/MAR remain overdue across handover. Verify failures before implementing.
- [x] Implement doctor identity/server timestamps, orders for medicines/tests/procedures/diet, procedure completion linked to the configured item/package charge, prescription dose/route/frequency/duration and clinical summary fields. Add nurse shift start/end/attendance, assigned patients, prescribed intervals, actual readings, MAR and handover.
- [x] Keep clinical task completion distinct from billing status. Medicine administration does not add another medicine charge; Task 8 charges pharmacy issue. Nursing monitoring continues after nursing financial clearance until clinical instructions/departure change it.
- [x] Run care integration tests and role browser checks, lint/typecheck; commit `feat: track clinical care and nursing work`.

Task6 acceptance: independent specification/quality review and correction accepted; full33 unit/12 actual PostgreSQL/lint/types/build/14 browser checks passed. First procedure rate pins survive concurrent resolution and settings changes; current nurse access is rechecked even on completed retries. Reviewed ordinary0009–0012 applied with account/settings/data preservation. [Care](../../CARE.md) records actual APIs and limits. Item prices are supported; package policy is still unconfigured/deferred. Ward MAR is scheduled-only. Gate3 does not exist yet; the actual post-seal monitoring regression belongs Task11, while current care logic depends on physical episode/instructions rather than financial clearance.

## Task 7: Exact ICU/ward transfers

**Files:** add transfer commands to `web/src/server/admissions/commands.ts`, transfer-order handling to clinical commands, room boundary handling to billing; create `web/tests/integration/transfer.test.ts`; update doctor/nurse/bed views and migrations if required. Figma `4:5`, `4:6`.

**Interfaces:** produces `transferAdmission(ctx, { admissionId, transferOrderId, targetBedId, handover, transferredAt, requestId }): Promise<{ oldStayId, newStayId }>`; consumes tariff snapshots, clinical order and `postDueRoomCharges`.

- [x] Write concurrent target-bed/retry tests and assert old end equals new start exactly at `T`, no overlap/gap, correct tariff totals and consumables remaining with their source unit. Verify failures before implementation.
- [x] Lock the admission and affected beds consistently; validate clinician order/nursing handover, close/open stays and audit in one transaction. Reconcile charges to `T`; insurance follow-up is a staff task, never an external eligibility call.
- [x] Run transfer and affected billing/admission tests, lint/typecheck; commit `feat: add traceable inpatient transfers`.

## Task 8: Pharmacy stock, issue/return and take-home medicines

**Files:** create `web/src/server/pharmacy/{schema.ts,commands.ts}`, `web/src/app/(staff)/pharmacy/{page.tsx,actions.ts}`, `web/tests/integration/pharmacy.test.ts`; add migrations. Figma `4:7`.

**Interfaces:** produces `recordStockReceipt(ctx, { medicineId, batchNo, expiresOn, quantity, unit, barcode, reference, requestId })`, `issueMedicine(ctx, { admissionId, orderId, batchId, quantity, unit, requestId })`, `returnMedicine(ctx, { issueId, quantity, reason, requestId })`, `prepareTakeHomeMedicines(ctx, { admissionId, prescriptionVersionId, items, requestId })` and `getPharmacyReview(admissionId)`. Each take-home item binds order/batch/quantity/unit; each issue creates one ledger event; accepted returns create linked stock movement/billing reversal.

- [x] Write tests for concurrent stock issues, expired/insufficient batch rejection, issue retry, return exceeding issued quantity, issue+MAR billing once, and take-home quantities matching the signed prescription.
- [x] Implement receipt/batch/expiry/barcode identity, issue/return/authorized adjustment audit and low-stock visibility; no procurement/vendor accounting or dispenser integration. Preserve original movement and charge history.
- [x] Build the worklist/reconciliation view and return unresolved issues to Task 11's pharmacy gate. Run pharmacy plus medicine-billing tests, lint/typecheck; commit `feat: add pharmacy stock and reconciliation`.

Task8 acceptance: independent specification/quality review accepted after physical-receipt source deduplication correction. Full33 unit/28 actual PostgreSQL/lint/types/build/16 browser checks passed; runtime audit0. Reviewed ordinary0016–0018 applied with baseline preservation. [Pharmacy](../../PHARMACY.md) records identity, original-price returns, one-batch-per-prescription-line preparation and actual review projection; professional clearance remains Task11. Applied SQL literal bytes are preserved by Git attributes and verified against staged blobs.

## Task 9: Lab/radiology orders, barcode samples and reports

**Files:** create `web/src/server/lab/{schema.ts,commands.ts}`, `web/src/app/(staff)/lab/{page.tsx,actions.ts}`, `web/src/app/api/lab/samples/[sampleId]/barcode/route.ts`, `web/tests/integration/lab.test.ts`, `web/tests/e2e/lab.spec.ts`; add migrations. Figma `4:8`.

**Interfaces:** produces `collectSample(ctx, { orderId, requestId })`, `recordLabReport(ctx, { orderId, result, reportDocumentId?, requestId })` and authorized sample lookup. Sample IDs/barcodes uniquely bind to patient/admission/order.

- [x] Write tests that an unknown/wrong-patient barcode cannot complete an order, repeat scan/completion does not double-charge, and pending lab charges finalize once. Test keyboard-wedge scanner input and readable printed sample labels in the browser.
- [x] Use a maintained barcode renderer such as `bwip-js` after compatibility/license review rather than a custom encoder. Support order -> collection -> processing -> report and radiology's corresponding report workflow; no instrument integrations are assumed.
- [x] Run lab integration/E2E and affected charges tests, lint/typecheck; commit `feat: add lab worklist and sample barcodes`.

Task9 acceptance: independent specification/quality and12-assertion rollback runtime probe accepted; full33 unit/33 actual PostgreSQL/lint/types/build/17 ChromiumHTTP checks passed, runtime audit0. Reviewed ordinary0019–0022 applied with baseline preservation and literal SQL bytes intact. [Lab](../../LAB.md) records actual barcode/report/source contracts, collected-stopped review limits and protected-file/post-closure-report boundaries. Owner-directed successor chat GPT6.1SolExtraHigh begins at Task10 after this active checkpoint is saved; one build chat edits INS at a time.

## Task 10: Staff-entered insurance decisions and protected documents

**Files:** create `web/src/server/insurance/{schema.ts,commands.ts,documents.ts}`, `web/src/app/(staff)/insurance/{page.tsx,actions.ts}`, `web/src/app/api/insurance/cases/[caseId]/documents/route.ts`, `web/tests/unit/responsibility.test.ts`, `web/tests/integration/insurance.test.ts`; add migrations. Figma `4:10`.

**Interfaces:** produces `recordPayerDecision(ctx, { caseId, status, verifiedBy, verifiedAt, reference, approvedPaise, coPayBps, allocation, documentIds })`, `convertToSelfPay(ctx, { caseId, reason, decisionReference, allocation, expectedCaseVersion, requestId })`, `computeResponsibilities({ netBillPaise, eligibleBillPaise, coPayBps, insurerAuthorizedPaise, verifiedPatientLiabilityPaise? })` and `attachCaseDocument(ctx, { caseId, file, expectedCaseVersion, requestId })`. Status includes pending/approved/partial/rejected; preserve appeals/enhancements and prior decision versions. `allocation` records staff-verified eligible/non-payable/uncovered responsibility and its source reference; it never establishes coverage automatically.

- [x] Write assertions for authorization versus receipt, partial/rejected decisions, revised approval, pending allocation and co-pay counted once. With eligible `10000000n`, 10% co-pay, non-payables `1500000n`, insurer responsibility is `9000000n`, patient `2500000n`; authorization plus zero insurer receipt must remain unpaid.
- [x] Implement responsibilities with exact rounding: insurer liability is capped by recorded authorization and eligible bill less co-pay; minimum patient responsibility is co-pay plus non-payables. An authorization shortfall remains `unallocatedPaise` until staff record the verified patient allocation or an explicit exception/disposition. Reject over-allocation; ordinary finalization requires no unresolved allocation. Never infer payer coverage from this arithmetic.
- [x] Record insurer/TPA/policy/member/validity as externally verified staff data with provenance/evidence. For approval shortfalls or disputed liability, require staff-recorded allocation/disposition rather than silently assigning all shortfalls to the patient. Running estimates are labeled until the final staff-recorded allocation is complete.
- [x] Implement an authorized, audited insured -> self-pay conversion after denial/staff decision, preserving previous decisions, receipts and outstanding obligations. Test stale/repeated conversion, affected review invalidation and a settled self-pay result. Changing the route flag alone must not erase insurer dues; the verified allocation or explicit admin disposition must resolve responsibility first.
- [x] Implement protected versioned uploads outside `public/`, generated storage names, file-size/type/signature checks and access-controlled download. Start with PDF/JPEG/PNG, configurable size limit with tested rejection; never use supplied paths as storage paths or execute file content. No AI/insurer transmission here.
- [x] Show manual pre-auth/enhancement/appeal work and configured 80% defaults as staff alerts. Run responsibility/insurance/access tests, lint/typecheck; commit `feat: record verified insurance decisions and documents`.

Task10 acceptance: independent specification/quality accepted after correcting a reproduced hidden patient-excess display. Fresh full36unit/39actualPG/lint/types/standardbuild/19ChromiumHTTP passed, runtimeaudit0. Reviewed ordinary0023–0024 applied with8staff/8accounts/0settings/domain0 preservation; all25SQL literal bytes intact. [Insurance](../../INSURANCE.md) records current cases, source-bound allocation, retained cash and protected document contracts. Human seals/refunds remain Task11; checkpoint/CI evidence is in the build ledger.

## Task 11: Human gates, actual settlement and physical departure

**Files:** create `web/src/server/discharge/{schema.ts,dependencies.ts,commands.ts}`, `web/src/app/(staff)/discharge/{page.tsx,actions.ts}`, `web/tests/integration/discharge.test.ts`, `web/tests/e2e/discharge.spec.ts`; add migrations. Figma `4:11`, `4:12`.

**Interfaces:** produces `getClearanceReview(admissionId, gate)`, `issueClearance(ctx, { admissionId, gate, expectedReviewHash, expectedBillVersion? })`, `invalidateAffectedClearances(tx, { admissionId, changeKind, changedRecordIds })` and `recordDeparture(ctx, { admissionId, departedAt, expectedBillVersion, requestId })`. `expectedBillVersion` is required for Billing; earlier gates validate their own reviewed dependencies rather than reject every unrelated bill change. Gate review hashes cover only that gate's actual reviewed inputs/dependencies, not the entire patient record.

- [x] Write direct-server tests for wrong signer, skipped gate, stale hash/version, new relevant order/charge and receipt/finalization races. A billing-only correction must preserve an unrelated doctor seal. A prescription change reopens pharmacy and genuinely dependent checks. Duplicate finalization releases a bed once.
- [x] Enforce clinical summary/prescription, pharmacy reconciliation, nursing chart/consumable/hours review and final billing settlement in order; capture signed inputs, actor/role/time/hash/version. Gate preparation can occur earlier but formal clearance follows the previous current seal.
- [x] Keep patient and insurer dues/excess refunds separate. Assert approved sample: net `11500000n`, insurer receipt `9000000n`, patient deposit `3000000n`, refund `500000n`, retained `11500000n`, outstanding `0n`. Missing insurer receipt blocks ordinary insured clearance; equivalent settled self-pay does not need it.
- [x] Freeze reviewed bill versions. A final seal alone does not release the bed. Record physical departure/cutoff, catch up charges and validate current seals/settlement transactionally before ordinary discharge and housekeeping turnover. Delayed exit/extra charge reopens the affected billing approval and supersedes stale documents; a factual early/unsettled exit goes through the admin exception route, preserving the actual departure time.
- [x] Run discharge integration/E2E plus affected money/transfer tests, lint/typecheck/build; commit `feat: enforce human discharge clearance and settlement`.

Task11 acceptance: independent specification/quality and the same reviewer’s scoped attendance correction accepted; fresh full 36 unit/60 actual PostgreSQL/lint/types/standard build/21 ChromiumHTTP checks passed, runtime audit0. Reviewed ordinary0025–0031 applied with complete baseline preservation and all32 SQL bytes intact. [Discharge](../../DISCHARGE.md) records the true physical bed cutoff, later hospital departure, coherent snapshots, refunds and cleaning. A real human-paced nonzero-rate probe and exact cash sample pass. Administrator exceptions and post-discharge amendments remain Task12.

## Task 12: Admin exceptions, amendments and remaining obligations

**Files:** create `web/src/server/discharge/exceptions.ts`, add exception/amendment schema, `web/src/app/(staff)/exceptions/{page.tsx,actions.ts}`, `web/tests/integration/exceptions.test.ts`; update admission/departure/billing commands. Figma `4:14`.

**Interfaces:** produces `authorizeException(ctx, { admissionId?, type, authority, reason, evidenceIds, disposition, obligations, followUpOwnerId })` and `applyPostDischargeCorrection(ctx, input)`. Types cover every exception named in the scope; obligations retain payer, amount, status and follow-up owner.

- [x] Write tests for admin-only authority, urgent no-deposit admission, insurer delay/denial, unpaid credit, absent approver, leaving early/against advice, external transfer, death and post-discharge correction. Assert no exception creates another professional's seal or silently sets owed money to zero.
- [x] Implement explicit records/routing, required professional evidence, actual disposition/departure and follow-up tasks. Record bed turnover after actual exceptional exit; preserve outstanding collections and incomplete seals. Post-discharge changes append linked amendments/reversals and supersede affected versions, never reopen an occupied bed automatically.
- [x] Run exception tests and ordinary discharge regression, lint/typecheck; commit `feat: add accountable admin exception handling`.

Task12 acceptance: independent specification/quality and fresh GPT-6.1 scoped correction review accepted; fresh full36unit/92actualPG/lint/types/standardbuild/26ChromiumHTTP passed, runtimeaudit0. Reviewed ordinary0032–0048 applied with all original61table/column hashes preserved and49SQLliteralbytes intact. [Exceptions](../../EXCEPTIONS.md) records truthful urgent identity, actual exceptional exit, obligations, professional reconsideration, effective witnesses and narrow amendments. One-sided completed intermediate transfer/return corrections remain explicitly unsupported. Owner gate: PAUSE for approval beforeTask13; GPT-6.1 only.

## Task 13: Versioned discharge copy, print/export and verification

**Files:** create `web/src/server/documents/{schema.ts,commands.ts,pdf.tsx}`, `web/src/app/(staff)/documents/[documentId]/page.tsx`, `web/src/app/(staff)/documents/[documentId]/print/page.tsx`, `web/src/app/(staff)/documents/[documentId]/verify/page.tsx`, `web/src/app/api/documents/[documentId]/pdf/route.ts`, `web/tests/integration/documents.test.ts`, `web/tests/e2e/documents.spec.ts`; add migrations. Figma `4:13` including its full scrolling footer.

**Interfaces:** produces `createDischargeDocument(ctx, { admissionId, billVersion, clearanceVersions, exceptionId? }): Promise<{ documentId, version, hash }>` and `verifyDocument(ctx, documentId)`. Hash a canonical immutable content snapshot; original and amended versions remain accessible to authorized staff.

- [x] Write tests for document/ledger/seal version consistency, authorization on guessed IDs, immutable old snapshots and replacement versions. Assert authorization and receipt values are labeled separately; exceptional documents show actual seals/status/dues.
- [x] Implement all five scope document blocks: hospital/patient/transfer identity, clinical summary/prescription/follow-up, itemized financial reconciliation, real signer panel and verification/version/footer. Use a maintained QR generator such as `qrcode`; link to an authenticated document verification view without exposing patient details publicly.
- [x] Provide native browser printing for the HTML view and an authenticated PDF download using `@react-pdf/renderer` from the same immutable snapshot. A maintained renderer handles wrapping/page numbers/headers; do not write a custom PDF encoder or duplicate financial calculations in the layout. Load the PDF skill for rendering/text/visual verification.
- [x] In Playwright, exercise the authenticated PDF download and browser print view separately. Inspect the downloaded React PDF bytes, meaningful extracted content and every rendered page/footer for a multi-page synthetic case; unauthorized download must fail. Run document integration/E2E plus discharge regression, lint/typecheck/build; commit `feat: generate verified discharge documents`.

## Task 14: Durable LangGraph insurance-paperwork assistance

**Files:** create `web/src/server/insurance/{paperwork-graph.ts,paperwork-commands.ts}`, `web/src/app/api/insurance/cases/[caseId]/paperwork/route.ts`, `web/src/app/api/insurance/cases/[caseId]/paperwork/[runId]/review/route.ts`, `web/tests/integration/paperwork.test.ts`; add graph metadata/follow-up schema and the official PostgreSQL checkpointer setup. Update insurance UI. Figma `4:10`.

**Interfaces:** produces `startPaperworkRun(ctx, { caseId, expectedDocumentVersion, requestId })`, `getPaperworkRun(ctx, runId)` and `reviewPaperworkRun(ctx, { runId, decision: ACCEPT | REQUEST_CHANGES | REJECT, comment, expectedDocumentVersion, requestId })`. Routes expose POST start, GET status and POST review. A run UUID/thread ID is bound to the case/document version; a client-supplied thread ID does not confer access.

- [x] Write restart/interrupt/resume tests using a deterministic synthetic drafting function and persistent PostgreSQL checkpoints. Assert unauthorized review fails; changed files invalidate stale proposals; retry creates one reviewed draft/follow-up; hostile extracted instructions cannot invoke tools or clinical/financial actions.
- [x] Build `inventory_documents -> extract_text -> check_required_fields -> draft_packet -> human_review`. Human review uses LangGraph `interrupt` and `Command` resume; requested changes loop back to drafting with a bounded revision limit (proposed 3), rejection closes the run, acceptance saves the reviewed draft and local staff tasks. Resume rechecks current case/documents/permission before applying anything.
- [x] Keep graph state minimal, citations/source provenance visible, effects idempotent and long external work outside DB transactions. Use `@langchain/langgraph-checkpoint-postgres`, not in-memory checkpoints as a restart guarantee. Core admission/care/billing/discharge stays usable while AI is unavailable.
- [x] Before real model/OCR processing, record the owner's chosen provider/model, allowed document handling, credentials location and approval boundary. Until then use synthetic tests/manual text; never silently choose or switch a provider. No email/portal/insurer sender tool is included.
- [x] Run persistent paperwork integration and UI human-review checks, lint/typecheck/build; commit `feat: add reviewed insurance paperwork workflow`.

## Task 15: Hospital overview, worklists and actionable alerts

**Files:** create `web/src/server/overview.ts`, `web/src/app/(staff)/overview/page.tsx`, `web/tests/integration/overview.test.ts`, `web/tests/e2e/role-workspaces.spec.ts`; connect existing role worklists and alert queries. Figma `4:3` and all role screens.

**Interfaces:** produces `getOverview(ctx, { asOf, bedCategory? })` and `getStaffWorklist(ctx, { asOf?, bedCategory? })` from actual episode/task/ledger/clearance records, respecting field/access policy.

- [x] Write tests where overdue observations/MAR, low stock, insurer-limit/deposit thresholds, missing paperwork, pending seals and partial receipts produce the correct counts/action owner; resolved items stop appearing and retries do not duplicate tasks.
- [x] Show bed occupancy/turnover, active admissions, discharge blockers, staff handover work and financial summaries using live authorized queries. Do not replace unknown/failed data with misleading zeros or hard-coded prototype statistics.
- [x] Check every approved role view at desktop and a usable narrower width, keyboard operation, focus, labels, table scrolling, long names/notes, empty/error/loading states and zero/large money values. Reuse native form controls/simple tables before adding UI libraries.
- [x] Run overview/role-workspace E2E and affected tests, lint/typecheck/build; commit `feat: connect hospital overview and staff alerts`.

**Accepted interface adjustment:** Existing beds have categories, not a ward entity. `bedCategory` scopes episodes/beds/money; shared stock stays hospital-wide. `asOf` evaluates current rows, not historical reconstruction. See [Overview](../../OVERVIEW.md) and the acceptance ledger.

## Task 16: Whole-flow verification, backup/restore and local pilot handoff

**Files:** extend the existing `.github/workflows/checks.yml`; create `web/tests/e2e/inpatient-journey.spec.ts` and `docs/LOCAL_PILOT.md`; update README, AGENTS and project context with real commands, completed tasks and limitations. Reuse the existing verification workflow rather than adding a duplicate CI job.

**Interfaces:** consumes all preceding tasks; produces reproducible setup/check instructions and evidence for the intended local pilot. This is not an external deployment or permission to use real patient data.

- [x] Configure CI with a fresh PostgreSQL service and synthetic data. Pin package lock and action versions; use the same lint/typecheck/unit/integration/E2E/build commands as local checks, with no skipped integration checks to obtain green status.
- [x] Exercise full self-pay and insured admissions, transfer, notes/addenda, MAR/stock return, sample/report, partial payer receipts, all gates, refund, actual exit, admin exception and amended document. Include concurrent/stale/retried requests at important boundaries.
- [x] Verify staff access, private uploads/downloads, secure session configuration for the intended environment, no secrets/patient data in Git/logs, and no AI/insurer/payment network effects outside the authorized boundaries.
- [x] Demonstrate backup plus restore into a separate isolated database and storage directory; verify clinical history, ledger totals, document versions and paused AI review after restore. Record backup/access/retention responsibilities with the hospital before real use; never restore over the working database to test recovery. Synthetic recovery is complete; hospital ownership/retention decisions remain a real-use gate.
- [x] Run the complete checks, record commit/commands/observed results and visually review the 13 role/state screens against Figma. Commit `test: verify inpatient workflow and local pilot readiness`. List any unmet requirement; do not call the system production-ready solely because tests pass. Local results and corrections are qualified below; successful complete CI at the exact final development commit remains mandatory before closing the checkpoint.

**Task 16 implementation and review:** Independent specification and quality review passed with no blocking findings. Local evidence is 70 unit passes, 143/144 PostgreSQL passes followed by all four affected access tests passing after fixture isolation, lint/types/build and 45 Chromium/HTTP passes, final isolated recovery of 81 tables/1,575 rows/15 protected artifacts, and visual comparison of all 13 Figma role/state screens. The complete local aggregate was not rerun after the scoped fixes; fresh exact-commit development CI must run all required suites. Record its commit, run and observed results in the ignored build ledger and GitHub Checks. All original ordinary records/credentials/checkpoint rows and SQL bytes were preserved; eight orphan synthetic document artifacts from the initial timeout escape remain ignored and retained, with guard/drain regressions passing. Runtime audit is zero; five high development-tool findings and hospital operations/provider decisions remain disclosed in [setup status](../../SETUP_STATUS.md) and [local pilot](../../LOCAL_PILOT.md). Pause after this verified development checkpoint. Later whole-branch review and main integration require the owner's next approval.

## Decisions required at their owning stage

These do not block writing this plan. They do block the corresponding real-data behavior when still unanswered.

| Before | Owner/hospital decision |
|---|---|
| Actual database connection/setup | Existing/new PostgreSQL instance, supplied local configuration, runtime/migration/test DB ownership; do not infer passwords or reset existing data |
| Real staff use | Role/assigned-care permissions, professional signers, account recovery/session policy, exception authority and required clinical paperwork |
| Real financial use | Approved tariffs/billing basis, rounding/grace/taxes/packages/deposit rules, alert thresholds, partial-authorization allocations and refund/credit policy |
| Real AI/OCR use | Provider/model, permitted document processing, credentials, budget/retention and staff review responsibility |
| Real hospital pilot | Hosting/access method, backups and recovery owner, storage protection, retention and operational sign-off |

Use clearly labeled synthetic configuration until these are supplied. Technical library choices above are proposals with no packages installed yet; revising them before their owning task is cheaper than migrating working data later.

## Current-source references

- [Official Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [CLI options](https://nextjs.org/docs/app/api-reference/cli/create-next-app), [version-matched agent guidance](https://nextjs.org/docs/app/guides/ai-agents).
- [Drizzle PostgreSQL connection](https://orm.drizzle.team/docs/get-started-postgresql); live npm `latest` inspected as `0.45.4`, while documentation also advertises release-candidate examples: choose stable compatible packages, not `@rc` by accident.
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [staff administration](https://better-auth.com/docs/plugins/admin).
- [LangGraph JS](https://github.com/langchain-ai/langgraphjs), [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [PostgreSQL checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers).
- [Vitest in Next.js](https://nextjs.org/docs/app/guides/testing/vitest), [Playwright](https://playwright.dev/docs/intro), [tooling recommendations](../../TOOLING.md).
- [React PDF components](https://react-pdf.org/components), [barcode encoder](https://github.com/metafloor/bwip-js), [QR encoder](https://github.com/soldair/node-qrcode).

## Plan review and implementation handoff

The owner authorized phase execution with subagents. Tasks 1–16 are implemented and independently reviewed; Task 16's final development checkpoint requires exact-commit complete CI as recorded above. Earlier Task 13/14 unchecked boxes were stale documentation, reconciled with saved acceptance evidence on 10 October 2026. Live AI/OCR remains unconfigured. All Task 16 source/fixture/build/review writers have finished. Save the verified checkpoint and limitations, then pause as requested; later whole-branch review, fresh checks and main integration require the next owner approval. Keep the root instructions and approved product/UI decisions controlling; follow the current status in docs/agent/BUILD_HANDOFF.md.
