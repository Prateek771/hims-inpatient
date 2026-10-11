# Approved role UI implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with the owner-authorized parallel, non-overlapping ownership below. Controller alone owns Git, shared fixtures, builds, global checks, recovery and preview. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved eight-role Figma workflows against the accepted HIMS backend and deliver an illustrated editable patient-journey guide.

**Architecture:** Keep existing server projections, commands, role checks and action forms. Add a shared accessible tab primitive, role navigation and personal appearance/account controls, then compose existing data and forms into the approved work surfaces. No replacement backend, migrations, dependencies or external integrations are planned.

**Tech stack:** Next.js 16.4 / React 19.3 / TypeScript / existing CSS / Better Auth / local PostgreSQL.

**Spec:** [UI handoff](../../agent/UI_REDESIGN_HANDOFF.md), [approved design](../../DESIGN_REFERENCE.md), Figma `SHtJNa3gp1oqOpNm8VzcmQ` and current native frame map `tmp/final-product/final-state-current.json`.

## Global constraints

- Only `C:\Users\prate\OneDrive\Desktop\INS`, branch `codex/hims-development`, GPT-6.1 Sol / Extra High for all agents. No other checkout/worktree.
- Tasks 1–16 backend behavior stays accepted. Preserve all actions, versions/history, actor/time/reason, scope and role denials.
- Admission creates; Admission/Admin activates; Admission accepts patient deposits/top-ups only; Billing cannot activate. Admin never impersonates clinical staff or professional seals.
- Money deterministic; externally verified insurance authorization separate from actual receipts; source-linked allocation and actual refunds; human Doctor → Pharmacy → Nursing → Billing/Admin gates.
- No ordinary reset/reseed/bootstrap/restart; preserve data/accounts/settings/credentials/uploads/native rows and applied SQL bytes. Synthetic checks exclusively own fixtures/builds/port3100; ordinary copied preview is on3000.
- No hardcoded prototype patients/counts. Honest empty/error/blocked/unconfigured states. IBM Plex Sans, navy/teal navigation and exact occupancy denominators.
- Every principal role page retains `getStaffWorklist()`'s authorized actionable `StaffAlerts`, source timestamp and permitted closed-episode/history links currently shown at `/workspace`; redirects cannot discard those capabilities. Integrate alerts compactly and keep the actual job queue principal.
- Profile/password/Logout plus adjacent Customize. Appearance is personal only; use per-user browser storage, never hospital policy/access changes.
- Load Figma design-to-code before design context. Inspect live relevant role/detail/component nodes before edits. Use real layouts, responsive keyboard-accessible controls and reduced motion.
- Agents own only assigned files and their report. No Git, global test/build, fixture mutation, services, other agents, schema/provider/dependency changes.
- Four pending handoff documents are part of the final reviewed checkpoint.

## Review focus

1. Each role must reach every previous action, including source corrections/history and uncommon blocked states; coverage reviewer compares baseline and final page/forms.
2. Hidden tab panels must not make submission controls inaccessible or silently lose drafts; browser check traverses tabs and keyboard controls with actual synthetic records.
3. Narrow worklists/forms must fit the viewport and retain focus and status text; browser checks at390px plus table scrolling.
4. Account/appearance storage must be scoped to signed-in user, tolerate unavailable storage and keep clinical/financial permissions intact; shell browser checks.
5. Receipt/clearance UI must not imply external authorization settles money or Admin can sign professional gates; negative-role and journey tests stay effective.

## Task 1: shared shell, navigation, account and tab interfaces

**Owner files:** `web/src/components/app-shell.tsx`, `account-controls.tsx`, `staff-dashboard.tsx` (optional worklist title only), new `workflow-tabs.tsx`, new `role-navigation.ts`, `web/src/app/globals.css`, `web/src/app/(staff)/layout.tsx`, `workspace/page.tsx`, `web/src/app/page.tsx`. Shell owner alone edits global CSS and these shared files throughout implementation.

