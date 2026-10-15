# Approved inpatient MVP: phased implementation plan

Owner-approved direction, 15 October 2026. The owner subsequently approved proceeding with the whole MVP including local PostgreSQL. The [executable task plan](superpowers/plans/2026-10-15-mvp-implementation.md) and [progress record](agent/MVP_IMPLEMENTATION_PROGRESS.md) now control execution. The original document/dashboard checkpoint is complete. Source: [authorized handoff](agent/MVP_DASHBOARD_HANDOFF.md); controlling behavior: [scope](PROJECT_SCOPE.md).

## Preservation and transition

Work only in the sole INS folder on `codex/hims-development`. Preserve all records, staff identities/credentials, old identifiers, signed clinical evidence, ledger/doc versions, uploads, applied SQL bytes and old builds/designs. Reuse Better Auth, server authorization, immutable audit, integer-paise billing, receipt/reversal/refund primitives, physical beds, exact stay boundaries and history. Use an additive, explicit workflow version for new episodes; do not silently reinterpret historical episodes or remove old source tables. Transition decision: existing episodes retain version 1; new admissions explicitly use version 2. No backfill or historical conversion. Reviewed additive migrations and scoped verification are authorized by the full MVP request.

## Authorized implementation phases

| Phase | Affected systems and work | Meaningful acceptance |
|---|---|---|
| 1. Identity and staff operations | Admissions UHID generation: capital initials + 7 random digits with server uniqueness/retry; retain IP sequence and old UHIDs. Decouple Doctor directory/clinical-authorizer identities from active login. Add designated shift nurse/backup Doctor-availability register. | Concurrent collision/retry, historical identity retention, access boundaries; availability has period/return/updater/time and is not attendance or approval. Resolve single-name/unidentified handling before release without blocking urgent admission. |
| 2. Recorded clinical authority and parallel readiness | Nurse records named external Doctor approval, evidence/source time and recorder/time. Nurse publishes checklist. Replace predecessor chain with applicable concurrent checks and selective dependency invalidation. Admin confirms proposed N/A with reason and absence of relevant service/work. | Wrong-role/stale/replay checks fail on server; mandatory Doctor approval, nursing readiness/exit and final finance cannot become N/A. Preserve original signatures; Nurse never becomes prescriber or clinical authorizer. |
| 3. Medicine billing and insurance responsibility | Decouple patient medicine charge/accepted-return reconciliation from native order/batch stock dependencies; retain original-price credits and deduplication. Retain deterministic receipts/deposits/refunds. Permit externally accepted insurer credit to remain receivable at ordinary exit. | Meera example reconciles; medicine credit cannot become a cash refund; no automatic deposit medicine gate. Test partial/rejected insurance, patient dues/refund, pending responsibility, duplicate charges and late insurer receipt on a closed episode without rewriting departure history. |
| 4. Vacancy, finances, papers and exit | Nurse records factual vacancy, waiting location/care handover; close room-use charge boundary, retain hold. Admin/Billing final finance; Nurse/Admin delivers authorized papers; assigned Nurse confirms actual exit. Then closure/cleaning/turnover controls availability. | No premature bed reuse; waiting care retained; final bill uses vacancy boundary; clinical papers available after Doctor approval, final authorized papers deliverable before actual exit; stale changed bills reopen relevant review; actual exit is distinct from document time. |
| 5. Staff UI and retained evidence | Implement six sections only after design approval; patient-centred queue and role-restricted actions. Remove routine Doctor chart/MAR/diagnostic-production/inventory menus only alongside server dependency replacement; retain authorized historical reads. | Complete insured/self-pay/exception journeys with genuine keyboard/narrow-screen/access checks, documents, permissions, and unchanged old records/history. No patient portal or alerts. |
| 6. Authorized release | Independent review and fresh documented full local check, runtime/full audits, additive-migration preservation, exact development CI before any authorized main integration, exact main CI; retain development checkout. | Report actual source/build/CI identities and failures. No deployment or real-data authorization follows from synthetic success. |

## Observed code gaps at 8ffa9691ca2bf8acfcd8e8a58ba8141ad56c2e54

- `web/src/server/admissions/commands.ts`: current `UHID-UUID`; Doctor choices depend on active Doctor users.
- `web/src/server/discharge/commands.ts`: Doctor-only first gate, predecessor-linked sequential seals, Billing/Admin actual departure.
- `web/src/server/discharge/dependencies.ts`: insurer cash and native clinical/MAR/pharmacy/nursing sources still block discharge.
- `web/src/server/pharmacy/commands.ts`: charging and clearance depend on native orders and batch stock.
- `web/src/server/documents/snapshot.ts`: final copies require actual departure; `documents/commands.ts` restricts delivery to Admin/Billing.
- `web/src/server/billing/commands.ts`: ordinary receipt handling rejects closed episodes; future receivable settlement needs a source-bound authorized path.
- No dedicated Doctor availability register was found in the source review. Existing shift/staff records are not that register.

## Historical document/dashboard checkpoint boundary

Updated controlling documents, design source/brief, one native editable Admin dashboard in a new Figma Design file, saved URL/screenshot and scoped checks. Existing Figma files remain untouched. No app code, DB, credentials, migrations, deployment, commit/push/merge or full multi-role rollout. Full app suite is intentionally not run for documentation/Figma-only work.

## Current completion boundary

Full approved local MVP: six staff workspaces, server rules, additive local PostgreSQL schema, meaningful full application/browser/recovery checks, original record/file preservation and truthful runtime evidence. Real hospital operation, external integration and deployment remain separate. Single-name/unknown identity handling is settled in the controlling scope.
