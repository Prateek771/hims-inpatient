# Revised Inpatient MVP Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement tasks with non-overlapping ownership. Root integrates and exclusively owns shared tests, synthetic fixtures, builds, database application and Git.

**Goal:** Implement the approved six-workspace inpatient MVP on the existing local PostgreSQL application without losing or reinterpreting historical evidence.

**Architecture:** Existing episodes remain workflow version 1; new admissions explicitly select version 2 on the server. Reuse deterministic ledger, protected documents, exact physical room history, authentication and audit. Add append-only external authority, checklist/checks, staff availability and immutable MVP financial/document facts with native version-aware guards. No configurable workflow engine or new external service.

**Tech Stack:** Existing Next.js 16.4 / React 19.3 / TypeScript / PostgreSQL 18 / Drizzle / Better Auth / LangGraph. Public Sans local font for the approved UI; retain document fonts.

**Spec:** [Controlling scope](../../PROJECT_SCOPE.md), [phased plan](../../MVP_IMPLEMENTATION_PLAN.md), [approved Admin design](../../design/admin-mvp-2026-10-15/README.md). Latest owner message authorizes full implementation and local PostgreSQL, superseding the prior design-only checkpoint.

## Global Constraints

- Sole INS folder, codex/hims-development; preserve unrelated work and all original data/accounts/credentials/uploads/old builds/Figma files.
- Never rewrite applied migrations 0000–0055. All ordinary database changes are additive reviewed migrations with before/after preservation proof; no reset/reseed/bootstrap/account rotation.
- Existing episodes stay version 1; no implicit conversion or backfill. New server commands use version 2. Retain authorized legacy history and corrections.
- Six routine staff workspaces: Admin, Admission, Nurse, Pharmacy, Billing/Cashier, Insurance. No routine Doctor/Lab dashboard, full clinical/MAR/diagnostic-production/inventory product.
- Human authority, deterministic integer-paise money, no external payer/payment/provider/deployment integration. No real patient-data authorization.
- Preserve source/receipt deduplication, request replay semantics, stale-review rejection, exact room boundaries and common settings/staff → request/admission → sorted bed lock ordering.
- Single-name initials use one letter; unidentified urgent admission uses UN + 7 random digits, explicit temporary identity/provenance, retained UHID after identification. Owner delegated selection on 15 October after explanation. Existing UHIDs remain exact.
- Applicable external diagnostic confirmation can be recorded by assigned Nurse with named external confirmer/evidence; it is a record of external work, not a native diagnostic report or impersonated professional seal.

## Review Focus

- Historical source hashes and original rows/account credentials remain exact after additive schema changes.
- Concurrent/stale medicine returns and repeated cash references cannot over-credit or count cash twice.
- Nurse recording external authority retains both authorizer and recorder; wrong-role/unassigned writers fail server and native checks.
- Changed relevant facts invalidate only affected checks/finance/papers; unrelated checked work remains current.
- Late insurer receipts settle pinned receivables without changing authorized papers or actual exit facts; held/cleaning beds cannot be reused early.

## Task 1 — Baseline and preservation (root)

Files: ignored `tmp/mvp-preservation.mjs`, `tmp/mvp-implementation/before.json`; maintained context/plan.

- [x] Verify branch/HEAD and preserve existing uncommitted docs/assets; no other checkout.
- [x] Inspect installed PostgreSQL 18 and local service/connection. Running and accepting connections outside sandbox; do not provision an existing database.
- [x] Capture read-only original HIMS/native checkpoint row hashes, protected-file hashes and all applied SQL/source checksums. Observed 81 tables, 46 rows, 56 migrations, 123 protected/migration files.
- [x] Run unchanged baseline units: 80/80 passed outside sandbox. Initial restricted run had child-process timing and symlink permission failures, retained as environment evidence; no test weakening.
- [x] Preserve original rows/files again after application/checks and report exact differences if any.

