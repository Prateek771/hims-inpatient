# Cloneable Fictional Hospital Implementation Plan

> **For agentic workers:** Use ProWork and superpowers:subagent-driven-development for the scoped implementation and independent review.

**Goal:** Let a second developer clone GitHub and recreate a fictional hospital with fresh local logins, independently of the owner's PC.

**Architecture:** Reuse existing PostgreSQL setup, migrations, Better Auth bootstrap and domain commands. Publish a guarded demo seed, not a dump of the owner's database. Generate installation-specific credentials privately; refuse populated targets.

**Tech Stack:** Existing Node24, Next.js, PostgreSQL18, esbuild, TypeScript and Vitest; no new dependencies.

**Spec:** Owner's 21 October request and explicit selection: fictional hospital and sample patients with fresh local logins. Scope described in chat: clone, local PostgreSQL setup, fictional dataset, fresh local accounts and independent operation.

## Constraints and rulings

- Sole INS folder/development branch; preserve dirty source, ordinary data/accounts/private files and migration bytes. No other checkout, reset, Vercel action or ordinary migration.
- Fresh database schema setup is required only for the recipient and a separate disposable verification cluster. It does not lift the ordinary database migration hold.
- Ruling: regenerate safe fictional data from code instead of exporting current rows, snapshots or protected files. This meets the selected demo option without credential/history leakage.
- Ruling: use existing bootstrap's eight legacy role accounts; only six routine dashboards are part of current MVP. Legacy Doctor/Lab remain historical access.
- Keep the published code scope to clone tooling/docs/workflow, preserving unrelated local UI changes. Verify against committed server code before publication.
- Publish only verified scoped files to codex/hims-development; do not merge main or change repository visibility.

## Tasks

- [x] Add pure target/emptiness guards with tests for wrong host/role/database, missing schema, existing records, and nonprivileged runtime identity.
- [x] Add CLI wrapper and domain-command seed for categories/tariffs/deposits, beds, external Doctors, catalogue and staged fictional patients. Generate private per-installation credentials; refuse replay.
- [x] Document fresh installation and six-role exercises; integrate seed into existing fresh CI setup, test isolated initialization/replay refusal and publication secret checks, review and push scoped commit.

## Verification

Run guard units, complete unit suite, lint/types; run actual seed on a fresh isolated PostgreSQL cluster using existing migrations, then prove replay refusal and unchanged row counts. Check target against the owner's populated database in a read-only preflight only. Verify HTTP staff access on an isolated port; no ordinary data mutations. Scan staged/new Git content for current private credentials/dumps, inspect exact commit and remote/CI. Never claim UI edits or full-cycle changes not part of this package.

## Observed local checks — 21 October 2026

- Red/green: missing guard failed; 14 guard tests then passed. Full unit suite177 passed outside the Windows sandbox; lint and type checks passed. Initial restricted run had existing child-process timeout/symlink-permission failures; checks were rerun with access, not weakened.
- Isolated PostgreSQL18 cluster on55441: existing61 migrations and native checkpointer setup applied only there; seed created8 staff,12 beds,4 admissions. Replay refused with every HIMS table hash and credential file unchanged.
- Populated ordinary database: read-only preflight refusal; staff/admission/bed counts and existing private environment unchanged. No ordinary migration, account update, reset, dump or data export.
- Six fresh generated logins reached real sample-populated dashboards on isolated3102, no browser page errors. Browser checks waited for data after the loading screen and respected the existing sign-in limit. This used the retained reviewed preview; exact published-source CI is the separate final gate.
- Seed bundled against55 committed server-source files without depending on uncommitted local UI helpers. The GitHub package deliberately excludes unrelated local UI/doc work.
- Independent GPT-6.1 Sol review's linked-bundle-output finding fixed using in-memory build plus unique exclusive file creation; re-review found no remaining blocker.
- Private logs, cluster, generated test logins, summary and browser evidence remain ignored. Fresh-install instructions are in docs/CLONE_DEMO.md; GitHub publication/CI outcome is reported in the final task response.
- Published9scoped files in commit8a41f5572909a08e94f695c235e40c2de4523e60 on codex/hims-development. Exact CI run39574772583 passed fresh seed, all unit/PostgreSQL checks, lint/types/runtime audit, build, browser checks and isolated recovery. Main and unrelated working changes remain untouched. This completion annotation is local handoff bookkeeping after the verified publication.
