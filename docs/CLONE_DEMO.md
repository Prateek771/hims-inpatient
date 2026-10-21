# Run the fictional hospital on another computer

This creates a separate local demonstration of **Lotus Grove Demo Hospital**. It does not copy the owner's working database, staff passwords, sessions, patient history or uploaded documents. GitHub contains the schema migrations and a fictional-data setup script. Each installation creates its own database, credentials and sample records.

## Fresh Windows installation

Install **Git, Node.js24 and PostgreSQL18** first. Keep the PostgreSQL service running and have your own local `postgres` administrator password available. The application uses limited owner/runtime accounts after setup; it does not run as the PostgreSQL administrator.

Clone the development branch containing this package:

```powershell
git clone --branch codex/hims-development --single-branch https://github.com/Prateek771/hims-inpatient.git
cd hims-inpatient
npm --prefix web ci
```

Run the existing local database setup helper. It prompts for your own PostgreSQL administrator password, generates fresh database accounts, and writes ignored `web/.env.local` without retaining the administrator password.

```powershell
& .\scripts\setup-local-database.ps1
```

Do not copy someone else's `.env.local`, and do not create one from the template before running this helper. It refuses existing environment files, databases and accounts. These instructions are for an empty installation, never a command to replace an existing hospital database. The helper expects Node's normal Windows installation at `C:\Program Files\nodejs\node.exe` and local PostgreSQL on port5432.

Prepare the new database, protected folders and fictional demonstration:

```powershell
npm --prefix web run db:migrate
npm --prefix web run paperwork:setup
npm --prefix web run storage:setup
npm --prefix web run demo:seed
npm --prefix web run dev
```

Open <http://localhost:3000/login>. Keep the final command running. No browser-driver installation, AI account, insurer connection, tunnel or hosting account is needed to use the local application.

Read your newly generated password from **`web/tmp/clone-demo-logins.txt`**. Use `admin`, `admission`, `nurse`, `billing`, `pharmacy` or `insurance` in **Email or role**. You can also enter `<role>@hims.test`. The six routine staff sections use this installation's generated password; no password is published here. The existing bootstrap also creates legacy Doctor/Lab identities, which retain historical access and are not additional routine MVP dashboards.

`web/tmp/clone-demo-summary.json` lists this installation's patient IDs, admission codes and next actions. Both files remain ignored by Git. The passwords, signing secret and PostgreSQL accounts are fresh for each installation. Use this package only for fictional testing.

The existing setup modules use Node/PostgreSQL across platforms, but the interactive helper above is Windows-specific. On macOS/Linux, use your normal PostgreSQL installation and the existing guarded [setup documentation](DATABASE_SETUP.md); supply the setup administrator password privately through `HIMS_SETUP_ADMIN_PASSWORD` when running `node web/scripts/bootstrap-local-database.mjs`, then follow the same npm commands. Never put passwords into committed scripts or share the generated environment file.

## What the demonstration contains

- One fictional hospital in Asia/Kolkata; three bed categories and their training room tariffs/deposit rules.
- Twelve beds: six General, four Private and two High Dependency; four are held/occupied by sample cases and eight remain available.
- Three external Doctors and a seven-day availability roster maintained by the Nurse.
- Six configured billable items covering consultation, procedure, medicine, consumable, laboratory and radiology evidence.
- Four fictional patient episodes using normal server commands, role checks, audit history and deterministic money rules.

| Patient | Starting state | First exercise |
|---|---|---|
| Demo Saira Kapoor | Pending self-pay reservation, Demo P-201 | Admission records a fictional deposit and actual arrival; Admin assigns the Nurse. |
| Demo Aarav Sharma | Active self-pay, Demo G-101, Nurse assigned; medicine and consultation charges | Nurse reviews the episode; Pharmacy practices an accepted unused return; Billing reviews the deposit and charges. |
| Demo Meera Shah | Active insured, Demo G-102; assigned insurance case with fictional policy verification | Insurance records a fictional external payer decision; accepted responsibility remains separate from actual insurer cash. |
| Demo Kavya Patel | Active self-pay, Demo G-103; recorded external Doctor instruction, checklist and Nursing readiness | Pharmacy completes its reconciliation; Admin reviews proposed diagnostic/insurance N/A; Nurse records vacancy, then Billing reviews settlement. |

To practice the full cycle, use a new patient in a free bed: **Admission → Admin assignment → Nurse care and externally authorized discharge → applicable Pharmacy/Insurance checks → Billing settlement/final finance → authorized papers → Nurse actual exit → Admin turnover**. The Doctor decides externally; this software records the named authority and evidence. It does not prescribe or make clinical decisions. Use separate browser profiles or sign out before switching roles. Five rapid sign-in attempts per minute are allowed; wait a minute if switching through all six roles triggers429.

This package starts with actionable cases. It does not include the owner's completed discharge history, private PDFs, actual payments, provider keys or account sessions. New demonstration documents can be generated later through authorized application actions and remain local. Room charges depend on the current time; use the live bill during practice. Renew Doctor availability after seven days.

## Existing databases, retries and updates

`demo:seed` requires a freshly migrated, completely empty local HIMS database under `hims_runtime`. It rejects remote/query-overridden URLs, privileged accounts, existing operational or paperwork-checkpoint rows and existing demo credential files. It never resets, truncates or overwrites an installation. After partial failure, preserve generated credentials and records for diagnosis; do not delete files or rerun the seed to repair a working hospital.

Run the setup before starting the app or admitting patients. Once configured, restart the app using `npm --prefix web run dev`; do not rerun the seed. Pulling code updates does not synchronize either person's database, and their changes do not appear on the owner's PC automatically. Sharing one live database is a separate hosting/access decision.

The owner's local migration/deployment hold remains in force. Fresh recipient setup and an independent verification cluster do not authorize migrations or data changes in the owner's working database.
