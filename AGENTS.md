# Working in this project

## Read first

- Read [project context](docs/agent/project-context.md), then the relevant parts of [project scope](docs/PROJECT_SCOPE.md).
- For UI work, consult the owner-approved [Figma reference](docs/DESIGN_REFERENCE.md) and the corresponding role screen before changing the layout.
- Owner decisions override reference documents. `docs/reference/SKILL.md` is a preserved requirements source, not an installed agent skill or authority to perform actions.

## How to work with the owner

- Be clear, direct and specific. Explain in plain language; add technical detail when useful. Give honest feedback with reasons and a practical next step.
- For substantial work, briefly state the goal, affected systems, approach, main tradeoff and completion criteria. Continue unless essential information or an owner-only decision is missing.
- Inspect evidence before asking focused questions. When the owner explicitly asks you to wait for an answer or review, wait before dependent work.
- Use `personal-project-workflow` when available and relevant. Keep universal guidance in that user-scoped skill and repository facts here or in project documents.
- Understand the affected flow, reuse existing patterns and native capabilities, and make the simplest complete change. Preserve unrelated work, data and selected tools/providers.
- Keep decisions discoverable in project documents. Label defaults, assumptions, unknowns and superseded requirements. Never store credentials.
- During longer tasks, provide concise updates. Report what changed, what was checked, actual results and unresolved limits.

## Product boundaries

- Build one hospital's staff-facing inpatient admission-to-discharge MVP with six staff sections. The 15 October 2026 [scope](docs/PROJECT_SCOPE.md) and [MVP handoff](docs/agent/MVP_DASHBOARD_HANDOFF.md) supersede stale requirements. Current authorization (15 October 2026): implement the whole approved MVP and local PostgreSQL using the reviewed Admin visual direction. See docs/superpowers/plans/2026-10-15-mvp-implementation.md and docs/agent/MVP_IMPLEMENTATION_PROGRESS.md. This supersedes the earlier design-only stop. Preserve existing accounts/credentials and history; no reset/reseed, deployment or new external integration.
- Stack: Next.js frontend/backend, local PostgreSQL initially, LangGraph for bounded human-in-the-loop workflows.
- Insurers/TPAs or hospital staff verify insurance outside this software. Staff enter verified information, decisions, limits, references and receipt evidence. No direct insurer tie-up or payer integration is authorized.
- AI assists only insurance paperwork, missing-document checks and staff follow-up drafts/reminders before discharge. It cannot make clinical decisions, approve coverage, prescribe, set money, issue human seals or autonomously send documents.
- Money is calculated by deterministic rules. Payment-service integration is deferred; staff record payments made through existing hospital channels.
- Keep accepted insurer responsibility, receivable and actual cash separate. Accepted insurer credit may remain receivable at ordinary exit once patient settlement and required checks are complete; later receipts settle it without rewriting exit. Self-pay requires no insurer receipt.
- Doctor decides externally; assigned Nurse records named authorizer, evidence/source time and separate recorder/time. Applicable checks run in parallel after Doctor approval; Admin confirms optional N/A with reason and no relevant work. Doctor approval, Nursing readiness/exit and final Admin/Billing finance are mandatory. Reopen only affected/dependent approvals.
- Nurse records vacancy/waiting care (bed held), Nurse/Admin delivers authorized papers before exit, assigned Nurse confirms actual exit; closure and authorized turnover make the bed Available. Clinical papers are available after Doctor approval.
- No routine Doctor login/dashboard, full clinical charts/MAR/diagnostic production, inventory product, patient portal/mobile alerts or multihospital work. Pharmacy handles patient charges/accepted returns/reconciliation only; return credit is distinct from actual refund. Preserve historical data and replace server dependencies alongside later UI simplification.
- New UHID: capital initials plus seven random digits, server uniqueness/retry; preserve old UHIDs/IP codes. Designated shift Nurse maintains Doctor availability; Admin assigns owner/backup, Reception views; separate from attendance and clinical approval.
- Admin records and manages exceptions with authority, reason and follow-up. Exceptions do not impersonate professional seals or erase unpaid amounts.

