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

A separate read-only review found no remaining issues in the initial shell checkpoint. PostgreSQL foundation review and verification are recorded separately below; staff access, hospital transactions, AI persistence and deployment readiness remain later scope.

## PostgreSQL foundation

Generated migrations were inspected and applied through `hims_owner`. Separate runtime accounts are not superusers and cannot update/delete/truncate audit history or setting versions, create tables or rewrite migration history. A bounded lazy pool avoids requiring database access at build time. `/api/health/ready` checks access to all three foundational tables and returns a minimal 503 when unavailable; liveness stays independent.

Verification passed: 19 unit assertions, a real PostgreSQL integration scenario covering empty-schema migration, foreign-key and audit rollback, runtime privilege denial and human/system actor distinctions; lint, typecheck and production build. Four browser/HTTP checks include database readiness. Integration initially failed explicitly when credentials were missing, rather than skipping. Both integration and browser checks use explicitly guarded synthetic database credentials. Review corrections also sanitize malformed connection-string errors so diagnostics do not print credentials.

An intermittent Vite transformed-file error occurred under the sandbox's temporary directory. Serial execution alone was insufficient; the runner now places temporary files inside ignored `INS/tmp/vitest`, after which consecutive unit runs passed. The exact upstream cause is unproven. The configuration-loader warning concerns a future Vite default; current checks execute successfully without suppressing it.

See [local database setup](DATABASE_SETUP.md). Generated connection strings are ignored; no real patient data or hospital billing policy was seeded. SQL files are checksummed and applied in transactions; applied migration bytes must remain unchanged.

## Known limitations

- `npm audit --omit=dev` reports **0 vulnerabilities**. Full audit reports **9 development dependency findings: 5 high and 4 moderate**. Five entries share the lint chain `@next/eslint-plugin-next -> fast-glob -> micromatch -> braces`; the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) had no published patched version in the registry at setup. Four moderate entries share Drizzle Kit's older esbuild-loader chain; see the [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). No force fix, unverified override or framework downgrade was applied. Follow upstream fixes through Dependabot and rerun the full audit before real-data use.
- ESLint 9.39.5 is deprecated/unsupported upstream, but the installed Next.js React/import/accessibility lint plugins reject ESLint 10. Keep required lint rules until a compatible supported toolchain is available; see [ESLint support policy](https://eslint.org/version-support/).
- npm reported blocked/unapproved dependency install scripts. No blanket approval was granted; the actual lint/build/browser/Vitest/Drizzle commands were checked successfully with the installed native packages.
- Staff login, patient transactions, insurance-paperwork agents and external payment/insurer connections are not implemented. Database foundations do not imply those flows work.
- No deployment or real-patient readiness is claimed. Settings payloads will receive domain-specific validation and administration screens in later tasks; no real financial policy is assumed.

Next build step: Better Auth staff access and hospital settings. Follow the [build plan](superpowers/plans/2026-10-09-hims-inpatient.md).
