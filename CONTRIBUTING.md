# Working on HIMS

Work only in `C:\Users\prate\OneDrive\Desktop\INS`. Read [AGENTS.md](AGENTS.md) and [project context](docs/agent/project-context.md) before changing the relevant scope or code. Preserve the owner's decisions and consult the approved Figma screen for UI work.

## Branch and review flow

Use `codex/hims-development` for active work in this same checkout. Start from the latest `main` without discarding local changes. Make focused commits, run the affected checks, and push the development branch. Review the diff and GitHub Checks before integrating it into `main`; switch back to development for the next change. The owner explicitly authorized the initial foundation merge/push. Future merges follow the authorization for the current task; CI passing alone does not grant permission.

GitHub provisions fresh synthetic PostgreSQL services and runs unit/integration tests, lint, type checks, production dependency audit, a production build, browser tests and isolated backup/restore for development/main pushes and PRs targeting main. The single required job uses pinned actions/images and `npm ci`; see [local pilot](docs/LOCAL_PILOT.md). Dependabot proposes updates weekly; it does not merge them automatically. `main` is a reviewed code checkpoint, not an automatic deployment. After Task 16, the later whole-branch review/main integration requires the owner's next approval.

## Local commands

Run from the repository root with Node 24:

```powershell
npm --prefix web ci
npm --prefix web run test:install
npm --prefix web run dev
```

For checks, stop the interactive dev server if it occupies test port 3100, then run:

```powershell
npm --prefix web run check
npm --prefix web audit --omit=dev
npm --prefix web audit
powershell -File scripts/check-postgres.ps1
git diff --check
```

Follow [database setup](docs/DATABASE_SETUP.md) and explicit setup in the [pilot guide](docs/LOCAL_PILOT.md) for a new installation. Preserve existing accounts, applied migrations and records. Unit and real PostgreSQL integration tests execute; missing access fails the check. Playwright owns an isolated local server on port 3100 and shuts it down afterward; recovery then uses that port with an independent restored database/storage. Stop a retained synthetic review preview before these checks. Browser binaries and local test/recovery output are ignored. Never report an empty or skipped suite as passed.

Durable insurance paperwork also needs the explicit migration-owner command `npm --prefix web run paperwork:setup`. No request/import automatically creates its schema. Core hospital readiness stays separate; see [paperwork contracts](docs/PAPERWORK.md).

Follow [staff access](docs/STAFF_ACCESS.md) for one-time local login initialization. Preserve existing accounts; the bootstrap deliberately refuses a database that already contains staff. CI additionally runs the actual demo bootstrap against its fresh synthetic application database.

In this Codex Windows session, sandboxed Next.js builds have repeatedly left a CSS-worker failure cached in `.next`: the child exits with code 0 before connecting. Authorized host execution of the standard build/check is the verified path here; this is not an instruction to change compiler/checks or run a terminal as administrator. If that exact failure recurs, first verify no project preview/test listener is active, stop only this project's known preview process if needed, verify the resolved absolute target is this checkout's plain generated `web/.next` directory, clear only that cache and retry the unchanged build with authorized host execution. Do not remove source, dependencies or database files, and do not treat recovery as proof of the upstream cause. Restart any preview after validation.

Never commit credentials, real patient records, private uploads, database files or dumps. No existing database resets, applied-migration rewrites or provider replacements are authorized by these setup commands.

An accepted preview copied under ignored `INS/tmp/local-preview-taskN-SHA/` uses its own compiled assets and may remain live during source builds or a verified source `.next` cache recovery. Confirm the running process's actual artifact path first; preserve that artifact, its manifest and existing credentials. Stop a preview only when its own files must change or during the short controlled accepted-checkpoint refresh.
