# HIMS build handoff

Prepared 9 October 2026 at the owner's request to finish the active work, save progress, pause this build chat and continue in a new chat using **GPT-6.1 Sol / High**. Only one build chat may edit this folder at a time.

**Latest build acceptance:** Task 5 billing is independently reviewed and locally accepted after its required finalization correction, browser-session isolation and exact native-datetime regression. Controller's complete check exited 0:31 unit,10 actual PostgreSQL,lint/types/build,11 Chromium/HTTP tests; runtime audit0. Migrations0000–0008 are current. Full eight staff/account hashes remain identical and settings/domain records remain empty. [Billing](../BILLING.md) and [setup evidence](../SETUP_STATUS.md) record capabilities and limits. Checkpoint push/CI integration follows this acceptance; Task6 starts after verified development CI. No ordinary fixtures, financial policy or refunds were invented. Working checkout stays on development.

**Successor update, 9 October:** The successor is active in the same folder. Task 4 is accepted at `79071fb` on development/main: independent review corrections passed scoped re-review, full checks (26 unit, five actual PostgreSQL, lint/types/build and eight Chromium/HTTP tests), zero runtime audit, [development CI](https://github.com/Prateek771/hims-inpatient/actions/runs/37854866059) and [main CI](https://github.com/Prateek771/hims-inpatient/actions/runs/37855201898). All ongoing admissions remain reachable; only recent closed history is bounded to 50. Supplied phone values require digits. The explicit migration CLI was run after review; migrations `0000–0005` are current, with staff/account/settings hashes unchanged and ordinary domain records empty. Task 5 billing is now in progress with a sole source/schema/test implementer; the controller owns documentation, Git and preview processes. No later task has started. The preceding saved development commit `55e002f` passed [GitHub Checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37853242220).

During the review, a temporary esbuild probe importing the migration helper unintentionally triggered its bundled main-module guard and applied ordinary migrations `0003–0005` before acceptance. This violated the intended review order. The controller compared complete staff/account/settings row hashes with the pre-review baseline: eight staff users and eight account records were identical; settings remained empty. Ordinary patient, admission, bed, hold and stay counts were all zero. Applied migrations were preserved without rollback. The fix separates the explicit migration CLI from side-effect-free importable helpers and adds a safe import/bundle regression. Do not rerun the original temporary probe unchanged. Detailed evidence is in the ignored plan workspace's `task-4-review.md` and `progress.md`.

## Workspace and authority

- Use only `C:\Users\prate\OneDrive\Desktop\INS`, branch `codex/hims-development`. No extra checkout or worktree. Private repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient).
- Read root and `web/AGENTS.md`, [project context](project-context.md), [scope](../PROJECT_SCOPE.md), [build plan](../superpowers/plans/2026-10-09-hims-inpatient.md) and [Figma reference](../DESIGN_REFERENCE.md) before continuing. Owner instructions override reference documents.
- One hospital first; separate role dashboards; future SaaS expansion without claiming multihospital tenancy now. Better Auth is selected. External insurer/TPA/staff verification stays external; payment integration is deferred. AI only assists paperwork/follow-ups, with human approval.
- Owner authorized phase-by-phase implementation with subagents, verified development pushes and reviewed checkpoints into main. Ask only for essential missing owner input. Preserve all existing data, accounts, settings and applied migration bytes.

## Verified checkpoint

