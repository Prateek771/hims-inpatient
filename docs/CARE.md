# Clinical care and nursing

Doctor and nursing work belongs to the admission episode. The recorded admitting doctor owns clinical care; a nurse needs a current persisted assignment. Administrator scheduling authority can grant or revoke assignments but does not confer clinical chart access or professional signing authority. All protected server commands recheck current staff identity and episode access, including completed request retries.

## Doctor workflow

The doctor records signed rounds and medicine, lab, radiology, procedure, diet or vitals orders. Original notes are retained; corrections are signed addenda with a reason. Persisted orders create stable department tasks and scheduled nursing occurrences. Stopping an order records an attributable event rather than deleting its history. Signed clinical summaries and take-home prescriptions have immutable versions; these are clinical records, not the later discharge clearance seals.

Medication purpose is explicitly ward, take-home or both. Ward monitoring uses the clinician's structured start, interval and occurrence count. The software does not infer a schedule from free-text frequency or a ward protocol. Take-home-only medicines create no ward MAR or overdue alert. A take-home prescription retains dose, dose unit, route, frequency and duration separately from its explicit dispensing quantity and unit.

The doctor selects a configured medicine identity/version without access to pharmacy stock or price. Unconfigured clinical instructions remain recorded, but pharmacy must not infer a different stocked drug from free text. Attributable professional identity resolution is required before fulfillment; changing a regimen belongs to the doctor. No automatic tablet/strip, vial/ml or dose-to-stock conversion is permitted.

## Nursing workflow

Assigned nurses record attributable shift boundaries and handover. Ending a shift preserves its history and pending prescribed occurrences; the next shift does not recreate or erase overdue work. Explicit assignment revocation removes current chart/write access while retaining past records. Ordinary revocation requires existing open shifts to be ended with their handover; administrator exception handling must not manufacture a nurse signature.

Observations retain scheduled time, actual time, readings and signing identity. MAR records retain the prescribed order, scheduled occurrence, actual dose/unit and GIVEN, HELD or REFUSED outcome; held/refused outcomes require a reason. Factual late entries may use an owned ended shift when actual care was within that shift and before an applicable doctor stop. Signing time is current, and access must still be assigned. Future, outside-shift or post-stop ordinary records are rejected. Corrections append nursing addenda.

Consumables remain linked to the episode and the bed/stay/unit where used. Medication administration never creates a second medicine charge: pharmacy issue owns that financial event. Nursing financial clearance will not itself stop monitoring.

[Transfers](TRANSFERS.md) require a current doctor's versioned decision and the assigned nurse's actual handover. Existing orders, occurrences, MAR and consumable locations survive the move. A shift cannot end before its signed transfer; both transfer and closure recheck attendance under the admission lock.

## Charges and configuration

Clinical documentation is retained when fee configuration is absent or mismatched. An explicit unresolved billing task identifies the gap; missing configuration never becomes a zero-price default. Source IDs, configured rate versions and transactional posting prevent retries from duplicating a fee. Procedure task completion and billing status remain separate. Lab/radiology completion and pharmacy stock fulfillment are implemented in their subsequent modules. See [billing](BILLING.md).

## Current limits and verification

Normal ward medication currently requires an explicit scheduled mode. PRN/as-needed/SOS ward instructions are rejected with a visible explanation rather than assigned an invented schedule; the hospital's existing clinical process is required until an unscheduled workflow is added. No medical decision, dosage recommendation, automatic substitution, insurer transmission or professional discharge seal is produced here.

Independent specification and quality review accepted Task 6 after fixing a demonstrated procedure-rate race. Resolution now rereads the mutable source under its admission lock and retains the first saved rate/reason; a synchronized PostgreSQL regression verifies actual completion still charges INR 100 after a competing request and a configured change to INR 999.

The controller's complete application check passed 33 unit tests, 12 actual PostgreSQL tests, lint, type checks, the production build and all 14 Chromium/HTTP tests. Care checks include persisted retry deduplication, revocation versus writes on separate database connections, factual late entries, immutable corrections and preserved overdue work. Runtime audit reported zero vulnerabilities. Reviewed migrations `0009–0012` were applied afterward; hashes of all eight ordinary staff/accounts and empty settings remained unchanged, with no patient or policy seed. Check [build status](agent/BUILD_HANDOFF.md) for checkpoint/CI status. Tests use only guarded synthetic records; this feature does not establish readiness for real patient use.
