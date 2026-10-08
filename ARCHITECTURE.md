# HIMS architecture

One Next.js application serves the staff interface and backend. PostgreSQL stores hospital records locally; LangGraph will manage only insurance-paperwork drafts and human review. The owner-selected stack and boundaries are in [project scope](docs/PROJECT_SCOPE.md).

## Repository map

| Path | Purpose |
|---|---|
| `.github/` | Automated checks, dependency-update proposals and PR checklist |
| `docs/` | Scope, approved Figma references, build plan, tooling and verified project context |
| `scripts/check-postgres.ps1` | Read-only local PostgreSQL availability check |
| `web/src/app/` | Next.js layouts/pages and HTTP handlers: login, role workspace, admission/patient views, admin staff/settings/beds and health routes |
| `web/src/components/` | Reused interface elements; currently the approved visual shell |
| `web/tests/e2e/` | Browser and HTTP checks against a real local Next.js server |
| `web/scripts/` | Browser wrapper, local database provisioning, migration runner and guarded synthetic database fixtures |
| `web/src/server/` | PostgreSQL pool, Better Auth, server access checks, staff/settings commands, admission identity/reservations and audit |
| `web/drizzle/` | Generated SQL and schema snapshots; applied SQL checksums are verified before further migrations |
| `web/package-lock.json` | Locked application/tool dependencies for repeatable installation |
| `tmp/` | Ignored npm cache, browser binaries and temporary verification output |

## Boundaries to preserve during implementation

Server Components will read authorized records. Thin Server Actions and the few required Route Handlers will call feature-owned server commands. Role, active-account and state checks belong on the server. Shared money/state logic is deterministic and transactional; money is integer paise, and ledger corrections retain history.

The PostgreSQL foundation uses separate owner/runtime accounts for `hims_local` and `hims_test`, a lazy five-connection pool and reviewed migrations. Audit history records human or internal-job identity, request, source, reason, timestamp and entity versions; runtime privileges prohibit changing or deleting audit and setting-version rows. Feature modules extend `web/src/server/` and add new migrations under `web/drizzle/`; never rewrite applied migration bytes. See [database setup](docs/DATABASE_SETUP.md).

LangGraph and its PostgreSQL saver are installed. They will be configured in the paperwork task after staff access, document handling and provider decisions exist. AI cannot authorize clinical treatment, coverage, money or discharge seals. External insurers/TPAs and staff remain responsible for verification; payment-service integration is deferred.

Better Auth owns password hashing and database sessions; protected commands recheck current role and active status. Staff changes revoke sessions, and serialized administration preserves the last active administrator. Public signup and raw administrative auth endpoints are blocked. Settings append immutable versions with stale-edit protection. See [staff access](docs/STAFF_ACCESS.md). Persisted admissions establish scoped admission-desk, administrator operational and recorded-admitting-doctor reads; unimplemented department assignments remain closed.

Permanent patient identity, pending admission episodes and exclusive physical-bed holds exist. Registration/reservation does not start a room stay or charging; billing activation owns that transition. Pending cancellation preserves identity, IP code and history. See [admission](docs/ADMISSION.md) and [current acceptance status](docs/agent/BUILD_HANDOFF.md). `/api/health` reports application liveness; `/api/health/ready` checks access to the foundational schema and returns a minimal 503 when unavailable. Use synthetic data until the later pilot safeguards are complete. Follow the [implementation plan](docs/superpowers/plans/2026-10-09-hims-inpatient.md) for the remaining modules.
