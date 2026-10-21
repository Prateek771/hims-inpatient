# Transcript Workflow Revision — Proposed Implementation Plan

> **For agentic workers:** After owner approval only, use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Checkboxes below are future work, not execution authority.

**Status:** Owner approved the plan and authorised local UI improvements first on 18 October 2026. Task 1 is complete; see [local UI results](../../agent/LOCAL_UI_REVISION_PROGRESS.md). All database migrations, schema-dependent implementation, Vercel deployment and both previously reported bug fixes remain on hold. Approval of this UI phase does not authorise the later gated tasks.

**Goal:** Make inpatient admission, location changes and discharge easier to operate while retaining the existing six dashboards and accountable records.

**Architecture:** Reuse the current Next.js/PostgreSQL application, role enforcement, transfer commands and discharge checks. Improve forms and patient views first; propose small additive data changes separately. Vercel is a future hosting direction, with migration explicitly paused.

**Tech stack:** Existing Next.js, React, PostgreSQL, Drizzle, Better Auth and bounded LangGraph workflows; no replacement framework or authentication system.

**Spec:** The proposed product rules in sections 1–4 below interpret the owner-supplied Hindi/English transcript (attachment `1153ee37-634f-4a9a-a1ea-833776dd5c55/Pasted text.txt`). The current [approved scope](../../PROJECT_SCOPE.md) remains authoritative until the owner approves specific revisions. StudioJunction is a usability reference, not a hospital feature specification.

## Global constraints and approval boundary

- Work only in `C:\Users\prate\OneDrive\Desktop\INS`, on `codex/hims-development`; preserve unrelated work.
- Preserve existing patients, accounts, credentials, bed IDs, UHIDs/IPs, ledger history, private files, document versions and applied migration bytes. No reset or reseed.
- Latest owner authority permits Task 1 local UI implementation and the local preview refresh. No new cloud resources, secret changes, uploads or deployment. Preserve unrelated work and existing data/accounts.
- Migration is ON HOLD. Do not generate/apply schema changes, mutate ordinary records, export/restore data or backfill locations. Read-only SELECT/hash verification is permitted. Local schema-dependent work and cloud migration remain separately gated; approval of interface work alone does not lift either hold.
- Keep six routine roles: Admin, Admission, Nurse, Pharmacy, Billing and Insurance. Keep clinical authority external and named; keep server-side authorisation, exact bed-use boundaries and deterministic money.
- Keep the 404 insurance handoff and misleading closed-history finance label documented in the [walkthrough review](../../agent/NISHA_WALKTHROUGH_REVIEW.md). Do not bundle their fixes into this revision without owner approval.
- Owner model preference: GPT-6.1 Sol for subagents, effort appropriate to the task; Astra for the main chat. Subagent models can be set explicitly. The main model must be selected through the chat's model selector; this document does not claim to switch it.

## 1. Admission: proposed simple form

| Field / action | Proposed behaviour |
|---|---|
| Find existing patient | Search name, UHID or phone before registering another person; reuse identity and issue a separate IP for the stay. Confirm existing search capabilities before adding phone search. |
| Patient name | Required in normal registration. Keep current UHID generation and uniqueness rules. |
| Date of birth OR age | Keep the current either/or rule. Unknown details remain supported through the explicit identity exception. |
| Sex; contact number | Keep current options and validation; phone remains optional. |
| Reason for admission | New short field for this stay: 2–500 characters, required for new admissions after activation of the revised form. Record the stated reason, not a software-generated diagnosis. Retain recorder/time and use an attributable correction if amended. Older stays show “Not recorded” rather than invented information. |
| Treating Doctor, if known | Proposed optional searchable directory choice at intake, with “Not yet assigned.” Do not create a fake Doctor or silently substitute an available Doctor. |
| Later Doctor assignment | Admin or the currently assigned Nurse records the named treating Doctor, effective time and reason; retain previous assignments. Admission may select the initial Doctor but does not gain clinical authority. The named authorizer of a transfer/discharge instruction remains mandatory and independent of this assignment. |
| Self-pay / insurance | Keep, using two simple choices. No new payer integration. |
| Location and bed | Search configured category/location and select a genuinely available physical bed; show the full destination before saving. |
| Expected stay | Retain the current field/default and its business dependencies, placed under additional details. Do not change deposit formulas as a layout shortcut. |
| Save | Clearly say “Reserve bed and save admission.” Show patient, IP and destination confirmation. Actual activation, deposits and urgent authority retain their existing rules. |

