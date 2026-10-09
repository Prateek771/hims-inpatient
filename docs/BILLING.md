# Billing and admission activation

The billing workspace records hospital charges and money staff received through existing hospital channels. It does not contact a bank, insurer or payment service. Receipt references are staff-entered evidence, not bank verification. Current acceptance evidence is in [build handoff](agent/BUILD_HANDOFF.md).

## Configuration and activation

Administrators configure bed categories, fixed initial deposit slabs, room tariffs and billable items through versioned settings. Items have a stable code, source department, category, unit and permitted decimal quantity scale. Price changes create a new version; older events retain their original price. A different dispensing or charging unit requires a different item code, never a guessed conversion.

Missing, inactive or invalid settings block the affected financial operation. An administrator explicitly saving a zero price is a recorded policy decision, distinct from missing configuration; it does not waive a separately configured deposit. Nonzero room grace requires the explicit `deduct-once` mode: subtract the allowance once per stay, then apply the selected elapsed-time or started-unit rule. No tax, discount, package or hospital rate is assumed.

Admission staff record actual patient deposit/top-up receipts and activate the reserved episode after the configured minimum is satisfied. Activation checks the current admission version, reservation and policies in one transaction. Its occupancy time means the actual start of bed use, must follow registration and reservation, and cannot be in the future. A reservation alone does not start charging. An arbitrary exception ID cannot bypass the deposit requirement.

## Money and history

- Money is integer paise. Explicit decimal quantities use exact arithmetic and half-up rounding to paise; the interface displays INR.
- Deposits remain held cash until allocated. Allocation applies an existing receipt to a bill and creates no second payment. It cannot exceed available deposit or bill balance.
- Charge posting, finalization, linked reversals, receipts and allocations preserve immutable history, actor, time, reason and retry identity. A finalization changes the original pending line's effective state without another charge.
- Receipt identity includes hospital, payment mode, channel/book/account and source reference. Retrying with a different request key cannot silently count the same receipt twice. Conflicting reused references fail; different cash books may have their own receipt numbering.
- Insurer authorization and actual insurer cash remain separate. Payer responsibility belongs to the insurance workflow; recording insurer cash does not approve coverage or satisfy the patient admission deposit.
- Cancelled, never-occupied episodes with held cash remain visible for administrative resolution. Refunds are blocked until the relevant audited discharge or exception workflow exists; cancellation does not erase cash.

Only administrator/billing financial projections and a limited admission deposit/activation view are available. Clinical details are not added to the billing view. Department charge commands must validate a persisted operational source; arbitrary posting and standalone finalization are blocked until those workflows exist. The transaction interface permits doctor-created pending lab fees and lab-owned completion, retaining the original source and price. [Pharmacy](PHARMACY.md) posts each actual medicine issue once; MAR adds no charge. Returns retain the original rate and cumulative rounding with a source-linked reversal, including physical zero-paise increments without fake financial lines.

## Room charging

Each stay pins its tariff version and uses a half-open time interval. Reconciliation calculates cumulative due and posts only its difference from the persisted amount. This prevents rounding each polling fragment separately. Database locks, unique source events and persisted cursors protect retries, concurrent workers and restart catch-up. A cutoff later than server now is rejected without posting or advancing its cursor. A final cutoff earlier than already posted history requires an explicit correction workflow.

Reading or refreshing a bill estimates room charges without posting. Staff can explicitly reconcile. The worker is a separate process and is not installed as a Windows service:

```powershell
npm --prefix web run billing:room-worker
npm --prefix web run billing:room-worker -- --watch
```

The first command performs one pass; `--watch` polls every 60 seconds. Importing the worker does not start it. Transfer and final-bill commands reuse the transaction reconciliation primitive so closing a stay and billing its exact cutoff can be atomic.

## Remaining workflows

[Transfers](TRANSFERS.md) reconcile the old pinned stay to the factual move boundary and start the new pinned tariff at the same instant. The original room cursor and consumable source remain protected. A normal move cannot backdate behind posted charges or overlap destination occupancy; corrections belong to the attributable exception workflow.

Department sources, verified payer responsibility, discharge gates, refunds and administrator exceptions follow in their owning build tasks. Formula deposits, taxes, discounts, packages and doctor-specific fee schedules are not currently offered. The ordinary local database has no seeded hospital financial policy. Use guarded synthetic fixtures for testing; real hospital policy must be entered by authorized staff.