## Task 2 — Identity and accountable staff operations (identity_staff)

Files: `web/src/server/admissions/{commands,schema}.ts`, new `web/src/server/mvp/{staff,staff-schema}.ts`, new migration `0057_mvp_identity_staff.sql`; `web/tests/{unit/mvp-identity,integration/mvp-staff}.test.ts`.

Interfaces: `createAdmission(ctx,input)` creates v2 with no client version selector; trusted server-only `createLegacyAdmission(ctx,input)` retains fixture/historical v1 behavior. New external Doctor directory independent of login; legacy Doctor references remain intact. Public staff APIs: `getDoctorDirectory`, `saveDoctor`, `getDoctorAvailability`, `assignAvailabilityCoordinator`, `recordDoctorAvailability`, with strict input types and current server authorization.

- [x] Write and run failing identity/permission/replay/availability tests; root serializes actual synthetic tests.
- [x] Implement cryptographic initials+7 digits, unique-index conflict/retry and stable unknown-patient identity. Existing patient selection never renumbers.
- [x] Implement separate Doctor identity and Admin-assigned shift Nurse/backup availability register, statuses/period/return/updater/time and immutable history.
- [x] Add v2 admission fields and legacy/new exact relationship constraints; parent updates trusted old fixtures explicitly without an environment bypass or client-controlled version.
- [x] Pass focused units/integration and verify old admission invariants.

## Task 3 — Parallel readiness, medicine, finances, papers and exit (workflow_readiness)

Files: new `web/src/server/mvp/{schema,commands,dependencies}.ts` (split focused modules as needed); new `0056_mvp_coordination.sql`; existing discharge/documents modules; narrow billing command branches; schema exports and migration grants; `web/tests/integration/mvp-workflow.test.ts`.

Interfaces: `getMvpEpisode(ctx,admissionId)` supplies role-authorized episode detail; `recordMvpAction(ctx,input)` strict discriminated actions `doctor-approval`, `checklist`, `check`, `n-a`, `vacancy`, `finance`, `deliver`, `exit`; published `MvpActionInput`. Export narrow patient medicine charge/return and closed insurer receipt commands for real forms. Coordinate exact signatures with UI worker before callsites.

- [x] Establish failing meaningful v2 tests, including wrong-role/stale/direct-SQL native bypass attempts.
- [x] Add workflow_version default1; branch new commands/guards by locked server episode. Add append-only authority/checklist/applicability/check/finance/delivery records and selective dependency hashing/invalidation.
- [x] Reuse common physical facts/stays/holds/turnover, with version-specific references/guards; vacancy closes room use before final finance while retaining bed hold and waiting care. Assigned Nurse confirms actual exit after current mandatory work, final finance and delivered authorized papers.
- [x] Pharmacy-only configured-rate medicine posting and original-price accepted returns, cumulative rounding and over-return protection; no native order/stock/MAR gate and no cash-refund impersonation.
- [x] Retain current complete externally accepted responsibility and patient settlement; insurer accepted credit can remain receivable. Add narrow late insurer receipt path against pinned accepted responsibility with no historical document/exit rewriting.
- [x] Clinical papers after recorded Doctor approval, final authorized papers before actual exit, protected immutable shared storage/version history and assignment-limited Nurse delivery.
- [x] Add new relations to migration grants/schema exports/readiness; preserve original history/guards for version 1 and recovery protected-file enumeration.
- [x] Pass self-pay/insured/partial/exception/stale/concurrency/receipt/return/document/turnover focused checks, including Meera's ₹1,15,000 net/₹25,000 settled patient/₹90,000 insurer receivable with ₹0 insurer cash.

## Additional performed-service billing acceptance

The reviewed 0060 migration adds immutable, configured-rate external consultation/procedure/consumable/lab/radiology source lines, selective check/finance invalidation and native atomic pairing. It also repairs the self-pay finance SQL alias collision without changing settlement predicates. Focused actual PostgreSQL6-file 9-test gate passed after the reproduced self-pay failure.0000–0059 remain frozen. Browser and whole-suite acceptance remain separate gates.

