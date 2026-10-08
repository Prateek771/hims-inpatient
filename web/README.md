# HIMS application

Next.js frontend/backend for the hospital staff workspace. Product requirements and authorization remain in the root [AGENTS.md](../AGENTS.md) and [scope](../docs/PROJECT_SCOPE.md).

From the repository root, run `npm --prefix web run dev`. Use `npm --prefix web run check` to lint, type check, build and run Chromium/HTTP checks. `test:e2e` starts the built production app on `127.0.0.1:3100`; build first if running that script separately. Install browser binaries with `npm --prefix web run test:install`; they stay under `INS/tmp/`.

The current page is a setup shell following the approved Figma foundations. The live modules, authentication and database schema are not implemented. `/api/health` reports liveness without secrets or a database-readiness claim. PostgreSQL/Drizzle and LangGraph packages are installed for their later tasks; model/OCR providers remain unselected.

Dependencies are locked in `package-lock.json`; [setup status](../docs/SETUP_STATUS.md) records actual checks and upstream development-tool audit findings. The unit runner is configured, but its test suite is not implemented yet. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
