# HIMS architecture

One Next.js application serves the staff interface and backend. PostgreSQL stores hospital records locally; LangGraph will manage only insurance-paperwork drafts and human review. The owner-selected stack and boundaries are in [project scope](docs/PROJECT_SCOPE.md).

## Repository map

| Path | Purpose |
|---|---|
| `.github/` | Automated checks, dependency-update proposals and PR checklist |
| `docs/` | Scope, approved Figma references, build plan, tooling and verified project context |
| `scripts/check-postgres.ps1` | Read-only local PostgreSQL availability check |
| `web/src/app/` | Next.js layouts/pages and HTTP handlers; currently the starter shell and `/api/health` |
| `web/src/components/` | Reused interface elements; currently the approved visual shell |
| `web/tests/e2e/` | Browser and HTTP checks against a real local Next.js server |
| `web/scripts/` | Browser command wrapper keeping binaries inside this project |
| `web/package-lock.json` | Locked application/tool dependencies for repeatable installation |
| `tmp/` | Ignored npm cache, browser binaries and temporary verification output |

## Boundaries to preserve during implementation

Server Components will read authorized records. Thin Server Actions and the few required Route Handlers will call feature-owned server commands. Role, active-account and state checks belong on the server. Shared money/state logic is deterministic and transactional; money is integer paise, and ledger corrections retain history.

Task 2 will create a bounded PostgreSQL pool, reviewed migrations and separate runtime, migration and synthetic-test database configuration. Later feature modules live under `web/src/server/`; migrations under `web/drizzle/`. These directories are created with their implementations, not as empty placeholders. Installed database packages do not mean a HIMS database or schema exists.

LangGraph and its PostgreSQL saver are installed. They will be configured in the paperwork task after staff access, document handling and provider decisions exist. AI cannot authorize clinical treatment, coverage, money or discharge seals. External insurers/TPAs and staff remain responsible for verification; payment-service integration is deferred.

The current shell has no staff authentication, patient records or hospital transactions. `/api/health` reports application liveness only; it does not assert database readiness. Use synthetic data until the later pilot safeguards are complete. Follow the [implementation plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md) for the remaining modules.