## Task 4 — Six staff interfaces and operational projection (ui_readiness)

Files: `web/src/app/**`, `web/src/components/**`, new `web/src/server/mvp/workspace.ts`; root alone owns dependency/lockfile edits and shared test runners.

Interfaces: Consume Task2/3 strict public APIs. Workspace projection has current authorized patient identity/UHID/IP, stage, blockers, named owner/role, next action and exact operational/money facts; count unique patient episodes, not alert records. Reuse existing forms/tabs/time/money adapters and protected insurance work.

- [x] Apply approved forest/linen/Public Sans design with native web semantics and responsive layout; retain saved preferences without allowing old accent settings to override the approved base world.
- [x] Implement actual Admin patient queue/selection and six grouped sections; Admin operational admission read does not grant intake creation.
- [x] Implement Admission, Nurse, Pharmacy, Billing and Insurance workspaces with real data/actions/errors and role access. New v2 coordination replaces routine charts/stock while v1 history remains reachable by authorized roles.
- [x] Doctor availability responsibility/updates; patient medicine billing/accepted return; insurer receivable settlement; papers/delivery/actual-exit forms consume current hashes/versions.
- [x] Browser tests cover complete nonempty insured/self-pay journeys, keyboard, narrow screens, denial boundaries and immutable document delivery. No hardcoded demo ordinary records.

## Task 5 — Integration, database and release evidence (root + independent reviewer)

- [x] Review integrated diff, migration SQL/grants/guards/schema and all source cross-calls. Do not execute ordinary migration before review and synthetic proof.
- [x] Fresh full `npm --prefix web run check`: units, actual PostgreSQL, lint/types/build, Chromium/HTTP and isolated synthetic recovery; fix root causes without removing old requirements.
- [x] Runtime `npm --prefix web audit --omit=dev`; report full `npm --prefix web audit` separately.
- [x] Apply only reviewed additive ordinary migrations under dedicated limited owner; verify original columns/rows, old applied SQL bytes, private files/credentials and checkpoint history against fresh baseline.
- [x] Start the new verified local copied preview without removing old artifacts, exercise actual readiness/login and new synthetic journey in isolated fixture context. Do not seed ordinary patients or replace credentials.
- [x] Independent final source/security/workflow review, applicable current primary docs, fresh source-specific validation evidence, local links and `git diff --check`.
- [x] Commit/push only verified authorized checkpoint on development when ready, preserve unrelated assets; exact CI before any authorized main integration. No deployment.

## Readiness conclusion

Scope, approved visual direction, chosen stack, existing PostgreSQL, credentials/configuration and preservation baseline are available. The phase outline needed concrete versioning, task ownership, projection and permission contracts; this plan supplies them. Ordinary runtime capability and final migration/recovery/readiness remain checks to execute, not current success claims. Real hospital policy/access/TLS/backups/retention/provider decisions remain outside synthetic local completion.


Local acceptance: complete83/176/81 gate and isolated96-table1850-row23-file recovery passed. Reviewed ordinary 0056–0060 applied with exact81-table46-row historical/56-SQL/private-file preservation. Actual post-commit CI/preview identities live in ignored `tmp/mvp-implementation/release-evidence.json`; publication/preview boxes are closed only after those observations.


Release complete: implementation0b99b436374a85c41f7530a7d4de02b6e150e301 pushed; exact CI38718891980 passed; copied task19 preview BUILD_ID DCQnVTOklKN1DGW4SyifJ runs on localhost:3000 with readiness/login HTTP200. Final ordinary preservation remains81 tables/46 original rows exact and61 migration/source hashes current. These post-commit observations are saved locally and in ignored release-evidence.json; application source matches the pushed checkpoint. Admin real-hospital setup remains required, with no seed/provider integration/deployment.
