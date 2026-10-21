# Revised MVP implementation progress

## Owner-authorized fictional training setup — 15 October 2026

Added Lotus Grove Demo Hospital through normal authenticated application commands: 12 beds, three room/deposit categories, six catalogue items, three external Doctors, seven-day Nurse availability coordination and six fictional episodes at different workflow stages. Existing accounts/passwords retained; no reset, bootstrap, migration, source rebuild or deployment. Six beds remain free; five active episodes have assigned Nurse shifts and two assigned Insurance cases. Isha retains a prepared final PDF, settled patient share and INR3,000 insurer receivable; Kavya retains the INR2,300 allocation/INR700 refund exercise. [Owner testing guide](../FICTIONAL_HOSPITAL_TESTING.md).

Fresh readable 640,437-byte custom archive and protected-file copies retained under ignored `tmp/fictional-hospital-2026-10-15/pre-setup-backup/`; SHA-256 `66b2d755d2d6be2f30daf9988cb1ff267ef1a515fb3c224dd6a37071f5d92f69`. Before/after hash proof preserves every original row across96 tables/109rows, all original private files, all eight staff/credential identities and61migration records. Only authorized training records, settings and new sessions/audits were added. The local setup journal initially could not serialize a returned BigInt receipt; its saved request IDs let normal commands resume without duplicate money. Completed setup refuses replay over user progress.

Actual Chromium logins/dashboard checks passed for all six roles, populated scope counts6/6/5/6/6/2; intake offers free beds/Doctors, Nurse retrieves the real final PDF and Pharmacy receives403. Live domain inspection confirms Isha's current finance/no blockers and Kavya's expected settlement blockers. Five-per-minute login throttling correctly returned429 during rapid role switching; Insurance succeeded after the normal window. Admin Settings produces an existing default-locale date-text hydration warning; values verified separately and limitation retained. All other dashboard checks had no page errors. Detailed browser/domain evidence and preservation snapshots are private in the training folder. Prior full application gate remains separate; data-only setup did not rerun the full suite or change its assertions.

> Latest local acceptance: the complete corrected command passed; five reviewed ordinary migrations are applied with exact original-data preservation. Publication/CI/copied-preview identities are recorded after commit in ignored `tmp/mvp-implementation/release-evidence.json`. Earlier entries retain the actual failed/intermediate runs.

Started 15 October 2026 at owner request: implement whole approved MVP including local PostgreSQL. [Executable plan](../superpowers/plans/2026-10-15-mvp-implementation.md); [scope](../PROJECT_SCOPE.md). Do not infer completion from an authorized plan.

## Ownership and preservation

Root integration owner. `workflow_readiness` owns core v2 workflow/billing/documents and migration0056; `identity_staff` owns new identity/Doctor availability and migration0057; `ui_readiness` owns app/components and role-scoped workspace projection. No overlapping schema/migration/fixture/build/Git ownership. All work stays in INS on codex/hims-development. Old episodes remain v1; no conversion/reset/reseed/credential rotation/deployment.

Baseline HEAD `8ffa9691ca2bf8acfcd8e8a58ba8141ad56c2e54`. Existing uncommitted design/docs/assets retained. Fresh read-only preservation baseline: **81 ordinary/native tables,46 existing rows,56 applied migrations,123 protected/migration files**. Private hash-only evidence: ignored `tmp/mvp-implementation/before.json`; helper `tmp/mvp-preservation.mjs`. No original row contents or credential values are copied into this record.

## Observed checks

- Node24.11.1/npm11.19.0 installed; existing PostgreSQL18 service running and accepts localhost5432. Sandbox-only probe failed; actual external-to-sandbox probe succeeded. No service restart/provisioning performed.
- Unchanged baseline units: **80/80 pass** outside sandbox. Restricted run had two child-process import timeouts and one symlink EPERM; successful unchanged rerun establishes environment cause, no weakened checks.
- Core v2 RED: new focused test import fails because `server/mvp/commands` is not implemented yet. Actual v2 journeys are still to be built/tested.
- Original database remains untouched by implementation at this entry. Full integration/build/browser/recovery/audits/ordinary migration/preservation comparison remain pending.

