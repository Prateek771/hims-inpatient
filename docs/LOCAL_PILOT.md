# Local synthetic pilot and recovery

Task 16 verifies one hospital's staff-facing inpatient flows. It does not authorize real patient data, external deployment, insurer/payment integration or autonomous document sending. Tasks 1–15 were accepted at `a7aa4f3`; the documentation checkpoint `fff4b81bb34f8ab3aafc757a4af19272f1b123a2` passed development/main CI before this work. The final Task 16 checkpoint and CI evidence are recorded in [build handoff](agent/BUILD_HANDOFF.md) and its linked local ledger.

## Explicit setup

Use only the approved `INS` folder, Node 24, installed PostgreSQL 18 and the locked dependencies. For a genuinely new installation, follow [database setup](DATABASE_SETUP.md), which creates distinct limited owner/runtime and synthetic-test accounts. Preserve an existing installation; do not rerun provisioning, reset/reseed its database or rewrite applied SQL.

After new provisioning, run from `INS`:

```powershell
npm --prefix web ci
npm --prefix web run db:migrate
npm --prefix web run paperwork:setup
npm --prefix web run storage:setup
npm --prefix web run auth:bootstrap
npm --prefix web run test:install
```

`storage:setup` explicitly creates the two protected local directories, outside the public web root. Application readiness never creates directories or applies database migrations. The existing Task 16 installation is preserved; these ordinary setup commands were not executed against it.

Private `web/.env.local` contains the four database URLs and authentication configuration. Keep it out of Git, shell arguments, logs and screenshots. Set an explicit `BETTER_AUTH_URL` consisting of an origin and a private `BETTER_AUTH_SECRET` of at least 32 characters. HTTP is accepted only for `localhost`, `127.0.0.1` or `::1`; a staff-accessible remote origin requires HTTPS. Better Auth uses HttpOnly/SameSite=Lax session cookies and Secure cookies for an HTTPS origin. No public registration is available. Establish TLS/reverse-proxy configuration and the final origin before any broader staff pilot.

`/api/health` is liveness. `/api/health/ready` returns only `{ "status": "ready" }` or `{ "status": "unavailable" }`, with no-store caching. Readiness checks the complete core HIMS schema, required limited runtime grants, authentication configuration and protected storage access. It does not claim that hospital policies are approved, backups are operational, optional native paperwork setup exists or a live OCR/AI provider is selected. Missing optional paperwork capability remains visible through its existing commands/UI. The selected manual path needs no live provider.

## Reproducible verification

```powershell
npm --prefix web run check
npm --prefix web audit --omit=dev
npm --prefix web audit
```

The aggregate executes unit tests, actual PostgreSQL integration tests, required ESLint, TypeScript, a production build, Chromium/HTTP checks, then real synthetic backup/restore. Missing database access fails. Synthetic integration checks deliberately recreate only the guarded test schema. Never put hospital records in `hims_test`. Runners set `HIMS_SYNTHETIC_TEST_RUN=1`, which forbids ordinary runtime/database storage selection even if a late test continuation sees restored environment settings. Document-test cleanup waits for its in-flight database callback before restoring those settings. The 10,083-entry seven-day capacity test has a measured 60-second total budget; ordinary tests keep 20 seconds and runtime SQL keeps its five-second limit. Browser checks prepare genuine server-command fixtures and use port 3100; stop other synthetic 3100 previews first. The ordinary `localhost:3000` preview is separately owned and remains untouched.

The two coherent journeys use nonzero tariffs: one started hour at INR600, one at INR1200, consultation INR500, four issued tablets at INR10 each, including one unused tablet later returned, lab INR300, radiology INR500 and one consumable INR50. Their gross INR3190 less one INR10 unused-tablet return gives INR3180 each. Self-pay deposits INR4000 and refunds INR820. Insured responsibility is INR2700 insurer plus INR480 patient, actual payer receipts INR1000 then INR1700, patient deposit INR600 and refund INR120. Neither authorization nor an unpaid partial receipt completes financial clearance. Both episodes retain exact activation/transfer/vacancy/departure times, addenda, MAR, stock movements, samples/reports, four actual sequential human seals, original and amended immutable PDFs. Concurrent requests/retries converge and stale final review is rejected. An exceptional early exit retains unpaid money and missing professional seals.

## Recovery isolation and evidence

`test:recovery` runs after the browser server has stopped. On Windows it creates a new ephemeral PostgreSQL 18 cluster on a different loopback port inside ignored `INS/tmp/recovery/<generated UUID>/cluster`. It never stops or restores into the installed service. CI uses a second fresh service at port 55432 in the same required check job. Both use the existing `hims_test` identity and fixed limited role names; reset guards are unchanged. Recovery rejects a shared source/target cluster, a remote target, ordinary identities and any nonempty restore target.