**Proposed interpretation for approval:** Remove the prominent normal/temporary identity dropdown from the everyday path. Offer a clearly labelled “Patient identity unknown” exception instead, retaining provenance and existing urgent-authority checks. “Reason for admission” is a separate field; it must never overwrite identity status.

**Doctor clarification:** The transcript first suggests removing Doctor selection, then gives examples where the Doctor is already known. Optional-at-intake with later attributable assignment is the recommended compromise. Do not add a separate referral-management subsystem. If a known Doctor is absent from the directory, Admin adds the real directory entry; otherwise staff can save as not yet assigned after this change is authorised.

**Schema hold:** Optional Doctor currently conflicts with the `admission_version_doctor_identity` database constraint in applied `0057_mvp_identity_staff.sql`. Admission reason and later assignment history also require persisted design. None of these changes can be delivered merely by hiding fields. A future additive migration must preserve the existing constraint's legacy protections; never edit applied 0057.

## 2. Ward / room / bed: minimum useful structure

Keep two concepts separate:

- **Bed category:** the existing Admin-configured tariff/service category, such as General, ICU or AC private. Reuse the current versioned category and tariff settings.
- **Physical location:** one named ward, room or unit containing physical beds. Add a small Admin-managed location register, then link beds to it. Do not build floor maps, buildings, nested departments or an inventory system.

| Location entered by Admin | Bed number | Existing category | Staff-facing example |
|---|---|---|---|
| Ward 476 | 20 | General | Ward 476 · Bed 20 · General |
| Room 204 | 1 | AC private | Room 204 · Bed 1 · AC private |
| ICU 1 | 3 | ICU | ICU 1 · Bed 3 · ICU |

- Proposed records: location has a stable ID, unique hospital-local name and active state; each physical bed retains its existing ID and tariff category, gains a location link and a bed number unique within that location. Keep existing unique bed labels for compatibility. These are design decisions only; SQL is deferred.
- Category names and location names are hospital-defined. Do not hardcode an assumption that every hospital has the same wards, or that every patient first enters a ward.
- Admin creates/maintains locations and beds. Admission and Nurse type to search and choose existing records; they cannot invent a destination while allocating/transferring.
- Show Ready, Occupied, Reserved, Cleaning and Disabled truthfully. Recheck availability on save, including competing staff requests.
- Existing beds require an explicit reviewed mapping later. Do not infer location from labels or silently change their tariff category. Until mapping is approved, show their original label/category; never fabricate a room.
- Keep old locations/tariffs/documents attributable. Future renames/corrections need audit and historical label snapshots/versioning; retired records remain readable. Moving a physical bed to another configured location is allowed only when free of occupancy, holds and pending turnover.

**Tradeoff:** A simple “named location contains beds” model supports both wards and rooms without a mandatory ward → room → bed hierarchy. A deeper hierarchy can be added only if an actual hospital requires it.

## 3. Patient movement and dashboard behaviour

- On an active patient's Nurse view, prominently offer **Shift patient** and **Start discharge**. Each opens the existing authorised workflow; neither executes a move or exit immediately.
- Keep patient name, UHID/IP, current location and current stay start time visible. Reuse details automatically; staff never copy/re-register the patient.
- Shifting collects the existing external Doctor instruction/evidence, destination, actual transfer time and Nurse handover. Keep the same admission/IP and the existing exact charge boundary and bed locks.
- Display an ordered stay timeline: `ICU 1 / Bed 3 — from / to`, `Ward 476 / Bed 20 — from / to`, `Room 204 / Bed 1 — from / Continuing`. Show actual hospital-local times and the recorder where relevant. Use existing effective stay/transfer records; no duplicate movement log.
- Discharge starts from the current location and reuses patient details. Preserve previous stays in history even if the working discharge form shows only the current location.
- Retain the existing parallel checks and distinct Doctor instruction, Nursing readiness, vacancy, final finance, paper delivery, actual exit and authorised cleaning steps. Accepted insurer receivables remain valid under the existing rules.
- Admin opens to **all current patients**, with name/IP, current location, stage, owner/next action and a simple financial summary. Keep optional “Needs action” and history filters; avoid repeating competing “View all” buttons. Do not show all hospital patients to roles that currently have assignment-limited access.
- Keep the current visual style and six role homes. Pharmacy, Billing and Insurance retain their existing responsibilities; shared search/navigation improvements should not expose unauthorised clinical or financial details.

