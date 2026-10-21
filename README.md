# HIMS — Inpatient Care Workspace

To try a fictional hospital on another computer, follow the [clone-and-run demo guide](docs/CLONE_DEMO.md). It recreates safe sample data with fresh local logins; no working database dump or credentials are published.

The current MVP has six routine dashboards: Admission, Admin, Nurse, Billing, Pharmacy and Insurance. The [dashboard review](docs/agent/DASHBOARD_SECTION_REVIEW.md) explains each section; the [illustrated patient journey](output/pdf/sameer-admission-to-discharge-visual-guide.pdf) follows one fictional patient through the portal. A fresh clone uses the same UI with its own four starter patients; the owner's evolving local training records are not copied.

A staff-facing Hospital Information Management System for one hospital, connecting admission, clinical work, live charges, insurance paperwork, human discharge clearances and final discharge documents.

Tasks 1–16 and all eleven final runtime review findings are independently accepted: staff access/settings, patient identity/admissions/beds, deterministic billing and manual receipts, signed care/transfers, pharmacy, lab/radiology, staff-entered insurance and protected files, sequential human clearances, exceptions/amendments, immutable discharge documents, persistent manual paperwork review, and all eight role worklists with an administrator overview. Task 16 adds genuine whole-flow checks, isolated database/storage recovery and [synthetic pilot instructions](docs/LOCAL_PILOT.md). The owner authorized final fixes, fresh verification, data-preserving preview/database restarts and main integration only after exact successful development CI. Final whole-check, development/main CI, source and restarted-preview identities are saved in the [build handoff and local ledger](docs/agent/BUILD_HANDOFF.md). The approved hospital design remains the visual reference.

Use synthetic data. Real staff, financial policy, hosting/access, backup ownership, retention and operational sign-off remain unresolved. Live AI/OCR providers, insurer/payment integrations and autonomous sending are unconfigured. This version serves one hospital; multihospital tenancy and production readiness are not claimed.

GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient). Work only in `C:\Users\prate\OneDrive\Desktop\INS`, on `codex/hims-development`. Verified, reviewed and authorized checkpoints are integrated into `main`; no separate checkout is used.

## Project references

- [Confirmed scope and owner decisions](docs/PROJECT_SCOPE.md)
- [Proposed implementation plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md)
- [Tooling and installed agent skills](docs/TOOLING.md)
- [Architecture and repository structure](ARCHITECTURE.md)
- [Development and GitHub workflow](CONTRIBUTING.md)
- [Verified setup status and limitations](docs/SETUP_STATUS.md)
- [Local database setup and test isolation](docs/DATABASE_SETUP.md)
- [Local synthetic pilot, complete checks and isolated recovery](docs/LOCAL_PILOT.md)
- [Staff login and local development accounts](docs/STAFF_ACCESS.md)
- [Patient intake and physical beds](docs/ADMISSION.md)
- [Clinical and nursing care](docs/CARE.md), [transfers](docs/TRANSFERS.md), [pharmacy](docs/PHARMACY.md) and [lab/radiology](docs/LAB.md)
- [Billing](docs/BILLING.md), [insurance](docs/INSURANCE.md), [discharge](docs/DISCHARGE.md) and [exceptions](docs/EXCEPTIONS.md)
- [Immutable discharge documents](docs/DOCUMENTS.md), [manual paperwork review](docs/PAPERWORK.md) and [overview/worklists](docs/OVERVIEW.md)
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

Open `http://localhost:3000/login` after explicit setup in the [pilot guide](docs/LOCAL_PILOT.md). Staff pages require the configured database, auth origin/secret and protected storage; liveness and compilation remain independent of database access. Run `npm --prefix web run check` for units, actual PostgreSQL integration, lint, types, a production build, Chromium/HTTP and independent backup/restore. GitHub uses fresh synthetic services for the same commands plus the required runtime dependency audit. Preserve an existing installation and copied preview; setup instructions do not authorize resetting accounts or records. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [build handoff](docs/agent/BUILD_HANDOFF.md) for the next owner gate.