**Interface:** `WorkflowTabs({id, items, initialTab?, beforeTabs?})`, items `{id:string,label:string,children:ReactNode}[]`; optional `beforeTabs` places the Admission heading and real intake link inside the delegated same-record link boundary. Accessible tablist/tab/tabpanel with arrow/Home/End keyboard navigation, active panel selection and retained mounted panel forms. Opted-in same-record task links select/focus their panel and scroll valid source fragments without remounting drafts; modifier/new-tab/download behavior follows the real href. `roleNavigation(role:StaffRole)` and `roleHome(role:StaffRole)` define the approved links/start paths.

- [x] Inspect Admin7:456, Doctor3:4, Nurse6:236 and live account/token nodes. Read installed Next.js routing/client component guidance.
- [x] Implement exact approved role menus: Admin all11; Doctor Patients/Discharge/Exceptions; Nurse My shift/Discharge/Exceptions; Admission Admissions/Insurance/Exceptions; Pharmacy Medicines/Discharge/Exceptions; Lab Lab/Exceptions; Insurance Cases/Exceptions; Billing Billing/Insurance/Discharge/Documents/Exceptions.
- [x] `/workspace` resolves the actual role worklist, no duplicate staff Home. Pass actual staff name/email/id/role from authenticated layout; preserve authorized source paths.
- [x] Implement Profile read-only identity/role, existing password/signout endpoints, adjacent Customize accent/density/motion; accessible dismiss/focus and per-user native persistence. Never add self role/name administration.
- [x] Match220px navy sidebar,76px header,24px work-surface padding, native typography/colour/radii. Responsive navigation and forms/tables; reduced-motion behavior.
- [x] Publish interface and report `tmp/ui-redesign/task-1-report.md`; focused static checks only, controller owns browser checks.

## Task 2: Doctor and Nurse care work surfaces

**Owner files:** `web/src/app/(staff)/clinical/page.tsx`, `nursing/page.tsx`; new role-local components only if needed. Shared `care-forms.tsx` and command/actions stay unchanged unless ownership explicitly transferred. The existing `patients/[admissionId]/page.tsx` is operational intake/activation and belongs to Task4; clinical patient links remain `/clinical?admissionId=`.

**Consumes:** Task1 `WorkflowTabs`, retained CSS classes. Patient identity/source context remains outside tabs.

- [x] Inspect live Doctor Patients, rounds/orders/nursing/reports/transfer/summary and Nurse shift/observation/MAR/handover/consumable/transfer nodes from current map.
- [x] Doctor starts Patients with actual assigned work; chart tabs retain rounds/addenda, all medicine/non-medicine orders, procedures/performance/stops/original fee review, read-only nursing, human reports/addenda, exact clinical transfer and summary/prescription.
- [x] Nurse starts actual My shift, time-ordered prescribed work; tabs retain observations/MAR/diet/attendance/handover/consumables/original fee and actual transfer. Monitoring continues after financial clearance until actual departure/instructions.
- [x] Preserve action bindings/testids and all immutable history. Keep role-specific gate and factual exception routes.
- [x] Report exact coverage/files in `tmp/ui-redesign/task-2-report.md`. Controller verifies meaningful care/transfer/role journeys.

## Task 3: Pharmacy and Lab work surfaces

**Owner files:** `web/src/app/(staff)/pharmacy/page.tsx`, `lab/page.tsx`, `lab/samples/[sampleId]/label/page.tsx` if needed; role-local components only.

- [x] Inspect live Pharmacy11:1096 and Lab12:1392 plus task/detail frames.
- [x] Actual medicine queue/stock and tabs preserve exact stock receipts, issue/linked return, take-home preparation, original fee review and Admin-only adjustments.
- [x] Lab queue/task tabs preserve sample identity/collection signing time/barcode/processing, signed human reports/addenda, original fee review/stopped-unperformed reconciliation and source follow-up.
- [x] Keep authenticated label/report paths and roles; no fake scan, automatic report or policy changes.
- [x] Report `tmp/ui-redesign/task-3-report.md`; controller checks department journeys and denials.

## Task 4: Admission and Admin operational work surfaces

