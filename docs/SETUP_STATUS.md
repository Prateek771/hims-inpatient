# Foundation setup status

Verified on **9 October 2026**. Working folder: `C:\Users\prate\OneDrive\Desktop\INS`; working branch: `codex/hims-development`. This is foundation setup, not a working hospital system or deployment.

## Installed and checked

- Next.js 16.4.0 / React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3. Scaffolded through the official CLI into `web/` with no nested Git repository.
- Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, node-postgres 8.23.1 and Zod 4.6.5.
- LangGraph 1.4.21, LangChain core 1.2.17 and PostgreSQL checkpoint saver 1.0.6. No provider client or model/OCR credential was selected.
- Playwright 1.64.0, Chromium, Vitest 5.0.3 / Vite 8.3.4. Browser binaries and the setup npm cache are under ignored `tmp/` inside this project.
- Existing PostgreSQL 18.6 service was running. The owner entered its administrator password locally to create new `hims_local` and `hims_test` databases with distinct limited owner/runtime accounts. Existing databases, records and authentication settings were preserved; the administrator password was not saved.
- Approved Figma node `4:3` was inspected before implementing the shared shell. IBM Plex Sans is bundled through the locked Fontsource package and served locally, without build-time Google-font requests.

## Verification evidence

The untouched framework starter failed the browser baseline on missing hospital navigation/heading and HTTP 404 at `/api/health`. After implementation, lint, type checks, production build and three Chromium/HTTP checks passed. Checks cover landmarks, the honest setup state, keyboard skip/focus, the approved prototype link, narrow-screen page overflow, no browser errors and minimal uncached liveness JSON. The same suite runs against the built production application; desktop/narrow screenshots are inspected separately.

`npm ls --depth=0` had no invalid/missing peers. Vitest and Drizzle Kit version commands worked. Source-reference integrity, local links and Git whitespace are checked before commit. GitHub Checks repeats source/build/browser checks and the production dependency audit on development/main pushes and main PRs.

A separate read-only review found no remaining issues in the initial shell checkpoint. PostgreSQL and staff-access verification are recorded below; hospital transactions, AI persistence and deployment readiness remain later scope.

## PostgreSQL foundation

Generated migrations were inspected and applied through `hims_owner`. Separate runtime accounts are not superusers and cannot update/delete/truncate audit history or setting versions, create tables or rewrite migration history. A bounded lazy pool avoids requiring database access at build time. `/api/health/ready` checks access to all three foundational tables and returns a minimal 503 when unavailable; liveness stays independent.

Verification passed: 19 unit assertions, a real PostgreSQL integration scenario covering empty-schema migration, foreign-key and audit rollback, runtime privilege denial and human/system actor distinctions; lint, typecheck and production build. Four browser/HTTP checks include database readiness. Integration initially failed explicitly when credentials were missing, rather than skipping. Both integration and browser checks use explicitly guarded synthetic database credentials. Review corrections also sanitize malformed connection-string errors so diagnostics do not print credentials.

An intermittent Vite transformed-file error occurred under the sandbox's temporary directory. Serial execution alone was insufficient; the runner now places temporary files inside ignored `INS/tmp/vitest`, after which consecutive unit runs passed. The exact upstream cause is unproven. The configuration-loader warning concerns a future Vite default; current checks execute successfully without suppressing it.

See [local database setup](DATABASE_SETUP.md). Generated connection strings are ignored; no real patient data or hospital billing policy was seeded. SQL files are checksummed and applied in transactions; applied migration bytes must remain unchanged.

## Known limitations

