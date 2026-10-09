# Lab and radiology work

**Task9 is independently accepted and locally verified.** This guide records its actual operational contract. See [current build status](agent/BUILD_HANDOFF.md).

## Orders, identity and access

Lab staff work from persisted Doctor orders and their LAB-owned tasks. The operational view contains needed episode/patient identity, requested test, sample, processing, result and fee status, rather than the full chart. Current active LAB identity is checked even on successful old request retries. A guessed order, patient, sample or document ID does not itself grant access. Assigned Doctors see the actual human results and linked addenda in their existing scoped care history.

A collected sample has one stable generated ID and barcode bound to the actual order, patient and admission. A keyboard scanner enters that persisted barcode. Processing and report commands validate the scanned identity against the selected order on the server. A different patient's sample, a different order's sample and an unknown label fail before effects. Labels/barcode images remain authenticated and minimized. Radiology records processing and its human report without inventing a specimen.

## Human work and preserved history

Collection, processing, original report, addenda and an unperformed disposition retain actor, actual server signing time and source identity. The original report remains immutable; a correction appends text and a reason linked to that report. Repeated collection/report requests cannot create another actual sample, overwrite the original result or double-charge. Different replacement result text needs an addendum.

A Doctor stop prevents new collection/processing. Already collected material and its history stay recorded. Work processed before a later stop may still receive its attributable human report/addenda. A collected-but-unprocessed stopped test remains explicit operational/financial review; it does not become an automatically free, completed or newly authorized test. New reporting after physical episode closure remains subject to the later attributable exception workflow.

Only genuinely unperformed, Doctor-stopped work with no collection, processing or report can receive the narrow LAB disposition. It retains the stop and reason and reverses its exact original untouched pending source. Already finalized/adjusted/performed sources need separate authorized financial review; no cancellation tariff or automatic fee waiver is inferred.

## Charges and files

Actual report completion finalizes the original pending economic line once, preserving its ordered quantity, unit, source and pinned price. A tariff change after ordering cannot replace that price. A human report survives missing price configuration with explicit unresolved financial work. Later authorized source reconciliation records its reason and charge; a missing price never defaults to zero. Pending totals reflect linked reversals.

An optional report file UUID cannot represent an unverified file. Protected report-file attachment is unavailable in this stage and fails explicitly; human text reports are the implemented core path. There is no instrument integration, automated diagnosis, external insurer transmission or public barcode/report URL.

## Transaction contracts

Public commands include collectSample, startLabProcessing, recordLabReport, addLabReportAddendum, resolveLabBilling and disposeUnperformedLabOrder; the core effect commands have supplied-transaction variants. getLabOrder, lookupSample, getSampleLabel and labWorkspace provide purpose-limited projections. Commands validate strict input and one actor/request key. New reports and effectful source reconciliation require actual operational preconditions; ordinary post-closure reporting remains unavailable.

Effects use shared settings/staff lock729104211 before current staff, actor/request and the owning admission. The admission lock serializes actual source state with Doctor stops, price reconciliation and financial writes. Composition keeps one transaction owner. Native source/identity/immutability guards and limited runtime grants protect stored records; applied SQL bytes are never rewritten.

## Verification status

Independent specification and quality review accepted the frozen source with no blocking finding. Its guarded runtime probe passed12 assertions across actors/current-role changes, wrong Doctor/sample denial, one original10000-paise finalization, native stopped-processing refusal, unpriced disposition and immutable history; every probe change was rolled back and10 fixture counts preserved. The reviewer inspected live Figma4:8, all3 saved actual images, the complete staged diff,30 source hashes and19 prior SQL byte matches.

Fresh controller `npm --prefix web run check` exited0: **33 unit tests,33 actual PostgreSQL tests across9files,lint,typecheck,standard production build and17 Chromium/HTTP checks at6workers**. Runtime audit returned0 vulnerabilities. Maintained regressions cover source-net pending amounts and real blocked-backend signing chronology. Desktop/narrow/print images were inspected; keyboard input and browser print media were tested, with no hardware scanner/printer claim.

Reviewed ordinary0019–0022 applied after review/fullcheck. Complete staff/accounts/settings hashes stayed identical8/8/0; ordinary patient/admission/bed/hold/stay counts stayed0. All23 staged SQL files match their literal working bytes; old applied SQL was not rewritten. No ordinary Lab record or real hospital policy was seeded. Exact Git/CI and successor status are in the [build handoff](agent/BUILD_HANDOFF.md).
