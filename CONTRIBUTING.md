# Working on HIMS

Work only in `C:\Users\prate\OneDrive\Desktop\INS`. Read [AGENTS.md](AGENTS.md) and [project context](docs/agent/project-context.md) before changing the relevant scope or code. Preserve the owner's decisions and consult the approved Figma screen for UI work.

## Branch and review flow

Use `codex/hims-development` for active work in this same checkout. Start from the latest `main` without discarding local changes. Make focused commits, run the affected checks, and push the development branch. Review the diff and GitHub Checks before integrating it into `main`; switch back to development for the next change. The owner explicitly authorized the initial foundation merge/push. Future merges follow the authorization for the current task; CI passing alone does not grant permission.

GitHub provisions fresh synthetic PostgreSQL databases and runs unit/integration tests, lint, type checks, production dependency audit, a production build and browser tests for development/main pushes and PRs targeting main. Dependabot proposes updates weekly; it does not merge them automatically. `main` is a reviewed code checkpoint, not an automatic deployment.

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
powershell -File scripts/check-postgres.ps1
git diff --check
```

Follow [database setup](docs/DATABASE_SETUP.md) and apply migrations before complete checks. Unit and real PostgreSQL integration tests execute; missing access fails the check. Playwright owns an isolated local server on port 3100 and shuts it down afterward. Browser binaries and local test output are ignored. Never report an empty or skipped suite as passed.

Never commit credentials, real patient records, private uploads, database files or dumps. No existing database resets, applied-migration rewrites or provider replacements are authorized by these setup commands.