## Current decisions

- Owner delegated UHID edge handling: one initial for single-name patients; `UN` plus seven random digits for unidentified emergency identity. Keep identifier stable after staff confirm name. Server uniqueness/retry and explicit identity provenance; preserve every old identifier.
- Assigned Nurse can record named external diagnostic confirmation for applicable checks, retaining evidence rather than creating native diagnostic reports or claiming another profession's signature.
- No routine Doctor/Lab workspace. Retain their identities and authorized history. Admin queue does not grant Admission creation authority.

## Next gates

Finish independently owned source tasks, reconcile exact APIs, run focused real PostgreSQL proof, inspect migrations/native guards, run full root checks/audits, apply only reviewed additive ordinary migrations, compare original data/files, review whole change, then verify copied local runtime. Record all observed failures and source identities here. No completion or production-readiness claim yet.

## Integration verification - in progress

Identity/directory/availability focused PostgreSQL checks passed **2/2**; identity units passed **2/2**. Integrated type checking and lint passed. Focused main workflow and exception checks passed **3/3**: clinical papers before checklist, Meera's INR115,000 net/INR25,000 patient settlement/INR90,000 insurer receivable, actual Nurse exit and immutable later insurer receipt, explicit return-to-bed and debt-retaining exceptional exit. These are synthetic checks, not ordinary records.

Transfer regression initially caught a native guard multiplying an already stored paise rate by100. Corrected only the new unapplied0059 source to use the original stored-paise formula; focused PostgreSQL transfer now passed **1/1**, including concurrent replay, exact10001-paise cutoff, adjacent stays, dirty-bed exclusion, authority withdrawal and native forgery rejection. Existing0000-0055 remain unchanged.

Runtime dependency audit: **0 vulnerabilities**. Full audit retains **5 HIGH development-tool findings** in braces/micromatch/fast-glob/Next ESLint dependency chain. npm proposes a breaking Next ESLint downgrade; no forced dependency change performed.

Independent review is in progress. Concrete native exception/source and return-withdrawal safeguards are being repaired and will receive fresh checks. Full local check, ordinary backup/migration/preservation, browser visual inspection and release gates remain pending. No ordinary migration, reset, reseed, account or credential change has occurred.

## Whole-suite checkpoint and review follow-up

The first full command passed **82 units** and **174 actual PostgreSQL tests in24 files** (748.49seconds). It was stopped after the integration phase so the final reviewed finance corrections can be applied before final acceptance. No claim of a complete full-command pass is made. Original preservation was rechecked: all 81 original tables / 46 rows,56 applied migrations and protected file hashes remain exact; four new migration source files are additional, unapplied drafts.

All four initial independent review findings are repaired and passed the focused6-test suite: legacy NULL-Doctor evidence bypass; late exceptional debt collection; current unperformed return/reconsideration; protected-file verification for exceptional delivery. A later delta review requires native responsibility provenance against actual payer allocation and receipt caps against corrected bills. That narrow follow-up is pending fresh proof. Availability now distinguishes effective current periods from later scheduled/expired versions; regression assertions added.

A private read-only ordinary backup was made before migration:462,203bytes, readable PostgreSQL custom archive, with metadata under ignored tmp/mvp-implementation/pre-migration-backup. Ordinary setup is intentionally empty of hospital settings, tariffs, beds and patients; preserve it and require actual Admin configuration rather than fictional ordinary seeds. Accounts and credentials are retained.

## Final acceptance preparation

Later-review fixes passed actual PostgreSQL: complete verified responsibility is derived natively, incomplete INSURANCE_DELAY exits can collect only against the exact later Admin-authorized insurance decision amendment, and receipts retain that amendment source. Wrong/stale/excess native sources and partial/replay/final collection are covered; original unknown authority/exit/PDF remain exact. Focused workflow3tests passed29.21seconds; earlier latest4-file7-test suite passed48.88seconds.

