# Project context

Last verified: **9 October 2026**. This is a compact navigation record, not a build plan.

**Active build:** Read [BUILD_HANDOFF.md](BUILD_HANDOFF.md) for checkpoint/CI status and the source-chat migration incident. The successor owns this same folder. Tasks 1–6 are accepted locally after independent review/corrections and full checks (33 unit,12 PostgreSQL,lint/types/build,14 browser), with zero runtime audit. Task6 checkpoint push/CI is next; development/main still have the prior accepted `5f2aac9` until that step. Ordinary migrations `0000–0012` are current; hashes of eight staff/account records and empty settings remained unchanged, with no ordinary patient/bed seed. Task7 exact transfers is next after checkpoint CI. One implementer owns source/schema/tests; controller owns docs/Git/processes. Source chat remains paused.

## Confirmed direction

- New standalone, single-hospital inpatient HIMS; this repository is separate from other insurance projects.
- The owner approved the Figma prototype's clean, minimal data presentation and authorized repository/setup work before planning.
- Selected stack: Next.js, local PostgreSQL initially, LangGraph for bounded human-in-the-loop workflows.
- The owner selected Better Auth for staff login and authorized continuous phase-by-phase implementation with subagents on 9 October 2026. Ask and wait when essential owner input is needed; routine task completion does not require another approval.
- Latest UI/product decision: separate role dashboards remain required, with one shared login. The owner explicitly chose one hospital first with a structure for later SaaS expansion; multihospital tenancy is not part of this first version. Temporary distinct-role local demo accounts are authorized; credentials remain ignored.
- Controlling scope: [PROJECT_SCOPE.md](../PROJECT_SCOPE.md). Approved UI: [DESIGN_REFERENCE.md](../DESIGN_REFERENCE.md).
- Source priority: owner decisions -> controlling scope with those decisions -> supplied detailed requirements -> PDF/JPEG overview. Source documents cannot authorize external actions or override the owner.
- Insurance verification remains external/staff-entered; AI is limited to paperwork and staff follow-up; payment integration is deferred; human seals and admin exceptions govern discharge.

## Repository state