**Owner files:** `web/src/app/(staff)/admissions/page.tsx`, `patients/[admissionId]/page.tsx`, `web/src/components/admission-forms.tsx` only if needed, `overview/page.tsx`, `admin/beds/page.tsx`, `admin/staff/page.tsx`, `admin/care/page.tsx`, `admin/settings/page.tsx`, `web/src/components/settings-forms.tsx` (compose six unchanged forms and version history into shared tabs only). Bounded transferred ownership of `staff-forms.tsx` changes directory/create composition only, retaining all handlers and fields. Existing patient detail consumes Task5 billing-form exports without editing that shared component.

**Read-only adapter interface:** controller owns `web/src/server/overview.ts` and its integration regression: `getOverview()` adds `bedOccupancy` entries `{code,name,total,occupied,reserved,cleaning,ready,disabled}` and `metrics.totalBeds`, derived from the existing exact physical bed query in the same read-only transaction. Category totals include all configured physical beds; selected category scope is retained. An admitted hold after actual vacancy remains reserved, never occupied. Task4 consumes that projection, no schema/query authority changes. Patient detail also exposes existing Admission-only patient TOP_UP on ADMITTED episodes via current ReceiptForm contract.

- [x] Inspect Admission10:957 and Admin Home/Beds/Staff/Assignments/Settings/activation frames.
- [x] Admission actual worklist + purposeful identity/reservation/pending deposit/arrival views preserve clinician-provided destination, cancellation, temporary identity and verified identification. Existing UHID distinct from episode IP code.
- [x] Admin all11 jobs reachable. Home5 current operational metrics and category occupancy bars use actual source denominators, separate ready/reserved/cleaning. Existing pending cancellation/activation is reachable without Admin admission creation.
- [x] Staff/session access, assignments, bed inventory/cleaning and all six versioned settings types retain real forms/history; fixed deposits only.
- [x] Report `tmp/ui-redesign/task-4-report.md`; controller checks admission/activation/access/settings and truthful occupancy.

## Task 5: Insurance and Billing work surfaces

**Owner files:** `web/src/app/(staff)/insurance/page.tsx`, `billing/page.tsx`, `web/src/components/billing-forms.tsx`, `insurance-paperwork.tsx`, `insurance-upload.tsx` only if needed.

- [x] Inspect live Insurance12:1852 and Billing13:1663 with policy/file/manual paperwork/receipt/allocation/refund/task frames.
- [x] Actual assigned case/worklist and tabs preserve external policy/decisions/responsibility, protected file versions, manual quoted source/drafts/human review/local packet and follow-up; Admission remains limited to its current authority.
- [x] Billing actual worklist + charges/receipts/allocations/history retains reconciliation, adjustments, all original receipt links and deterministic totals. Pending episodes show Admission/Admin activation handoff; no Billing activation.
- [x] Explicit held-deposit allocation and actual linked refunds remain visible; money/evidence missing gives actionable source follow-up.
- [x] Report `tmp/ui-redesign/task-5-report.md`; controller checks money/insurance/manual-paperwork journeys and role denials.

## Task 6: common discharge, exceptions and retained documents

**Owner files:** `web/src/app/(staff)/discharge/page.tsx`, `exceptions/page.tsx`, `documents/page.tsx`, `documents/[documentId]/page.tsx`, `web/src/components/exception-forms.tsx` only if needed. Preserve immutable discharge-copy/PDF/print/verify components and action contracts.

- [x] Inspect relevant role discharge/exception/financial gate/departure/document frames.
- [x] Actual task tabs and summaries preserve all human gates, blocked reasons, financial review, linked refund, actual bed vacancy/departure/cleaning and saved versions/downloads.
- [x] Preserve specific exception authority/reason/follow-up, historical missing seals/unpaid obligations, original-source amendments and each profession's limited actions.
- [x] Report `tmp/ui-redesign/task-6-report.md`; controller checks full insured/self-pay/exception/amendment journeys and current document integrity.

## Task 7: dedicated illustrated patient-journey guide

**Owner files:** `docs/guides/` DOCX/PDF/editable source/assets/rendered QA only. Await controller's synthetic final-app screenshot set for final captions/images. No application or fixture edits.