Browser iteration exposed renamed-label selectors and native wrapping-select label lookup; tests now use current accessible names/combobox roles, retaining all assertions. Actual Admin screenshot inspection found and repaired white-on-white Customize text and money-row wrapping; header controls now join contrast assertions. Clinical papers before checklist/finance and ordinary insured Nurse exit/later cash passed browser checks. New self-pay charge/return/checks journey reached vacancy, where a duplicate text locator was corrected to the actual summary.

The20-test browser stress run at6workers had widespread timeouts/connection waits while host free RAM was about1.6GiB of16GiB. Local Chromium correctness concurrency is now2; CI keeps its original auto worker selection. Assertions, timeouts and PostgreSQL concurrency regressions are retained. No broad stress-capacity claim is made. Provider error logging also exposed synthetic session parameters on connection failure; configured a nonsecret authentication logger and proved a failing-then-passing regression against the installed logger (17focused configuration tests passed).

A current complete local command, focused/full Chromium, recovery, final independent delta review, reviewed ordinary migration/preservation, copied runtime and exact development CI are still pending. No ordinary data/account/credential change or migration has happened.

## External billing and self-pay acceptance follow-up

The browser self-pay journey reached final finance and exposed PostgreSQL 42702: the finance guard's insurance-case JOIN alias conflicted with its PL/pgSQL record variable. A new actual PostgreSQL self-pay regression reproduced the failure with a zero net bill after a fully accepted medicine return. Migration 0060 replaces that function with only the two conflicting aliases renamed; all financial predicates remain exact and 0000–0059 source bytes stay frozen.

Scope review also found that externally performed consultation/procedure/consumable/lab/radiology charges lacked a version 2 entry path. Added a narrow Admin/Billing form and immutable performed-service source, current configured price/unit, issuer/invoice/unique line evidence, actual performed time, stale/replay protection, native atomic source pairing and selective check/finance invalidation. Linked reversals retain the source evidence. An independent read-only review accepted the new command, SQL and UI with no actionable findings. Focused PostgreSQL and browser verification are in progress; this is not a final gate result.


## Focused final flow proof

The new 6-file actual PostgreSQL gate passed **9/9** in 66.40 seconds, including self-pay zero-bill final finance/exit, all five external-service categories, concurrent/stale/forged sources, linked reversal, medicine return and selective invalidation, transfers, staff and ordinary/exception collections. Fresh production build passed. The 5-test actual Chromium MVP suite passed **5/5** in 50.1 seconds: Admin desktop/narrow, early clinical papers/denial, insured exit/late insurer cash/immutable PDF, configured performed-service charge+linked reversal/source retention, and full self-pay medicine return/checks/vacancy/finance/final papers/actual exit. Two intervening browser failures were expected success-wording and disappearing-success-form assertions; persisted-state assertions were corrected without changing commands, timeouts or financial expectations.

The fresh complete root check is running. Source-only review accepted 0060 and the new service flow; no ordinary migrations or account/data changes yet. All56 historical SQL files matchHEAD literally ; 399 local document links resolve.


Final root-delta read-only review accepted authentication-log privacy, public-v2/trusted-legacy boundaries, retained browser state/document assertions, contrast/money fixes and local browser concurrency scheduling with no new actionable findings. The complete command passed 83 units and is in the actual PostgreSQL phase. Fresh runtime audit remains 0; full audit remains5 HIGH development-tool findings.


The fresh full command passed **83 unit tests** and **176 actual PostgreSQL tests across 26 files** (1047.95 seconds). Lint, types, build, complete Chromium/HTTP and recovery are the remaining stages; no full-command pass is claimed yet.


## Complete-run browser findings

The complete command passed 83 units, 176 PostgreSQL tests, lint/types/build, then stopped with **76/81 Chromium tests passing** (4.0minutes). Four retained-workflow tests still expected old default navigation/Doctor routing; they now explicitly open retained Billing/Pharmacy workflows, use the actual verified-case management link for historical insurance follow-ups, and assert Doctor history as the allowed redirect while retaining access denials and all ledger/document assertions. One actual regression was found: the legacy Nurse shift overview enumerated new v2 episodes as charts. The page now filters to v1 before getCare, preserving all old charts and existing assignment error handling rather than suppressing errors. Focused rebuilt-browser proof and a fresh complete command remain required. Recovery did not run in this failed command. No ordinary migration occurred.