The quiescent fixture database is held under the existing test advisory lock and exported repeatable-read snapshot. `pg_dump`/`pg_restore` receive credentials through libpq environment variables, never URL arguments. The custom archive restores once into the empty target without `--clean`, drop, migration or reseeding. Every table's ordered row count/hash and schema/table/column grants are compared; PostgreSQL's native `acldefault` expands implicit default ACLs before grant comparison. All 54 SQL checksums and native checkpoint versions 0–4 are preserved. Protected source files and PDF manifests are checked as regular files and copied into an independent namespace; hashes are verified before authorized download. No storage override accepts a client path: the server accepts only a guarded synthetic UUID below `INS/tmp/recovery`, rejects reparse/symlink paths and never falls back to ordinary uploads.

The restored application performs actual staff login, minimal readiness, protected PDF/insurance-file delivery, verification and anonymous/wrong-role denial at `http://127.0.0.1:3100`. Actual server commands reread clinical history, ledger totals and both document versions. A genuine paused PostgresSaver thread survives restore; one human request for changes resumes it to revision 2, waits for another human review and has no packet, follow-up or external send. The source row hashes remain unchanged. Restore verification mutates only the independent target.

Artifacts remain private/ignored: `synthetic.dump`, protected storage, `connection.private.json`, journey IDs, database files, manifest and command/HTTP verification. `tmp/task16-recovery-latest.json` points to the most recent successful evidence. The harness stops only its owned cluster/server on completion. Treat synthetic artifacts as private too: restrict local OS access, do not upload their contents to CI failure artifacts, and remove them under an owner-approved retention decision.

For an independent local review, use a separate PowerShell session, read the latest pointer to obtain `<id>` and replace that placeholder below. Start only that retained cluster:

```powershell
node web/scripts/recovery.mjs --cluster-start <id>
$recovery = Get-Content -LiteralPath 'tmp/recovery/<id>/connection.private.json' -Raw | ConvertFrom-Json
$env:DATABASE_URL = $recovery.runtimeUrl
$env:BETTER_AUTH_URL = 'http://127.0.0.1:3100'
$env:BETTER_AUTH_SECRET = 'SyntheticE2EOnlySecretAtLeast32Characters12345'
$env:HIMS_INSURANCE_STORAGE = 'synthetic'
$env:HIMS_DOCUMENT_STORAGE = 'synthetic'
$env:HIMS_SYNTHETIC_RECOVERY_ID = '<id>'
$env:HIMS_SYNTHETIC_TEST_RUN = '1'
npm --prefix web run start -- --hostname 127.0.0.1 --port 3100
```

Use the synthetic accounts only, for example `billing@e2e.fixture.invalid` or `insurance@e2e.fixture.invalid`, password `SyntheticE2EOnly123!`. Stop this foreground preview with Ctrl+C, then run `node web/scripts/recovery.mjs --cluster-stop <id>` and close that PowerShell session to discard its recovery environment. Start/stop validates the retained owned manifest and cluster boundary. Do not run migrations, fixture preparation or ordinary database setup against a retained target.

A separate review at `127.0.0.1:3001` may set both the application origin and start port to 3001. Immutable PDF bytes and their QR/verification origin remain the original `127.0.0.1:3100`; they were not rewritten or tested as QR links to 3001. Use the matching original origin for an authentic immutable-link demonstration. `localhost:3000` remains a different cookie host.

## CI pins and dependency limits

The single existing `Web checks` job retains all required checks and adds isolated recovery. The package lock remains unchanged; installation uses `npm ci`. Verified against primary sources on 10 October 2026:

| Selection | Resolved pin |
|---|---|
| Runner | `ubuntu-24.04` |
| checkout v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| setup-node v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| upload-artifact v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| Both PostgreSQL services | `18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c` |

Sources: [supported runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [checkout release](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node release](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [official PostgreSQL image tag](https://hub.docker.com/v2/repositories/library/postgres/tags/18.6-bookworm).

Runtime audit observed zero vulnerabilities. The full development audit reports five high findings through `braces`/`micromatch`/`fast-glob` and the selected Next lint packages. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no published patched `braces` version; current [braces registry](https://registry.npmjs.org/braces/latest) remains 3.0.3, and [Next lint registry](https://registry.npmjs.org/eslint-config-next/latest) remains 16.4.0. No forced downgrade, replacement, suppression or unsupported patch was applied. Required lint and the runtime-audit gate remain. The Vitest config uses `.mts`, correcting Vite's actual CommonJS/ESM warning; this does not claim unrelated Node/color warnings are eliminated.

## Before hospital data or real operation

The hospital must name an accountable administrator for access provisioning/revocation, approved policies/tariffs, manual payer evidence, professional signatures and incident handling. Name backup and recovery owners and approve backup cadence, recovery point/time objectives, encrypted off-device copies, key custody, OS storage permissions, periodic restore drills, retention/destruction and access logs. Database and protected files must be backed up together with native checkpoint history and immutable document versions. No real-data backup is demonstrated by a synthetic restore.

Clinical, nursing and money decisions remain human and attributable. Insurer authorization stays distinct from actual receipt. Manual payments stay in existing hospital channels. Optional AI/OCR needs its separately approved provider/access/minimized disclosure; none was invoked here. Single-hospital deployment, TLS/hosting, operational monitoring, real policy validation, staff training, backups and the unresolved development audit are still pilot responsibilities. Passing these checks alone does not establish production readiness.
