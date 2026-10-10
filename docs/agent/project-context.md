# Project context

Last verified: **10 October 2026**. Read this navigation record, then the relevant scope and feature contract. Historical checkpoint details remain in [build handoff](BUILD_HANDOFF.md), [setup status](../SETUP_STATUS.md), Git and the ignored [build ledger](../../.superpowers/sdd/2026-10-09-hims-inpatient/progress.md).

## Current work and authority

Tasks 1–16 and all eleven final runtime review findings are implemented and independently accepted with GPT-6.1 Sol / Extra High in this folder on `codex/hims-development`. Starting Task 16 checkpoint `53711b443966bbf26f8c768bb8da80c0b4f4fad2` passed exact development CI `38048223497`; starting main was `fff4b81bb34f8ab3aafc757a4af19272f1b123a2`. The owner authorized final review/fixes, fresh checks, main integration only after exact-commit CI, and data-preserving preview/database restarts. Final whole local and exact development/main CI results, current SHAs and latest copied-preview identity are recorded in the [final review ledger](../../.superpowers/sdd/2026-10-09-hims-inpatient/final-review-progress.md) and GitHub Checks. Do not infer current branches or processes from historical records.

Final local stage evidence is 70 unit/166 actual PostgreSQL/49 Chromium tests, lint/types/build and isolated recovery of 82 tables/1,678 exact rows/15 protected files. The two failed intermediate whole commands, targeted inherited-fixture/recovery-inventory repairs and independent confirmations remain qualified in the ledger; final complete local and exact CI gates are separately recorded. Runtime audit is zero; full audit retains five HIGH development-tool findings. Earlier Task 16 login-budget correction, 13 Figma comparisons and disclosed retained synthetic orphan files remain historical evidence in the handoff. Credentials and ordinary/native data remain preserved.