## 4. Vercel direction — deferred, no migration execution

Proposed later shape: **Next.js on Vercel + managed PostgreSQL + private persistent file storage**. Neon and private Vercel Blob are candidates, not approved providers. Keep Better Auth and existing staff roles.

| Current dependency | Later readiness work, after resumption |
|---|---|
| `private-uploads` local filesystem | Add a private storage implementation preserving authorisation, versions, hashes and reliable publication. Vercel temporary disk is not durable storage. |
| Local directory readiness checks | Check the actual configured storage capability without weakening access or integrity guarantees. |
| Repository-relative PDF fonts | Package and test fonts/assets inside the deployed server bundle. |
| Local database names/owners and restricted runtime role | Check hosted PostgreSQL version, role/grant and migration-tool compatibility; preserve minimum runtime privileges and checkpoint schemas. |
| PostgreSQL pools / paperwork execution | Verify concurrent serverless connection use, bounded execution and reliable resume. Review existing room-charge worker scheduling separately. |
| Upload size and server requests | Check hosting request/time limits against existing upload policy; choose an authenticated upload path accordingly. |
| Auth origin and secrets | Configure separate HTTPS preview/live origins and private environment variables; preserve local credentials. |

Local edits would be published through a later configured Git/preview workflow. Local and hosted patient data remain separate; they do not automatically synchronise. App rollback does not undo database writes.

**Resume gate:** Only after the owner resumes hosting/migration: compare provider/version/region/cost, prepare isolated fictional staging, rehearse database-plus-file preservation, verify six roles and one complete journey, then present the concrete deployment/cutover for approval. No export, import, file copy, new accounts, provisioning or connection to a hosted database now.

