# Working in the HIMS application

Root [AGENTS.md](../AGENTS.md) and the owner's scope apply here. This application lives inside the single approved `INS` working folder. Use `codex/hims-development`; do not create another checkout.

- From the repository root, use `npm --prefix web run check` for unit/integration tests, lint, type checks, production build and browser checks. `test:e2e` uses the built application on port 3100; run build first. Install browsers with `npm --prefix web run test:install`.
- Follow [architecture](../ARCHITECTURE.md), [current context](../docs/agent/project-context.md) and [approved Figma](../docs/DESIGN_REFERENCE.md). Keep server logic outside client components and read relevant installed framework documentation before using new APIs.
- The application has audit/settings schema, separate database owner/runtime accounts, Better Auth staff access, administrator settings, admissions/bed reservations and deterministic billing/activation. Department sources, insurance responsibility and discharge gates remain later tasks. Preserve existing local staff accounts. `/api/health` asserts liveness, `/api/health/ready` checks database/schema access. Keep real data and credentials out of tests/Git.
- Unit and actual PostgreSQL integration suites must execute. Test fixtures use only the explicitly configured synthetic database and never fall back to the application URL. Do not silently skip unavailable checks or claim them as passed.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
