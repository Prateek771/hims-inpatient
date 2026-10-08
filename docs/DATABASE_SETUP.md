# Local HIMS database setup

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
npm --prefix web run test:unit
npm --prefix web run test:integration
```

The integration helper may recreate the HIMS schema only in the explicitly named synthetic test database. It checks the actual connected database/account and rejects the application database. Never place hospital records in `hims_test`.

`/api/health` reports whether the app is running. `/api/health/ready` reports whether its configured database is ready, without returning credentials or database details. Database setup and a healthy endpoint do not establish that staff login or hospital workflows are implemented.

GitHub Checks uses a fresh PostgreSQL service and synthetic credentials for every run; it does not connect to this computer or contain local passwords.
