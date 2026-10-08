# HIMS — Inpatient Care Workspace

A staff-facing Hospital Information Management System for one hospital, connecting admission, clinical work, live charges, insurance paperwork, human discharge clearances and final discharge documents.

The owner approved the clean, minimal Figma direction on **9 October 2026**. The repository contains a runnable Next.js shell, a PostgreSQL audit/settings foundation and automated checks. Staff access and hospital transactions are the next build phases.

Private GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient). Work only in `C:\Users\prate\OneDrive\Desktop\INS`, on `codex/hims-development`. Verified, reviewed and authorized checkpoints are integrated into `main`; no separate checkout is used.

## Project references

- [Confirmed scope and owner decisions](docs/PROJECT_SCOPE.md)
- [Proposed implementation plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md)
- [Tooling and installed agent skills](docs/TOOLING.md)
- [Architecture and repository structure](ARCHITECTURE.md)
- [Development and GitHub workflow](CONTRIBUTING.md)
- [Verified setup status and limitations](docs/SETUP_STATUS.md)
- [Local database setup and test isolation](docs/DATABASE_SETUP.md)
- [Approved Figma screens and prototype](docs/DESIGN_REFERENCE.md)
- [Preserved Figma prototype source files](docs/design/prototype/README.md)
- [Agent working instructions](AGENTS.md)
- [Current project context](docs/agent/project-context.md)
- [Original supplied documents and image](docs/reference/README.md)

## Selected tools

Next.js for frontend and backend; local PostgreSQL initially; Better Auth for staff login; LangGraph for human-in-the-loop workflows. Insurer verification remains external, payment-service integration is deferred, and staff record external decisions and receipts.

Use Node 24. From this project folder:

```powershell
npm --prefix web ci
npm --prefix web run test:install
npm --prefix web run dev
```

Open `http://localhost:3000`. The shell runs without database credentials; database readiness and complete checks require [local database setup](docs/DATABASE_SETUP.md) and `npm --prefix web run db:migrate`. Run `npm --prefix web run check` for unit/PostgreSQL tests, lint, type checks, production build and browser/HTTP tests. GitHub uses fresh synthetic databases for the same checks plus a production dependency audit. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [build plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md) for remaining work.
