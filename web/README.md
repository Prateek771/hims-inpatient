# HIMS application

Next.js frontend/backend for the hospital staff workspace. Product requirements and authorization remain in the root [AGENTS.md](../AGENTS.md) and [scope](../docs/PROJECT_SCOPE.md).

From the repository root, run `npm --prefix web run dev`. Use `npm --prefix web run check` for unit/PostgreSQL tests, lint, type checks, build and Chromium/HTTP checks. `test:e2e` starts the built production app on `127.0.0.1:3100`; build first if running that script separately. Install browser binaries with `npm --prefix web run test:install`; they stay under `INS/tmp/`.

The interface follows approved Figma foundations. PostgreSQL audit history, separate owner/runtime accounts, Better Auth staff authentication, administrator settings and guarded synthetic fixtures exist. See [staff access](../docs/STAFF_ACCESS.md) for local login setup. Hospital workflow modules remain pending. `/api/health` reports liveness; `/api/health/ready` checks foundational database access. LangGraph packages are installed for the later paperwork task; model/OCR providers remain unselected.

Dependencies are locked in `package-lock.json`; [setup status](../docs/SETUP_STATUS.md) records actual checks and upstream development-tool audit findings. Follow [database setup](../docs/DATABASE_SETUP.md) before integration checks. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