The rebuilt focused five-file browser run passed 13/14; the sole remaining failure was the insurance test checking for an optional collapsed panel before its actual navigation arrived. Waiting for the destination alert component to attach retained every visibility/follow-up/document assertion; both insurance tests then passed (37.7 seconds). All five affected files now have passing focused proof. Independent read-only review accepted the Nurse isolation and retained navigation delta with no weakened assertions or timeouts. A second fresh complete root command is running on this corrected source. Ordinary migration remains unapplied.


Second fresh complete command:83 units and 176 actual PostgreSQL tests across 26 files passed again (1007.12 seconds). It is continuing through lint/types/build/browser/recovery on the corrected source. No ordinary migration yet.


## Final local acceptance and ordinary migration

The second complete `npm --prefix web run check` exited 0:83 units, 176 actual PostgreSQL tests across 26 files (1007.12 seconds), lint/types/build,81 Chromium/HTTP checks (3.5minutes) and isolated recovery. Recovery matched 96 tables / 1,850 exact synthetic rows / 23 protected files and resumed the current human review exactly once. Fresh build identity: `DCQnVTOklKN1DGW4SyifJ`. Runtime audit remains 0; the full audit reports 5 HIGH development-tool findings without a forced breaking downgrade.

Applied only the reviewed 0056–0060 migrations using the dedicated limited owner. The post-migration comparison passed: all 81 original tables / 46 original rows, all 56 old SQL checksums/bytes, credentials/private files and native checkpoint records remain exact. There are 61 applied SQL versions. The original private backup and old previews remain retained. No reset/reseed, account rotation, ordinary patient/configuration seed, new provider/integration or deployment occurred.

All core, identity, service-billing, privacy and final legacy-isolation reviews are accepted. Actual development publication/exact CI and copied ordinary-preview checks remain the last release steps, recorded after commit in the ignored release evidence. Real hospital configuration remains an Admin task; this is local synthetic acceptance, not live hospital authorization.


## Final publication and running preview

Implementation checkpoint **0b99b436374a85c41f7530a7d4de02b6e150e301** is pushed on `codex/hims-development`. [Exact development CI](https://github.com/Prateek771/hims-inpatient/actions/runs/38718891980) passed in11m44s:83 units,176 PostgreSQL tests, lint/types/runtime audit/build,81 Chromium checks (1.9minutes) and96-table/1850-row/23-file isolated recovery. No flaky-test line was reported. Main remains unchanged and no deployment occurred.

The ordinary copied preview is `tmp/local-preview-task19-0b99b43`, BUILD_ID `DCQnVTOklKN1DGW4SyifJ`, bound to localhost/IPv6 loopback on3000. [Staff sign in](http://localhost:3000/login), liveness and complete PostgreSQL readiness returned HTTP200. The first cold probe timed out; subsequent checks through both localhost and its actualIPv6 listener passed unchanged. No ordinary authentication session or patient fixture was created by verification. The final after-preview comparison preserves all81 original tables/46 original rows,61 applied SQL/source hashes (including all56 original bytes), credentials/private files and native history.

Six routine staff workspaces and the whole approved local MVP are accepted. Ordinary settings, beds, patients and admissions remain empty; Admin enters the actual hospital configuration, rates, roster and staff responsibilities. AI paperwork remains manual and insurer verification stays external. Existing eight role identities/passwords and retained professional history remain available. Runtime audit0; full audit5 HIGH development-tool findings remain recorded.

Latest detailed nonsecret release evidence: ignored `tmp/mvp-implementation/release-evidence.json`; ordinary preservation: `after-final-preview.json`; original backup retained under `tmp/mvp-implementation/pre-migration-backup/`. Restart this exact copied preview from INS with `node tmp/run-local-preview.mjs tmp/local-preview-task19-0b99b43` only when3000 is free; retain old artifacts. Final handoff/plan observations were saved locally after the implementation commit; application source remains exactly the pushed, CI-passing commit.