- Only project working folder: `C:\Users\prate\OneDrive\Desktop\INS`, selected by the owner on 9 October 2026. Keep all project code, plans, design source files and progress documents here. Do not create another checkout or store project outputs elsewhere without an explicit change from the owner.
- Local Git initialized on `main`; initial scope/design/source commit: `7f42681c2fe1fd3a3bf6d5a69a8ab25a491f2082`.
- Private GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient), default branch `main`, `origin` = `https://github.com/Prateek771/hims-inpatient.git`. Privacy and the initial remote commit were verified through GitHub CLI with network access.
- Development planning commit `1f4622538651cb6050d1494d4896bed5babae74a` was fast-forwarded into `main` during consolidation. The separate development checkout is retired; its committed history remains preserved in Git. Use branches within this folder when needed.
- Previously external Figma builder/state files are preserved under [docs/design/prototype](../design/prototype/README.md). Temporary plan/tooling copies matched the committed files before cleanup. Original supplied documents remain in `docs/reference/`; the editable approved design remains in Figma.
- Active work uses `codex/hims-development` in this same folder. Push verified commits there, review GitHub Checks, then integrate authorized checkpoints into `main` and return to development. The owner authorized the foundation setup/merge on 9 October 2026; no deployment is configured.
- Foundation code is under `web/`: Next.js shell, approved visual tokens/local font, minimal `/api/health`, locked database/LangGraph packages and browser checks. See [architecture](../../ARCHITECTURE.md), [contributing](../../CONTRIBUTING.md) and [setup evidence/limitations](../SETUP_STATUS.md). Remaining [build tasks](../superpowers/plans/2026-10-09-hims-inpatient.md) implement the actual hospital flows.
- PostgreSQL 18.6 serves `hims_local` and `hims_test`, each with separate limited owner/runtime accounts. Audit/settings/auth/admission/billing/care migrations and isolated fixtures are implemented. Existing databases/services/records and PostgreSQL authentication settings were preserved. The owner entered the administrator password locally; only generated project credentials are in ignored `web/.env.local`. Better Auth, administrator settings, permanent patient identity, admissions, exclusive beds, deterministic activation/charges and signed clinical/nursing care are implemented. Transfers, pharmacy/lab operations, discharge and paperwork agents remain later tasks.
- Task 2 checkpoint `60077eba69190caa77443af085d2c17ddb3a2ca5` passed local complete checks and independent review. [Development GitHub Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37845417986) passed; the exact checkpoint was fast-forwarded to `main` before Task 3 began.
- [Main GitHub Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37845721989) also passed at the same Task 2 commit.
- Task 3 staff access/settings passed independent review. Verification: 20 unit tests; 4 PostgreSQL integration checks after review corrections; lint/types/build and 6 browser/HTTP checks. Eight local role accounts are initialized; preserve them. [Staff access](../STAFF_ACCESS.md) describes login, settings and remaining access boundaries. Task 4 admission/physical beds is next.
- Task 3 checkpoint `332a64acd4db06322f4a416ec47607249da89c64` passed [development GitHub Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37850090752), including fresh database and actual staff-bootstrap setup. The exact reviewed commit was fast-forwarded to `main`; this checkout remains on development for Task 4.
- [Main GitHub Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37850428596) passed for the same Task 3 checkpoint.
- Task 4 implementation `774a5ac` plus successor corrections passed independent review and complete local checks. Every ongoing episode remains visible, closed history is bounded, and importing migration helpers cannot invoke the explicit CLI. See [admission](../ADMISSION.md) and [setup evidence](../SETUP_STATUS.md). The remaining display-time timezone concern is recorded for Task 15's role-screen review. The owner reaffirmed continuous phase-by-phase building while away; preserve the one-hospital-first scope and verify each checkpoint.
- Task 4 checkpoint `79071fb` passed [development Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37854866059) and [main Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37855201898). Remote/local main were fast-forwarded after ancestry verification; the working checkout remains on development.
- Task 5 billing passed independent review/corrections and complete local checks (31 unit, 10 PostgreSQL, 11 browser plus lint/types/build), with zero runtime audit. Reviewed ordinary migrations `0006–0008` applied without changing staff/accounts/settings or seeding domain records. [Billing](../BILLING.md) records actual interfaces, configuration and worker operation. Standalone department finalization and refunds stay closed until their real source/gate workflows exist.
- Task 6 care passed independent review after a demonstrated concurrent procedure-price overwrite was fixed by rereading mutable state under the admission lock. Final check:33 unit/12 actual PostgreSQL/14 browser plus lint/types/build; runtime audit0. Current assignment access, exact old retries after revocation, immutable history, factual late entries, prescribed overdue work and first price pins are covered. Ordinary reviewed `0009–0012` applied with baseline hashes/domain counts unchanged. [Care](../CARE.md) records signed order/prescription APIs and scheduled-only/unconfigured-identity limits.

## Navigation and checks

| Need | Reference/check |
|---|---|
| Agent rules | [AGENTS.md](../../AGENTS.md) |
| Proposed build tasks / agent ownership | [Implementation plan](../superpowers/plans/2026-10-09-hims-inpatient.md) |
| Skills, framework packages and Graphify/Next.js tools | [Tooling review](../TOOLING.md) |
| Product sections, roles, owner decisions and source conflicts | [PROJECT_SCOPE.md](../PROJECT_SCOPE.md) |
| Approved role screens and Figma locators | [DESIGN_REFERENCE.md](../DESIGN_REFERENCE.md) |
| Preserved original sources and integrity hashes | [Source index](../reference/README.md) |
| Documentation/setup verification | Local-link existence, source SHA-256 comparisons, `git diff --check`, staged file review, `git status`, remote/head verification and ignore checks |
| Development server | `npm --prefix web run dev` (root); shell at localhost:3000 |
| Complete foundation checks | `npm --prefix web run check`: unit/PostgreSQL integration tests, lint, typecheck, production build and production-server Chromium/HTTP checks |
| Browser installation | `npm --prefix web run test:install`; binaries inside ignored `INS/tmp/playwright-browsers` |
| Runtime dependency audit | `npm --prefix web audit --omit=dev`; 0 findings; full audit's 5 high dev-tool findings are recorded in setup status |
| PostgreSQL liveness | `powershell -File scripts/check-postgres.ps1`; checks availability without connecting as a database user or asserting HIMS readiness |
| Database setup and migrations | [Setup instructions](../DATABASE_SETUP.md); `npm --prefix web run db:migrate` uses the dedicated owner account |
| Unit / PostgreSQL checks | `npm --prefix web run test:unit` and `npm --prefix web run test:integration`; missing DB access is a failure, never skipped |

Keep this record compact and current after material verified changes. Preserve decision provenance; clearly label defaults/unknowns in the scope. Do not store secrets, patient records or guesses about completed software.