- `npm audit --omit=dev` reports **0 vulnerabilities**. Full audit now reports **5 high development dependency findings**, all in the lint chain `@next/eslint-plugin-next -> fast-glob -> micromatch -> braces`; the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) had no published patched version in the registry at setup. A scoped override of `@esbuild-kit/core-utils`' esbuild to `0.25.12` removed the four older-loader findings; migration generation and application checks passed with it. No force fix or framework downgrade was applied. Follow upstream fixes through Dependabot and rerun the full audit before real-data use.
- ESLint 9.39.5 is deprecated/unsupported upstream, but the installed Next.js React/import/accessibility lint plugins reject ESLint 10. Keep required lint rules until a compatible supported toolchain is available; see [ESLint support policy](https://eslint.org/version-support/).
- npm reported blocked/unapproved dependency install scripts. No blanket approval was granted; the actual lint/build/browser/Vitest/Drizzle commands were checked successfully with the installed native packages.
- Admission activation, charges, department transactions and insurance-paperwork agents remain later tasks. Pending patient registration/reservations are implemented. External payment/insurer connections are outside the current scope.
- No deployment or real-patient readiness is claimed. Versioned settings are validated and editable by administrators, but no real financial policy is assumed. Deposits currently support an explicit fixed amount or no-deposit rule; formula-based rules need a defined reference rate. Login throttling is process-local and needs a shared store before multiple app replicas.

## Staff access and settings

Better Auth and its Drizzle adapter are pinned to 1.7.7. Shared login, role-aware landing screens, administrator staff management and versioned hospital/category/tariff/deposit/alert settings are implemented. Public signup and raw administrative auth endpoints are blocked. Session revocation, current role checks and last-administrator protection are enforced on the server. The owner-authorized eight local demo accounts were initialized without seeding patients or financial policy; credentials remain ignored. See [staff access](STAFF_ACCESS.md).

The complete check passed 20 unit tests, 3 PostgreSQL integration checks, lint, typecheck, production build and 6 browser/HTTP checks. Independent review caught a disabled-account test that reused an already-revoked session; the corrected test proves access immediately before disabling and denial afterward with the correct password. A new simultaneous-admin-demotion test verifies one administrator survives. The affected integration suite then passed all 4 checks, with lint/typecheck and whitespace checks passing. No application behavior changed in this review correction. Actual bootstrap CLI success/refusal, direct-request authorization, settings history and desktop/narrow-screen login/settings layouts were checked. Independent review accepted the phase with no unresolved findings.

## Admission and physical bed acceptance

Task 4 adds permanent patient identity, per-stay IP codes, recorded clinician intake, pending bed reservations/cancellation, administrator physical-bed controls and scoped admission/doctor/operational views. Registration accepts known DOB or reported age and optional contact. Saving a pending episode does not activate it or start room charging. See [admission behavior and limits](ADMISSION.md).

Independent review found that newer cancelled episodes could hide older live reservations behind a 50-row cap. The corrected list includes every ongoing episode and only limits closed history; its real PostgreSQL volume regression covers 79 ongoing episodes behind newer cancellations and preserves doctor scope. Supplied contact validation now rejects punctuation-only values. A safe direct/imported bundle regression checks that migration helpers have no CLI side effects.

After corrections, the controller's complete `npm --prefix web run check` exited 0: **26 unit tests, five actual PostgreSQL checks, lint, typecheck, production build and eight Chromium/HTTP tests**. Scoped independent re-review passed spec and quality with no unresolved Important/Critical findings. `npm --prefix web audit --omit=dev` returned zero findings. Source-reference hashes, local documentation links, SQL-byte preservation and Git whitespace checks passed. Display timestamps still use the host zone; the current host matches the hospital default, and explicit hospital-zone display is recorded for the later role-screen pass.

**Review incident and preservation:** a temporary esbuild review probe importing the old migration helper accidentally triggered its bundled main-module guard and applied ordinary migrations `0003–0005` before acceptance. The migration CLI is now a separate explicit entry. Before/after hashes of all staff/account/settings rows matched: eight staff users, eight account records and no settings. Ordinary patient, admission, bed, hold and stay counts were zero; no patient or policy seed occurred. Applied migrations were preserved. After review, `db:migrate` succeeded through the explicit CLI and preservation was verified again. See [durable handoff](agent/BUILD_HANDOFF.md).

Next build step: Task 5 billing after the verified development checkpoint passes GitHub Checks and is integrated into `main`. Follow the [build plan](superpowers/plans/2026-10-09-hims-inpatient.md).
