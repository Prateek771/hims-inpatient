# Local UI revision — 18 October 2026

Owner approved local UI improvements from the [transcript plan](../superpowers/plans/2026-10-18-transcript-workflow-revision.md). All migrations, database mutations, Vercel work and the two earlier walkthrough bug fixes remain on hold. Work stays in the existing development checkout; preserve unrelated changes and all existing records/accounts.

## Scope and execution decisions

- Implement current-data Admin navigation, Nurse movement entry points, readable stay timeline and searchable configured choices in the touched forms.
- Keep Doctor required, current identity/urgent authority, intake persistence and mutation contracts unchanged. New reason, optional Doctor and structured ward/room storage remain deferred.
- Ruling: use a small filter plus native select for long configured lists. This preserves native keyboard/form behaviour without introducing a combobox library or accepting arbitrary destinations.
- Ruling: use pure/SSR tests and a database-free browser harness. Integration/e2e wrapper/recovery/full-check commands are deferred because they prepare/migrate synthetic schemas.
- Ruling: ordinary database preservation checks use explicit read-only transactions and store hashes only in ignored evidence. No sign-in sessions or patient actions are needed for UI verification.
- GPT-6.1 Sol workers own the navigation and timeline slices; controller owns the shared choice control, integration and final checks. No concurrent shared-file or build ownership.

## Results

Completed the approved existing-data presentation slice:

- Admin opens on all current MVP patients; action/history/search filters remain available. Other roles retain their existing default and server-scoped visibility. Queue rows show existing bed labels; redundant header navigation is removed.
- Active Nurse patient pages offer Shift patient and Start discharge, opening existing tabs while retaining drafts. These shortcuts do not execute a move or exit.
- Bed transfer shows ordered stays, readable configured labels/categories, exact hospital-local boundaries and existing transfer recorder/handover details. Repeated visits to the same bed remain separate. Labels reflect current configuration; historical location snapshots remain deferred.
- Admission and transfer Doctor/bed lists support text filtering and native keyboard selection. Only configured IDs submit; searching retains the selected choice. Doctor remains required.

Verification completed:

- `npm --prefix web run test:unit`: **106/106 passed**. Initial sandbox timeout/Windows symlink failures passed on a privileged rerun without weakening assertions or timeouts. Final timeline test formatting was subsequently checked with a focused **4/4 pass**.
- `npm --prefix web run lint`, `npm --prefix web run typecheck`, `npm --prefix web run build`: **passed**. Preserved the failed Turbopack build cache; a fresh build with project-local temporary storage passed. No dependency changes.
- Read-only PostgreSQL verification exercised the new SELECT projections over seven episodes/six stays. This is query compatibility evidence, not a full authenticated patient-flow test.
- Database-free Chromium checks used actual changed components and production CSS at 1440px/390px: keyboard selection, configured IDs, retained selection/drafts, required validation, no horizontal page overflow and no submissions/page errors. All six screenshots visually inspected. These are synthetic component fixtures, not screenshots of authenticated ordinary records.
- Independent GPT-6.1 Sol review found no important issues. Scoped design detector returned no findings; `git diff --check` passed.
- Exact read-only before/after hashes matched **96 tables / 560 rows / 134 protected files**, including accounts, credentials, private files and applied migration sources. No login sessions or patient actions were added.

Updated ordinary preview: [localhost login](http://localhost:3000/login), copied build `tmp/local-preview-task20-1173d4f`, BUILD_ID `0ZIZx3CqATOqCBzI-wzzR`. Source fingerprint `1173d4f2650e9e26c1fc0e65be16880bcbcdd308caa39ac24ac0216bb90fdd7f`; working source is uncommitted on checkpoint `0b99b436374a85c41f7530a7d4de02b6e150e301`. Previous copied preview retained. Next.js reported Ready; login and `/api/health/ready` both returned 200.

Evidence folder: ignored `tmp/ui-revision-2026-10-18/`, including preservation hashes, query/browser verification and preview identity. No commit, push, main integration or deployment performed. Full integration/e2e/recovery checks and full patient journey remain deferred with schema/fixture setup; no whole-MVP acceptance claim for this partial phase.

Still on hold: admission reason, optional initial Doctor/later assignment, new ward/room/bed storage, all migrations, Vercel and the two earlier walkthrough bugs. Existing PDFs describe the earlier UI and have not been regenerated for this partial phase.
