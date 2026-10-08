# Project context

Last verified: **9 October 2026**. This is a compact navigation record, not a build plan.

## Confirmed direction

- New standalone, single-hospital inpatient HIMS; this repository is separate from other insurance projects.
- The owner approved the Figma prototype's clean, minimal data presentation and authorized repository/setup work before planning.
- Selected stack: Next.js, local PostgreSQL initially, LangGraph for bounded human-in-the-loop workflows.
- The owner selected Better Auth for staff login and authorized continuous phase-by-phase implementation with subagents on 9 October 2026. Ask and wait when essential owner input is needed; routine task completion does not require another approval.
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
- PostgreSQL 18.6 serves new `hims_local` and `hims_test` databases, each with separate limited owner/runtime accounts. Audit/settings migrations and isolated fixtures are implemented. Existing databases/services/records and PostgreSQL authentication settings were preserved. The owner entered the administrator password locally; only generated project credentials are in ignored `web/.env.local`. Staff auth, domain modules and paperwork agents are still pending.

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
| Complete foundation checks | `npm --prefix web run check`: unit/PostgreSQL integration tests, lint, typecheck, production build and four production-server Chromium/HTTP checks |
| Browser installation | `npm --prefix web run test:install`; binaries inside ignored `INS/tmp/playwright-browsers` |
| Runtime dependency audit | `npm --prefix web audit --omit=dev`; 0 findings at setup; full audit's 9 dev-tool findings are recorded in setup status |
| PostgreSQL liveness | `powershell -File scripts/check-postgres.ps1`; checks availability without connecting as a database user or asserting HIMS readiness |
| Database setup and migrations | [Setup instructions](../DATABASE_SETUP.md); `npm --prefix web run db:migrate` uses the dedicated owner account |
| Unit / PostgreSQL checks | `npm --prefix web run test:unit` and `npm --prefix web run test:integration`; missing DB access is a failure, never skipped |

Keep this record compact and current after material verified changes. Preserve decision provenance; clearly label defaults/unknowns in the scope. Do not store secrets, patient records or guesses about completed software.