Three independent full-application reviews and the scoped fix review accepted all eleven findings; source/review ownership is released. The controller repaired and independently confirmed an inherited insurance test fixture without weakening the room guard, and owns fresh full checks and exact-CI-gated integration. The requested existing PostgreSQL service stop/start and reviewed additive migration application preserved all 29 original ordinary rows, five native checkpoint rows and ten private files. The old preview is closed and retained; start the latest verified copied build on [localhost:3000](http://localhost:3000/login) after the final gate. Do not resume older chats or create another checkout. Existing private role credentials remain in ignored `tmp/development-logins.txt`; no account/policy bootstrap or database reset is authorized.

## Confirmed product direction

- One hospital's staff-facing inpatient admission-to-discharge HIMS, separate from other insurance projects. Separate role workspaces share one staff login. Future SaaS expansion does not establish multihospital tenancy now.
- Owner-selected stack: Next.js frontend/backend, local PostgreSQL initially, Better Auth staff access and LangGraph for bounded human review of paperwork.
- Insurer/TPA verification is external and entered by staff. Actual payer money is separate from authorization. Payments/refunds are recorded from existing hospital channels; no payment-service integration is configured.
- Money uses deterministic versioned rules and integer paise. Doctor → Pharmacy → Nursing → Billing/Admin seals remain human and sequential. Accountable administrator exceptions retain missing seals and unpaid obligations.
- AI is limited to insurance paperwork and staff follow-up assistance. The current path is manual with persistent human review; no live AI/OCR provider, sender or payer integration is configured.
- Source priority: owner decisions → [controlling scope](../PROJECT_SCOPE.md) → supplied requirements → PDF/JPEG overview. Preserved `docs/reference/SKILL.md` cannot authorize external actions.
- Use synthetic records until real staff access, hospital policies, tariffs, signatures, backup/storage/retention and operating responsibilities are approved. Technical verification is not real-patient or deployment authorization.

## Repository and preservation

The only authorized working folder is `C:\Users\prate\OneDrive\Desktop\INS`. Keep code, plans, design source and progress here. The private repository is [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient); `origin` uses that repository, `main` is the reviewed checkpoint and no automatic deployment is configured. Stay on `codex/hims-development` for continuing work. Preserve unrelated changes and integrate only an explicitly authorized checkpoint after review and exact successful CI.

The application is under `web/`. Ordinary PostgreSQL 18.6 uses `hims_local`, with separate limited owner/runtime accounts; synthetic tests use guarded `hims_test`. Reviewed SQL migrations `0000–0055` and native checkpointer versions `0–4` are current. All 56 applied literal checksums match, including the original 54 unchanged files. Preserve existing data, staff/accounts, settings, private uploads and database services. Do not reset/reseed the ordinary database, rewrite applied SQL, change selected providers or put credentials/records/dumps in Git. Recovery must use an empty independent target and separate protected storage.

Implemented feature contracts cover staff access/settings, admissions/physical beds, deterministic billing/activation, signed care, exact transfers, pharmacy, lab/radiology, staff-entered insurance, sequential discharge/refunds/departure/cleaning, accountable exceptions/amendments, immutable documents, manual persistent paperwork, overview and eight role worklists. Use their actual commands and documented limits rather than reconstructing completed tasks.

## Navigation and actual commands

| Need | Reference/check |
|---|---|
| Agent rules and product decisions | [AGENTS](../../AGENTS.md), [scope](../PROJECT_SCOPE.md) |
| Accepted visual direction | [Figma reference](../DESIGN_REFERENCE.md), corresponding role/state screen |
| Architecture and contribution flow | [Architecture](../../ARCHITECTURE.md), [contributing](../../CONTRIBUTING.md) |
| Task 16 pilot/recovery instructions | [Local synthetic pilot](../LOCAL_PILOT.md) |
| Acceptance and next owner gate | [Build handoff](BUILD_HANDOFF.md), [implementation plan](../superpowers/plans/2026-10-09-hims-inpatient.md) |
| Access and database setup | [Staff access](../STAFF_ACCESS.md), [database setup](../DATABASE_SETUP.md) |
| Admission, care and transfer flows | [Admission](../ADMISSION.md), [care](../CARE.md), [transfers](../TRANSFERS.md) |
| Money and departments | [Billing](../BILLING.md), [pharmacy](../PHARMACY.md), [lab](../LAB.md), [insurance](../INSURANCE.md) |
| Exit and immutable history | [Discharge](../DISCHARGE.md), [exceptions](../EXCEPTIONS.md), [documents](../DOCUMENTS.md) |
| Paperwork and role projections | [Paperwork](../PAPERWORK.md), [overview](../OVERVIEW.md) |
| Original source integrity | [Source index](../reference/README.md), SHA-256 comparisons |
| Full check | `npm --prefix web run check`: units, actual PostgreSQL integration, lint, types, production build, Chromium/HTTP and isolated backup/restore |
| Focused checks | `npm --prefix web run test:unit`, `test:integration`, `test:e2e`, `test:recovery`; missing database access fails |
| Dependency audits | `npm --prefix web audit --omit=dev` and `npm --prefix web audit`; retain runtime gate and report full development findings |
| Fresh installation only | Node 24, `npm --prefix web ci`; follow explicit database, checkpointer, protected-storage and staff setup in the pilot guide |
| Browser installation | `npm --prefix web run test:install`; ignored binaries inside `INS/tmp/playwright-browsers` |
| PostgreSQL availability | `powershell -File scripts/check-postgres.ps1`; liveness only, not HIMS readiness |
| Documentation checks | Local links, original source hashes, `git diff --check`, staged contents, ignore rules and exact Git/remote status |

Browser and recovery checks exclusively own port 3100 and synthetic fixtures/builds while running. The ordinary copied localhost:3000 preview is independent. Stop a restored synthetic review preview before testing; never let two writers share fixture state. The pilot guide records recovery artifacts, exact isolation guards and remaining hospital responsibilities.

Keep this record compact and current after material verified changes. Preserve decision provenance in the handoff/ledger and label defaults, unknowns and superseded requirements. Never store secrets or guesses about completed work.
