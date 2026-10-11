# Staff access

HIMS uses one Better Auth login screen and separate staff identities. The owner confirmed one hospital first, with role-specific dashboards following the approved design. The accepted application provides all eight role worklists, source-linked alerts, account management and hospital settings. [Hospital overview](OVERVIEW.md) is Administrator-only; every role list rechecks current role/assignment and links to existing authorized action screens.

## Local development accounts

The owner authorized temporary local accounts for ADMIN, ADMISSION, DOCTOR, NURSE, PHARMACY, LAB, INSURANCE and BILLING. Their login names follow `admin@hims.test`, `doctor@hims.test` and the corresponding lowercase role name. No email is sent. The generated temporary password is stored only in ignored local files; it is not a source-code default. The local handoff file is `tmp/development-logins.txt`.

Open `http://localhost:3000/login` after starting the application. Administrators can manage staff and hospital settings from their workspace. Users can change their own password and sign out. Hospital financial settings begin unconfigured; demo accounts do not establish real staff credentials or real hospital policy.

The top-right Profile shows the authenticated staff identity with Admin-managed name, email and role. Its real password change revokes other sessions; Logout ends the current session. Adjacent Customize stores only that staff member's accent, density and motion in the current browser, with a visible fallback if storage is unavailable and respect for reduced motion. Appearance controls do not modify hospital rules or access. Staff administration stays in Admin's Staff screen. Role start paths and current UI evidence are recorded in [overview](OVERVIEW.md) and [UI progress](agent/UI_REDESIGN_PROGRESS.md).

Fresh local setup first follows [database setup](DATABASE_SETUP.md). With an explicitly supplied private `HIMS_DEMO_PASSWORD`, the command below creates the eight development accounts only in the dedicated local database:

```powershell
npm --prefix web run db:migrate
npm --prefix web run auth:bootstrap -- --demo
```

Initialization refuses a database that already contains staff and never overwrites their accounts or passwords. Ordinary first-admin initialization is also available through the CLI using transient `HIMS_BOOTSTRAP_ADMIN_NAME`, `HIMS_BOOTSTRAP_ADMIN_EMAIL` and `HIMS_BOOTSTRAP_ADMIN_PASSWORD`; keep secrets out of command arguments, terminal history and Git. `BETTER_AUTH_SECRET` is generated during database setup. Authentication now requires that private secret to contain at least 32 characters and an explicit `BETTER_AUTH_URL` origin. HTTP is accepted only on loopback; remote origins require HTTPS. Better Auth provides HttpOnly/SameSite=Lax cookies and Secure cookies on HTTPS. Browser tests override configuration only with synthetic values. See the [pilot guide](LOCAL_PILOT.md) before extending local access to real staff.

## Boundaries

- Public signup, account deletion and impersonation routes are unavailable. Staff administration requires an active administrator and records an attributable reason.
- Server checks use current staff role and active status on each protected operation. Disabling an account, changing its role or resetting its password revokes its sessions. The last active administrator cannot be removed through these controls.
- Administrator status does not confer doctor, pharmacy or nursing signing authority. Persisted admissions allow minimized admission-desk, administrator operational and recorded-admitting-doctor reads. Nurse care requires an explicit current assignment; revocation removes access and preserves history. Pharmacy operational access projects only persisted medicine work, stock and preparation; Administrator operational access does not grant its professional seal. LAB reads/operations require actual persisted diagnostic tasks and minimize chart disclosure; assigned Doctors receive the human report/addenda projection. Barcode images and printable labels recheck current LAB identity/source access. Insurance work requires the current case assignment and purpose-limited fields.
- Settings changes create immutable versions with an actor and reason. A stale edit must refresh instead of silently replacing a newer configuration. Missing rates or deposits require configuration; they do not mean free care or waived payment. An explicitly saved zero price is a distinct recorded policy and does not waive a separate deposit requirement.
- Password handling and sessions use Better Auth. There is no configured email delivery/recovery provider; an administrator manages access and password resets locally.

The admission and care role/action/field boundaries are exercised against real synthetic episodes, including guessed IDs, wrong doctors and forged contexts. Administrator/billing roles can read minimized financial views; admission staff receive only the deposit/activation view. Nurses receive their assigned care projection without raw doctor rounds, addenda or summaries. Administrator scheduling does not open a clinical chart. See [admission](ADMISSION.md), [billing](BILLING.md), [care](CARE.md) and [current review status](agent/BUILD_HANDOFF.md). Task 16 also verifies restored login/private delivery, role denials and actual HTTPS-origin cookie configuration. These modules do not establish multihospital isolation or real-patient readiness; real staff identities, permissions, TLS hosting and operating policy still require hospital decisions.

The doctor can create a versioned transfer decision only for their current episode; the assigned nurse records the actual destination/handover in their own shift. Administrator status supplies neither signature. Transfer history remains readable through existing role-minimized care projections. See [transfers](TRANSFERS.md).

Admin staff/settings JSON routes authenticate current Admin before reading a body and use the existing streamed reader with a 16 KiB limit. The bounded password-change fields use the same limit after staff authentication. Transactional command authorization still rechecks access. Public auth handling and the 128 KiB paperwork limit retain their existing behavior. Readiness also refuses forbidden table or column grants: all TRUNCATE, DELETE outside session/verification/bed holds, and UPDATE outside the established mutable allowlists.

Pharmacy worklists send summary-only episodes with no medicine order to their authorized discharge Pharmacy review, including an explicitly empty prescription. Take-home prescriptions require existing medicine orders and retain the Pharmacy preparation route. Source-bound financial care amendments do not expose money totals or a clinical chart to unrelated roles.
