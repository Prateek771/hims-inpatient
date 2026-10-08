# Staff access

HIMS uses one Better Auth login screen and separate staff identities. The owner confirmed one hospital first, with role-specific dashboards following the approved design. The current access foundation provides role-aware starting screens, account management and hospital settings; clinical and department dashboards gain their working data in their owning build phases.

## Local development accounts

The owner authorized temporary local accounts for ADMIN, ADMISSION, DOCTOR, NURSE, PHARMACY, LAB, INSURANCE and BILLING. Their login names follow `admin@hims.test`, `doctor@hims.test` and the corresponding lowercase role name. No email is sent. The generated temporary password is stored only in ignored local files; it is not a source-code default. The local handoff file is `tmp/development-logins.txt`.

Open `http://localhost:3000/login` after starting the application. Administrators can manage staff and hospital settings from their workspace. Users can change their own password and sign out. Hospital financial settings begin unconfigured; demo accounts do not establish real staff credentials or real hospital policy.

Fresh local setup first follows [database setup](DATABASE_SETUP.md). With an explicitly supplied private `HIMS_DEMO_PASSWORD`, the command below creates the eight development accounts only in the dedicated local database:

```powershell
npm --prefix web run db:migrate
npm --prefix web run auth:bootstrap -- --demo
```

Initialization refuses a database that already contains staff and never overwrites their accounts or passwords. Ordinary first-admin initialization is also available through the CLI using transient `HIMS_BOOTSTRAP_ADMIN_NAME`, `HIMS_BOOTSTRAP_ADMIN_EMAIL` and `HIMS_BOOTSTRAP_ADMIN_PASSWORD`; keep secrets out of command arguments, terminal history and Git. `BETTER_AUTH_SECRET` is generated during database setup and `BETTER_AUTH_URL` identifies the configured app origin. Browser tests override these with synthetic test configuration.

## Boundaries

- Public signup, account deletion and impersonation routes are unavailable. Staff administration requires an active administrator and records an attributable reason.
- Server checks use current staff role and active status on each protected operation. Disabling an account, changing its role or resetting its password revokes its sessions. The last active administrator cannot be removed through these controls.
- Administrator status does not confer doctor, pharmacy or nursing signing authority. Admission access currently fails closed until real admission and assignment records are implemented.
- Settings changes create immutable versions with an actor and reason. A stale edit must refresh instead of silently replacing a newer configuration. Missing rates or deposits require configuration; they do not mean free care or waived payment.
- Password handling and sessions use Better Auth. There is no configured email delivery/recovery provider; an administrator manages access and password resets locally.

The role/action/field boundaries will be exercised against real synthetic admissions as those features are added. This phase does not establish multihospital isolation, clinical workflow completion or real-patient readiness.