Official references reviewed during transcript analysis: [Vercel storage providers](https://vercel.com/docs/marketplace-storage), [function filesystem](https://vercel.com/docs/functions/runtimes), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [Git previews](https://vercel.com/docs/git). Recheck current limits and provider compatibility when this work resumes.

## Review focus

1. Existing and unidentified patients: no duplicate identity, erased provenance or fabricated admission reason.
2. Doctor not yet assigned: intake eventually permits it, but transfer/discharge never loses named external clinical authority.
3. Two staff selecting one bed: only one reservation/transfer succeeds; reserved, occupied or unclean beds remain unavailable.
4. Repeated transfer and later location edits: exact time/charge boundaries and historical labels remain attributable, including prior episodes.
5. Shared dashboard components: Admin default changes do not widen Nurse/Insurance access or expose finance to other roles.

## Delivery sequence — Task 1 approved and complete; later gates remain

### Task 1: Presentation improvements using existing records

**Files:** `web/src/components/mvp-workspace.tsx`, `web/src/components/mvp-transfers.tsx`, `web/src/server/mvp/transfers.ts`, `web/src/app/(staff)/mvp/[admissionId]/page.tsx`, `web/src/components/admission-forms.tsx`, `web/src/components/searchable-select.tsx`, `web/src/lib/mvp-transfer-timeline.ts`, `web/src/app/globals.css`; focused unit/SSR cases in `web/tests/unit/mvp-navigation.test.ts`, `mvp-transfer-timeline.test.ts` and `searchable-select.test.ts`. Existing integration/e2e suites remain deferred until their schema/fixture setup is authorised.

**Contract:** Keep `executeMvpTransfer` and discharge mutation contracts unchanged. Extend `getMvpTransferState` with a read-only timeline built from effective stays and existing bed labels; use current labels without inventing ward metadata. Preserve current role filters; only Admin's default view changes.

- [x] Add meaningful regression cases: Admin sees routine active patients by default; assigned-role visibility unchanged; repeated transfers show readable ordered start/end times and one current stay.
- [x] Make these tests fail for the present gaps, then add the minimal projection/navigation/presentation changes.
- [x] Add searchable controlled choices only to long lists touched by the revision; keyboard selection, clear/no-match states and existing server ID validation retained. Keep short choices simple.
- [x] Verify with unit/read-only rendering checks that require no schema or fixture writes while the migration hold remains. The integration/browser wrappers prepare synthetic schemas and fixtures: run them only after the owner explicitly releases that test setup. This phase does not display unsaved proposed fields as working features. See the linked results for fixture-browser coverage and full-flow limitations.

### Task 2: Persist admission changes — BLOCKED BY SCHEMA HOLD

**Files:** `web/src/components/admission-forms.tsx`, `web/src/app/(staff)/admissions/actions.ts`, `web/src/server/admissions/commands.ts`, `web/src/server/admissions/schema.ts`, `web/src/server/mvp/staff.ts`; tests `web/tests/unit/admission-input.test.ts`, `web/tests/integration/mvp-staff.test.ts`, `web/tests/integration/admission.test.ts`, `web/tests/e2e/admission.spec.ts`. A new append-only Doctor-assignment command/history module may be justified; do not restructure unrelated modules.

**Contract:** Preserve `createAdmission(ctx, input)` identity/payment/bed guarantees; add a per-stay reason and optional initial Doctor only after schema approval. Later Doctor assignment is an attributable authorised command, not an unrestricted edit to intake history.

- [ ] After explicit schema resumption, design an additive migration and correction/history rules; review exact permissions and preserve v1 records. Load PostgreSQL guidance before writing SQL. Do not name a migration number until the then-current journal is inspected.
- [ ] Pin tests for required new reason, unchanged old records, no initial Doctor, later authorised assignment, unauthorised changes rejected, named transfer/discharge authorizer still mandatory, and temporary-identity recovery.
- [ ] Implement the approved normal form and exception path only after failing tests establish the gaps. Verify UI, server validation and database constraints together.

### Task 3: Persist location structure — BLOCKED BY SCHEMA HOLD

**Files:** `web/src/server/admissions/schema.ts`, `web/src/server/admissions/commands.ts`, `web/src/server/mvp/transfers.ts`, `web/src/app/(staff)/admin/beds/page.tsx`, `web/src/components/admission-forms.tsx`, `web/src/components/mvp-transfers.tsx`; existing admission/transfer integration tests and `web/tests/e2e/transfer.spec.ts`. Add one focused location command module and a small Admin form only if existing modules cannot keep this readable.

**Contract:** Existing bed IDs/category versions and `targetBedId` remain stable. A future location projection adds display/search metadata, while current transactional availability rules remain authoritative. No UI-submitted name alone can authorise a move.

- [ ] After explicit schema resumption, review the additive location/bed-number storage, historical label strategy and manual mapping preview; apply nothing to ordinary data without the authorised mapping.
- [ ] Pin tests for duplicate bed numbers within a location, same number in different locations, inactive/unmapped destinations, competing allocation, forbidden occupied-bed relocation, and stable historical records after renaming.
- [ ] Implement Admin configuration plus controlled intake/transfer search. Verify same-IP repeated moves, tariff boundaries, room-charge deduplication and old-record compatibility.

### Task 4: Integrated local acceptance after approved implementation

- [ ] Confirm the local schema/test-setup hold has been explicitly released before commands below; a UI-only approval is insufficient. Cloud migration remains paused independently.
- [ ] Run relevant existing commands: `npm --prefix web run test:unit`, `npm --prefix web run test:integration`, and focused `npm --prefix web run test:e2e -- tests/e2e/admission.spec.ts tests/e2e/mvp.spec.ts tests/e2e/transfer.spec.ts tests/e2e/role-workspaces.spec.ts`. These prepare synthetic fixtures; never run them against ordinary data.
- [ ] Run `npm --prefix web run check` for the final integrated checkpoint; retain ordinary localhost:3000 separately from synthetic port3100. Report actual results, not historical pass counts.
- [ ] Verify a synthetic patient through arrival, two transfers, discharge and cleaning; retain the same IP, exact billing and named approvals. Compare protected data/files/migration history before and after any separately authorised ordinary change.
- [ ] Update the user walkthrough with new screenshots only after the approved features work. Stage only reviewed files; preserve unrelated design/docs. Follow existing exact-CI/review requirements before any separately authorised integration.

### Task 5: Hosted readiness / migration — DEFERRED

- [ ] Resume only on a later explicit owner instruction. Reassess section4, then write the provider-specific execution plan and preservation/rollback checks before any cloud changes.

## Owner review summary

The proposed defaults to approve are: separate admission reason; optional intake Doctor with accountable later assignment; retained unknown-identity exception; a simple named ward/room/unit containing beds; searchable configured destinations; clear Nurse movement actions; and Admin showing all current patients by default. Migration and both known bug fixes remain paused. No marketplace, patient portal, inventory expansion or full UI redesign is included.