- [x] Load Documents/PDF skills and bundled dependencies; read current feature contracts and scope. Verify external high-stakes claims with primary sources; clearly label HIMS-specific rules.
- [x] Write actor table, chronological fictional first-time patient story, all8 roles, self-pay comparison, missing funds/evidence follow-up and glossary as requested in UI handoff.
- [x] Use consistent illustrative net₹1,15,000 / insurer₹90,000 / patient₹25,000 / deposit₹30,000 / allocation₹25,000 / actual refund₹5,000. No medical advice/actual tariffs/private data.
- [x] Embed final implemented synthetic screenshots and labelled diagrams, captions and Figma attribution where used.
- [x] Render/inspect every page, repair layout, extract meaningful PDF headings/body. Deliver `docs/guides/patient-journey.docx` and `.pdf`, source/assets and QA report `tmp/ui-redesign/task-7-report.md`.

## Task 8: independent reviews, complete gates and integration

**Controller files:** `web/tests/e2e/` redesign/updated navigation checks only as meaningful UX changes require; preservation helpers/evidence in ignored `tmp/ui-redesign/`; plan/progress/context/handoff/design state.

- [x] Baseline fresh ordinary/native/private/SQL hashes with read-only helpers. Reviewers read only and compare full baseline-to-working diff plus role coverage reports.
- [x] Add/update meaningful navigation/keyboard/narrow/profile/customize/tab and negative-role browser checks. Preserve all previous business assertions.
- [x] Independent task spec/quality reviews, role/job/permission coverage review and whole-branch review; fix established findings and re-review.
- [x] Serialize fresh `npm --prefix web run check`, runtime audit, full audit separately, preservation comparison, document links/source hashes/ignore/whitespace/staged-content checks. Capture synthetic final UI screenshots only on test database.
- [ ] Final commit/push development, require complete successful CI at exact SHA before nonforce main integration. Confirm exact main CI; leave development branch checked out.
- [ ] Retain old artifacts; refresh ordinary3000 copied preview from accepted source after gates, verifying process/build/source identity. No DB restart or deployment.
- [ ] Update durable progress and report actual evidence, role changes, preview and DOCX/PDF links.

## Execution record

Starting source `dfd0a618f2a74c87b6ec2174433cc6295603d5c3`; four inherited approval/handoff documents preserved. Fresh GitHub development CI38056878739 and main CI38057563148 both completed successfully at that source. Owner already approved implementation and parallel execution; no repeat approval gate applies. Parallel tasks start only once shared interfaces are available; document drafting and read-only coverage inventory can begin immediately.

Preflight correction: the existing patient detail is an operational reservation/deposit/activation page, so ownership moves from care Task2 to operational Task4. This retains the existing flow and avoids concurrent edits to financial components.

Preflight coverage: principal pages retain workspace alerts and permitted closed history. Controller provides exact physical category projection, avoiding the incorrect assumption that an ADMITTED bed hold always means physical occupancy. The existing command already permits Admission active-stay TOP_UP; expose that UI without broadening authority.

Execution findings: all six role/shared tasks received independent specification and code-quality passes. The controller's actual Profile regression revealed a Node24/Next proxied-Request cloning failure in the existing bounded password route. The approved account-control work requires a narrow transport repair: reconstruct the already authenticated, bounded, validated JSON Request from its URL/headers while retaining forced other-session revocation. The real PostgreSQL regression failed before the repair and passed afterwards; fresh whole-run evidence remains a separate gate. No schema, business authority, dependency or provider was changed.

Final pre-commit gates: the fifth complete command passed70 unit/167 PostgreSQL/76 browser cases, lint/types/build and isolated recovery; ordinary/native/private/source preservation and document/staged checks passed. Guide15-page DOCX/PDF and all8 exact tested UI excerpts are independently accepted. The remaining release boxes are the saved pre-commit state; this commit's later exact CI/main/preview outcomes are recorded after observation in ignored `tmp/ui-redesign/release-evidence.json` and `task-8-report.md`, as explained in [progress](../../agent/UI_REDESIGN_PROGRESS.md).