- Tasks 1–3 accepted: shell, PostgreSQL/audit, Better Auth staff access and versioned administrator settings.
- Staff-access commit: `332a64acd4db06322f4a416ec47607249da89c64`, pushed to development and fast-forwarded into main.
- [Development checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37850090752) and [main checks](https://github.com/Prateek771/hims-inpatient/actions/runs/37850428596) passed at that exact commit, including real fresh-database staff initialization.
- Local verification: 20 unit tests, 4 real PostgreSQL integration checks after review corrections, lint/types/build and 6 browser/HTTP checks. Production audit zero; full audit retains five high development-tool findings in the lint/braces chain. See [setup status](../SETUP_STATUS.md).

## Original admission implementation handoff (superseded by successor update above)

Task 4 admission and physical beds is implemented and tested at `774a5ac6493532e8e7029515c34cccdda21e8315`, but independent review and ordinary application migration remain unfinished. Do not mark Task 4 complete or begin Task 5 until those acceptance steps are resolved.

- Implementer `/root/admission_beds` finished self-review and stopped editing. No later task has started.
- Current work includes permanent patient identity, unique admission episodes, pending bed reservations/cancellation, administrator physical beds, role-safe persisted admission access and Figma admission UI.
- Known DOB or reported age is supported; unavailable phone must not require fabricated contact details. Pending reservations do not activate admissions or start room charging.
- New migrations are additive because earlier versions were applied in the isolated synthetic database. Ordinary application migrations are applied only after review; check final transition record before assuming current app schema.
- Final `npm --prefix web run check` exited 0: 24 unit tests, 5 PostgreSQL integration checks, lint/typecheck/production build and 8 Chromium/HTTP tests. Runtime audit zero. Staged whitespace validation passed. The report documents test-first evidence, limits and observed cache recovery; independent review is still required.

## Local data and processes

- Existing PostgreSQL 18 service is preserved. Dedicated `hims_local` and `hims_test` databases have separate limited owner/runtime accounts. Never reset ordinary application data or PostgreSQL authentication.
- Eight owner-authorized local accounts already exist: lowercase role names at `hims.test` for admin, admission, doctor, nurse, pharmacy, lab, insurance and billing. Preserve them; never rerun bootstrap to overwrite accounts.
- Generated credentials are in ignored `web/.env.local`; local login handoff is ignored `tmp/development-logins.txt`. Do not print secrets into tools, messages or Git. PostgreSQL administrator password was never saved.
- No real hospital financial policy or ordinary patient fixtures were seeded. Tests use only the guarded synthetic database. Missing actual policies are not zero rates or waived deposits.
- Preview session `95232` was stopped to recover a repeated Next.js CSS-worker build error. Only verified generated `web/.next` was cleared; unchanged build subsequently passed. Preview restart, if any, is recorded below. Do not kill unrelated processes or clear source/data.

## Resume locators and commands

- Plan workspace: `.superpowers/sdd/2026-10-09-hims-inpatient/` (ignored). Read `progress.md`; completed tasks must not be redispatched. Read task brief/context/report/review for the first unfinished task.
- `task-4-context.md` contains admission invariants. `task-5-brief.md` and `task-5-context.md` prepare the next billing phase and its transaction/authorization/money boundaries.
- Task 5 owns deterministic charges, deposits/receipts, admission activation, room worker and versioned non-room billable-item prices in administrator settings. Existing fixed category/route deposit slabs satisfy initial scope; do not invent a formula or real rate. Allocations never add cash; refunds stay blocked until real Gate 4 conditions exist in Task 11.
- `npm --prefix web run check` executes unit/integration, lint/typecheck/build and browser tests. `npm --prefix web audit --omit=dev` checks runtime dependencies. `npm --prefix web run db:migrate` uses the dedicated migration owner.
- Browser tests own port 3100 and their synthetic fixtures. Local preview uses `npm --prefix web run dev -- --hostname 127.0.0.1 --port 3000`. See [contributing](../../CONTRIBUTING.md) for the observed Windows cache recovery.
- Relevant installed skills: personal-project-workflow; Superpowers subagent-driven-development/review; PostgreSQL guidance before schema writes; Figma design-to-code before design-context calls. Keep one implementer owning shared migrations/schema/contracts at a time; controller serializes integration.
- Graphify is optional navigation, not installed automatic project memory. Project decisions live in the referenced repository documents. No AI/OCR provider is selected for this HIMS project; do not import another project's credentials or provider decisions.

## Original source-chat transition record (historical)

- Admission code checkpoint: `774a5ac6493532e8e7029515c34cccdda21e8315`; review base: `332a64acd4db06322f4a416ec47607249da89c64`. A separate documentation handoff commit follows it. Both are saved on development; inspect current Git status and remote checks before integrating.
- `main` remains at the accepted Task 3 checkpoint `332a64a`; do not integrate the admission checkpoint merely because local checks passed. Independent Task 4 review is the **first unfinished task**.
- Read `.superpowers/sdd/2026-10-09-hims-inpatient/task-4-report.md`, Task 4 brief/context and the prepared review package. Desktop/narrow PNGs are in the same plan workspace. Review source and tests; do not repeat completed implementation or broad checks without a reason.
- Migrations `0003_tearful_mercury.sql`, `0004_brown_mystique.sql` and `0005_lazy_iceman.sql` were initially applied only to synthetic fixtures. The successor review incident above subsequently applied them to the ordinary app prematurely; the current ledger contains `0000–0005`. Verify checksums and preserve these applied bytes. Do not treat the early application as Task 4 acceptance. No patient/policy seed is authorized for the ordinary app.
- Preview remains **stopped**; prior session 95232 is finished. Restart after review/app migration as appropriate. No active build worker should be inherited from this chat.
- After Task 4 acceptance, update scope/status/context/checklist evidence, verify development CI and integrate the authorized checkpoint into main while leaving this checkout on development. Then proceed to Task 5 using its saved brief/context.
- The source chat stops editing before successor creation. Successor is the sole active build chat. Keep this restriction when delegating and do not message the paused source chat to restart work.
- General project status documents describe the last accepted Task 3 release; update them when Task 4 is accepted. This handoff and the ledger explicitly record the newer tested but unreviewed implementation.
