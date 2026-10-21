# Local HIMS database setup

## Current fictional training setup — 15 October 2026

At the owner's explicit request, the existing ordinary database now contains **Lotus Grove Demo Hospital**, 12 sample beds, three categories, six priced catalogue items, three external Doctors and six staged fictional patients. Existing accounts, passwords, original records, protected files and migrations are preserved. No reset/bootstrap was performed. A fresh pre-setup backup and before/after preservation proof are retained privately. Use the [six-dashboard walkthrough](FICTIONAL_HOSPITAL_TESTING.md); earlier empty-configuration statements below describe the pre-training checkpoint. These illustrative policies do not establish real hospital policy.

## MVP v2 checkpoint — 15 October 2026

**Verified local acceptance:** the complete root check passed 83 unit/176 actual PostgreSQL/81 Chromium tests, lint/types/build and isolated recovery of 96 tables / 1,850 exact rows / 23 protected files. The five additive migrations 0056–0060 are now applied to the ordinary database (61 SQL versions total). Before/after proof preserves all 81 original tables / 46 original rows, all 56 old migration bytes, credentials, private files and native checkpoint records. No reset/reseed or ordinary patient/policy seed occurred. Exact development CI and copied-preview observations are recorded after publication in ignored `tmp/mvp-implementation/release-evidence.json`; see [current progress](agent/MVP_IMPLEMENTATION_PROGRESS.md).

Five additive migrations, **0056–0060**, are implemented and source-reviewed. The complete local gate and ordinary additive application passed as recorded above. Preserve existing v1 rows, staff accounts, private files and applied migration bytes; do not reset, reseed or bootstrap the existing installation.

The six routine workspaces are Admin, Admission, Nurse, Pharmacy, Billing and Insurance. Ordinary hospital settings, beds/categories, tariffs/service items and the external Doctor roster remain empty; no operational seed was introduced. Admin must configure these and assign the Doctor-availability Nurse owner/backup and operational staff responsibilities. Doctor/Lab accounts and authorized historical reads are preserved without routine v2 dashboards.

The assigned Nurse records external Doctor authority and evidence, with separate authorizer/source and recorder times; applicable checks run in parallel. Accepted insurer responsibility/receivable remains distinct from cash. Configured externally performed service billing requires performed time, named department/issuer, unique external bill/line references and evidence; prices come from configured tariffs. Insurance verification remains external, and AI paperwork remains manual until an approved provider is configured and live processing separately authorized. This checkpoint makes no real-patient or production-readiness claim. See [current scope](PROJECT_SCOPE.md) and [MVP handoff](agent/MVP_DASHBOARD_HANDOFF.md).

## Provisioning a new installation

Run from the approved `INS` folder on Windows:

```powershell
powershell -NoProfile -File scripts/setup-local-database.ps1
```

The prompt accepts the existing local PostgreSQL `postgres` administrator password privately. It connects to `127.0.0.1:5432`, creates new databases, and generates independent random passwords for their accounts. It does not save the administrator password, change PostgreSQL authentication settings or reset an existing database.

| Database | Schema owner / migration account | Application account |
|---|---|---|
| `hims_local` | `hims_owner` | `hims_runtime` |
| `hims_test` | `hims_test_owner` | `hims_test_runtime` |

All four accounts lack superuser, database-creation, role-creation, replication and row-security-bypass privileges. Runtime accounts receive only explicitly granted application access through migrations. Activity history and setting versions cannot be updated or deleted by the application account.

Generated connection strings live in ignored `web/.env.local`. Do not share its contents, commit it or include it in screenshots. The file contains both development and synthetic-test credentials; runtime code reads only `DATABASE_URL`. Schema tooling reads `MIGRATION_DATABASE_URL`; integration fixtures require both `TEST_DATABASE_URL` and `TEST_RUNTIME_DATABASE_URL`, without a fallback to the application connection.

Setup refuses to overwrite an existing environment file, database or role. An incorrect password makes no database changes; the Windows prompt offers another attempt. If provisioning is interrupted after the private file was created, preserve that file and inspect the exact partial setup before retrying. Do not delete databases or reset another project's accounts as a workaround.

After successful setup:

```powershell
npm --prefix web run db:migrate
npm --prefix web run paperwork:setup
npm --prefix web run storage:setup
npm --prefix web run test:unit
npm --prefix web run test:integration
```

The integration helper may recreate the HIMS schema only in the explicitly named synthetic test database. It checks the actual connected database/account and rejects the application database. Never place hospital records in `hims_test`.

`paperwork:setup` explicitly prepares the official persistent checkpointer in the fixed `hims_paperwork_checkpoints` schema under the dedicated migration owner. It checks library migration versions 0–4 and grants runtime scoped access without CREATE or DELETE. Application requests/imports never perform this setup. Preserve existing checkpoint rows if setup is retried; see [paperwork contracts](PAPERWORK.md). Future authorized backup/restore must preserve this schema along with HIMS records and protected file storage.

`storage:setup` explicitly prepares the protected project directories before startup. Readiness never creates them; authorized document publication/upload retains its existing directory preparation. Set an explicit private auth secret of at least 32 characters and app origin in the private environment file. HTTP is accepted only on loopback; a remote staff origin requires HTTPS. See [staff access](STAFF_ACCESS.md) and [local pilot](LOCAL_PILOT.md) for new-installation initialization and the unresolved real-hospital responsibilities.

`/api/health` reports whether the app is running. `/api/health/ready` checks complete core tables/columns, required limited runtime grants, auth configuration and protected-storage access, returning only ready/unavailable without credentials or schema details. Its success does not approve hospital policies, staff permissions, backup operations or real-patient use.

Core readiness does not claim that paperwork checkpoints are configured. Missing checkpoint setup produces a truthful paperwork capability failure while the ordinary hospital workflows remain available.

GitHub Checks uses fresh PostgreSQL services and synthetic credentials for every run; it does not connect to this computer or contain local passwords. Recovery restores a quiescent synthetic snapshot and protected files into an empty independent cluster/storage namespace, preserving ordinary `hims_local`. Follow the [pilot guide](LOCAL_PILOT.md); never restore over the working database to test recovery.