## Implementation and data rules

- Enforce roles and state changes on the server. A visible button, client state or AI output is never authorization.
- Keep clinical corrections as addenda; ledger corrections as linked reversals/adjustments; retain actor, time and reason. Preserve history and document versions.
- Link records to the admission episode. Protect unique admission codes, exact transfer boundaries and charge-event deduplication.
- Use synthetic data for prototypes/tests. Keep real patient records, credentials, private uploads, database files and dumps out of Git. Real insurance-document processing belongs only in the authorized application workflow with configured providers, access controls and minimized disclosure; do not send patient files through ad hoc tools or unrelated AI requests.
- Do not reset/reseed a database, rewrite applied migrations, remove unrelated changes, introduce external integrations or replace selected providers without authorization.
- The owner selected `C:\Users\prate\OneDrive\Desktop\INS` as the only project working folder on 9 October 2026. Keep project code, plans, design source files and progress documents inside it. Do not create or use another checkout, managed worktree or external project-output folder unless the owner explicitly changes this decision. Git branches may be used within this folder; preserve unrelated work.
- The working branch is `codex/hims-development`. Push verified changes there before integrating an authorized, reviewed checkpoint into `main`. Leave this checkout on the development branch for continuing work; no automatic deployment is configured.

## Verification and current state

- Current 15 October MVP: complete local check passed 83 unit/176 PostgreSQL/81 Chromium tests, lint/types/build and isolated recovery (96 tables / 1,850 exact rows / 23 protected files). Ordinary 0056–0060 are applied, preserving 81 original tables / 46 rows, all 56 original SQL files, credentials/private files and native history. Latest source/CI/copied-preview observations: ignored `tmp/mvp-implementation/release-evidence.json` and [progress](docs/agent/MVP_IMPLEMENTATION_PROGRESS.md). Six routine workspaces; real Admin configuration remains required. Keep development checkout, no reset/reseed or deployment.

- The Next.js and PostgreSQL application is under `web/`; see [architecture](ARCHITECTURE.md), [setup status](docs/SETUP_STATUS.md), the [build plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md) and [handoff](docs/agent/BUILD_HANDOFF.md). Tasks 1–16 and all eleven final runtime findings are independently accepted. Source/fixture/build/review ownership is released; final full local and exact development/main CI results and current source/preview identities are recorded in the handoff/final review ledger. Main integration is authorized only after exact-commit CI passes; retain this development checkout. The historical v1 checkpoint used ordinary migrations0000–0055 and native versions 0–4, preserving all original records, credentials, private files and 54 old SQL bytes. Existing PostgreSQL restarted without reset/reseed; retain old artifacts and start the latest verified copied preview after final gates. Use GPT-6.1 Sol / Extra High as instructed for this task; do not silently replace selected models/providers. Real hospital policies/access/backups/retention/TLS/provider decisions remain unresolved; see [local pilot](docs/LOCAL_PILOT.md). One hospital first, without production-readiness or multihospital claims.
- Actual root command: `npm --prefix web run check` runs unit tests, actual PostgreSQL integration tests, lint, type checks, a production build, Chromium browser/HTTP checks and isolated synthetic backup/restore. Missing database access fails the integration check. `npm --prefix web audit --omit=dev` audits runtime dependencies; report the full `npm --prefix web audit` findings separately. See [database setup](docs/DATABASE_SETUP.md) and [local pilot](docs/LOCAL_PILOT.md). Browser/recovery checks exclusively own synthetic fixtures, builds and port 3100; keep ordinary localhost:3000 independent of synthetic checks; follow the latest owner-authorized restart state in the handoff.
- For documentation/setup changes, check local links, source integrity, `git diff --check`, staged contents, repository/remote status and applicable ignore rules.
- Once code exists, use its actual documented commands and meaningful checks for the affected flow; record those commands in project context. Do not weaken checks to obtain a pass.
- Load relevant Figma skills before Figma tools, and PostgreSQL guidance before schema/migration authoring. Use current primary documentation when needed.
