# Pharmacy stock and medicines

> Version 1 contract and retained acceptance evidence. New admissions follow the approved [version 2 scope](PROJECT_SCOPE.md); [implementation progress](agent/MVP_IMPLEMENTATION_PROGRESS.md) records actual verification. Existing episodes keep the original rules described below.

Pharmacy works from the doctor's persisted medicine orders and current signed take-home prescription. Its view contains the patient/episode and medicine information needed for fulfillment, rather than an unrestricted chart. Administrator operations can record stock work but cannot supply the Pharmacy discharge seal.

## Stock and physical identity

Record the actual medicine, batch, expiry date, exact unit, barcode and delivery-line reference. Qualify the reference with the source/vendor or hospital book, delivery/document and line so it identifies one actual receipt. The receipt source belongs to the immutable physical batch; a new request key or another staff actor does not establish a second delivery. A legitimate additional delivery uses its own reference. Different batches can share a document reference; distinct lines to the same batch need distinct qualified line references.

The correction requires the same source and physical details to return its original result, conflicting details to fail, and native database protection to enforce the source identity. Independent re-review and the complete controller check accepted the correction. Stock receipts, issues, returns and authorized adjustments retain actor, time and original movement history. Administrator-only adjustments need a reason and cannot make stock negative or change the batch's identity. Reorder thresholds are optional first-batch configuration; absence is shown as unconfigured.

Stock labels retain the batch's original medicine name. A later catalogue name change cannot relabel old physical stock or authorize a substitution under the same code. Doctor-selected identity and exact units must match. Price-only updates can retain the same medicine while new issues use the current authorized price. Current catalogue identity and required price are one setting; absent/inactive configuration blocks normal new fulfillment visibly, while clinical orders, MAR and previous stock history remain.

Expiry is valid through the end of the entered date in the hospital timezone. Expired stock cannot be newly issued; attributable returns remain recorded and that returned stock stays unusable. Quantities use exact configured decimal scale. There is no tablet/strip, vial/ml or dose-to-stock conversion. Barcode entry/scanning validates the selected batch on the server.

## Issue, return and prescription preparation

Ward issue validates the actual order, episode, medicine and usable batch. Stock movement and its unique medicine charge commit in one transaction; nursing MAR never posts another medicine charge. Partial returns retain the original issue and rate, cap cumulative quantities and use cumulative original-price rounding. Full return reaches the original charged amount. A tiny zero-paise increment still records its real physical return without inventing a reversal amount. Conflicting unrelated financial credits require Billing reconciliation.

Take-home preparation issues physical stock against the latest signed prescription with exact order, batch, quantity and dispensing unit. It is separate from patient collection and the later Pharmacy seal. Existing net home issues are reused; only missing quantity is issued and charged. Changing batch requires returning the previously prepared stock. Old preparations remain immutable; stopped/removed orders, stale prescriptions, expired stock and stock/financial discrepancies remain visible. The current boundary is one batch per signed prescription line.

Medicine clinical orders remain ongoing: the first or partial stock issue does not prove a whole regimen completed. Pharmacy has its own actual fulfillment/reconciliation projection. The clearance and alert modules must use that projection rather than require generic clinical completion or classify every ongoing order as unissued. Current department reads require persisted medicine work; the no-medicine clearance projection belongs to the clearance module.

## Server contracts

`recordStockReceipt`, `issueMedicine`, `returnMedicine`, `prepareTakeHomeMedicines` and `getPharmacyReview` have supplied-transaction variants. `pharmacyWorkspace` supplies the operational worklist; `adjustStock` is administrator-only. Supplied callers acquire shared settings/staff advisory lock `729104211` before staff/request/admission and sorted batch locks. Current staff identity is rechecked even on completed retries. Mutable stock, source and price state is read after the governing locks; no nested pool transaction owns effects.

No procurement/vendor accounting, dispenser integration, automatic substitution, encoded-label generation, patient-collection confirmation or professional seal is introduced here. Insurance/payment integrations remain outside the authorized scope.

## Verification status

Independent review reproduced duplicate inventory from a repeated physical receipt with a fresh request key. The correction deduplicates the actual source under the stock/batch locks and adds native unique/canonical-reference guards. Maintained regressions cover competing actors/connections, quantity/detail conflicts, historical replay, current revocation, separate real receipts and duplicate-history migration refusal. Scoped independent review accepted the correction and migration-byte Git protection.

Fresh controller `npm --prefix web run check` exited0: **33 unit tests,28 actual PostgreSQL tests,lint,typecheck,standard production build and16 Chromium/HTTP checks at6workers**. Runtime audit returned0 vulnerabilities. An earlier unchanged room-worker import unit test timed out; its focused rerun, all unit tests and the fresh full check passed without source/timeout/check weakening. Reviewed ordinary migrations0016–0018 were applied afterward. Existing staff/accounts/settings hashes stayed identical (8/8/0); ordinary patient/admission/bed/hold/stay counts stayed0. All19 working SQL files match staged bytes; Git attributes prevent newline normalization from changing recorded migration checksums. No ordinary Pharmacy record or real financial policy was seeded. See [current build status](agent/BUILD_HANDOFF.md) for checkpoint and CI evidence.
