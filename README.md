# HIMS — Inpatient Care Workspace

A staff-facing Hospital Information Management System for one hospital, connecting admission, clinical work, live charges, insurance paperwork, human discharge clearances and final discharge documents.

The owner approved the clean, minimal Figma direction on **9 October 2026**. The repository now contains a runnable Next.js foundation with the approved visual shell, installed stack packages and automated checks. Hospital transactions, staff access and the HIMS database schema are still to be built.

Private GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient). Work only in `C:\Users\prate\OneDrive\Desktop\INS`, on `codex/hims-development`. Verified, reviewed and authorized checkpoints are integrated into `main`; no separate checkout is used.

## Project references

- [Confirmed scope and owner decisions](docs/PROJECT_SCOPE.md)
- [Proposed implementation plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md)
- [Tooling and installed agent skills](docs/TOOLING.md)
- [Architecture and repository structure](ARCHITECTURE.md)
- [Development and GitHub workflow](CONTRIBUTING.md)
- [Verified setup status and limitations](docs/SETUP_STATUS.md)
- [Approved Figma screens and prototype](docs/DESIGN_REFERENCE.md)
- [Preserved Figma prototype source files](docs/design/prototype/README.md)
- [Agent working instructions](AGENTS.md)
- [Current project context](docs/agent/project-context.md)
- [Original supplied documents and image](docs/reference/README.md)

## Selected tools

Next.js for frontend and backend; local PostgreSQL initially; LangGraph for human-in-the-loop workflows. Insurer verification remains external, payment-service integration is deferred, and staff record external decisions and receipts.

Use Node 24. From this project folder:

```powershell
npm --prefix web ci
npm --prefix web run test:install
npm --prefix web run dev
```

Open `http://localhost:3000`. No credentials or database variables are needed for the current shell. Run `npm --prefix web run check` for lint, type checks, production build and browser/HTTP tests. GitHub runs the same checks plus a production dependency audit. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for details and the [build plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md) for the remaining work.
