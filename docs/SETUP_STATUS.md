# Foundation setup status

Verified on **9 October 2026**. Working folder: `C:\Users\prate\OneDrive\Desktop\INS`; working branch: `codex/hims-development`. This is foundation setup, not a working hospital system or deployment.

## Installed and checked

- Next.js 16.4.0 / React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3. Scaffolded through the official CLI into `web/` with no nested Git repository.
- Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, node-postgres 8.23.1 and Zod 4.6.5.
- LangGraph 1.4.21, LangChain core 1.2.17 and PostgreSQL checkpoint saver 1.0.6. No provider client or model/OCR credential was selected.
- Playwright 1.64.0, Chromium, Vitest 5.0.3 / Vite 8.3.4. Browser binaries and the setup npm cache are under ignored `tmp/` inside this project.
- Existing PostgreSQL 18.6 service was running; `pg_isready` on `127.0.0.1:5432` reported accepting connections. No database, role, credential or existing record was changed.
- Approved Figma node `4:3` was inspected before implementing the shared shell. IBM Plex Sans is bundled through the locked Fontsource package and served locally, without build-time Google-font requests.

## Verification evidence

The untouched framework starter failed the browser baseline on missing hospital navigation/heading and HTTP 404 at `/api/health`. After implementation, lint, type checks, production build and three Chromium/HTTP checks passed. Checks cover landmarks, the honest setup state, keyboard skip/focus, the approved prototype link, narrow-screen page overflow, no browser errors and minimal uncached liveness JSON. The same suite runs against the built production application; desktop/narrow screenshots are inspected separately.

`npm ls --depth=0` had no invalid/missing peers. Vitest and Drizzle Kit version commands worked. Source-reference integrity, local links and Git whitespace are checked before commit. GitHub Checks repeats source/build/browser checks and the production dependency audit on development/main pushes and main PRs.

A separate read-only review found no remaining Critical, Important or Minor issues in this foundation. It checked source, tests, lockfile, CI/cache paths, ignore rules and documentation. Database permissions, staff access, hospital transactions, working AI persistence and deployment readiness remain later scope; the review did not certify them.

## Known limitations

- `npm audit --omit=dev` reports **0 vulnerabilities**. Full audit reports **9 development dependency findings: 5 high and 4 moderate**. Five entries share the lint chain `@next/eslint-plugin-next -> fast-glob -> micromatch -> braces`; the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) had no published patched version in the registry at setup. Four moderate entries share Drizzle Kit's older esbuild-loader chain; see the [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). No force fix, unverified override or framework downgrade was applied. Follow upstream fixes through Dependabot and rerun the full audit before real-data use.
- ESLint 9.39.5 is deprecated/unsupported upstream, but the installed Next.js React/import/accessibility lint plugins reject ESLint 10. Keep required lint rules until a compatible supported toolchain is available; see [ESLint support policy](https://eslint.org/version-support/).
- npm reported blocked/unapproved dependency install scripts. No blanket approval was granted; the actual lint/build/browser/Vitest/Drizzle commands were checked successfully with the installed native packages.
- There is no HIMS database/schema, staff login, patient transaction, insurance-paperwork agent or external payment/insurer connection. Installed packages do not imply those flows work.
- Vitest is configured for the future unit suite; no unit or database integration tests exist yet. They are not reported as passed or silently skipped. No deployment or real-patient readiness is claimed.

Next build step: PostgreSQL foundation with separate runtime/migration roles and an isolated synthetic test database, followed by staff access. Follow the [build plan](superpowers/plans/2026-10-09-hims-inpatient.md).
