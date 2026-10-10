# Exact inpatient transfers

The doctor records an attributable transfer decision for the current admission and occupied stay. A currently assigned nurse records the actual move, destination bed and handover within their own attendance. Administrator access does not substitute for either signature. Newer doctor decisions supersede older unconsumed decisions through an admission-specific version, rather than timestamp ordering.

The current Doctor may withdraw a truly unperformed current order from the clinical chart with a reason. An immutable cancellation retains the original authority, Doctor, signing time and reason. Completed or superseded orders and a retained same-source Nurse `TRANSFER_HANDOVER` cannot be withdrawn. Actual transfer and withdrawal serialize on the admission; only one prospective outcome succeeds. Care, Doctor/Admin worklists and discharge use the same effective state, so an unperformed withdrawn order no longer leaves an impossible discharge blocker. Closed episodes cannot acquire a new withdrawal.

A withdrawal does not erase a genuinely earlier physical move discovered later. A Nurse may retain delayed factual handover only when its actual time precedes withdrawal. The existing source-bound Admin `DELAYED_TRANSFER` path may record that earlier move against the original latest order, attendance, physical amendment and exact witness. Prospective moves after withdrawal fail. A retained earlier witness requires factual reconciliation before discharge; after reconciliation the order is completed while cancellation history remains. The existing limit on recovering an order superseded by a newer order remains; no invented move or coordinated intermediate-boundary correction is provided.

## Actual move and retained history

The old stay ends exactly when the new stay begins. The same transaction reconciles old-room charges to that boundary, closes and opens the stays, moves the physical hold and admission pointer, records the signed handover and creates any insurance follow-up task. Each stay retains its original tariff. Consumables remain attached to the bed/stay/unit where used; medication records, prescribed occurrences and overdue work remain intact.

The destination needs a configured category and tariff, current availability and a consistent physical occupancy history. A backdated move cannot intersect another patient's earlier stay merely because the bed is free now. Half-open intervals permit the exact previous departure time as the next arrival. Database guards also reject overlapping physical stays, including competing transactions; existing inconsistent history fails migration rather than receiving an invented repair.

Actual transfer time cannot be in the future, before the occupied stay or doctor authority, before an already posted room cursor, or behind finalized actual care that would contradict the source stay. Future prescribed care does not block a present move. A shift cannot subsequently end before its signed transfer handover. Retrospective corrections needing a different posted boundary belong to the attributable exception/amendment workflow; the normal command never fabricates a later time.

Insured moves create a persistent task owned by insurance staff. This records work to do; it does not call a payer, approve coverage or record receipt of money. Case assignment and task resolution belong to the insurance module. Self-pay moves create no payer task.

## Server composition

- `orderTransfer(ctx, { admissionId, destinationCategory, reason, requestId })` returns the immutable doctor's transfer-order ID.
- `cancelTransferOrder(ctx, { admissionId, transferOrderId, reason, requestId })` appends the current Doctor's source-bound withdrawal.
- `transferAdmission(ctx, { admissionId, transferOrderId, targetBedId, handover: { shiftId, notes }, transferredAt, requestId })` returns `{ oldStayId, newStayId }`.
- Supplied-transaction variants compose without nested pool transactions. They acquire shared settings/staff advisory lock `729104211` before staff or admission locks, then current staff, actor/request identity, admission and affected physical beds sorted by ID. Outer composing callers must preserve this order.
- `endShiftInTransaction` retains the existing staff/request/admission order and checks actual transfer times alongside observations, MAR and consumables. A caller composing it with transfer takes the shared configuration lock first.

Retry keys bind actor, action and payload. Repeating a successful transfer returns its original stay IDs after current access is rechecked. Changed payload, superseded or consumed authority, revoked assignment and mismatched admission/stay fail. Nurse care reads expose operational history and availability without financial amounts or unrestricted doctor notes.

## Verification status

Task7 independent review reproduced historical destination overlap and early shift closure after an initially green aggregate check. Both corrections have maintained actual PostgreSQL regressions, including distinct backend contention, equal boundaries, rollback, migration preflight and stale repeatable-read rejection. Scoped specification and quality re-review accepted both fixes with no blocking finding. The controller's fresh complete check passed 33 unit tests, 20 actual PostgreSQL tests, lint/types, the standard production build and 15 Chromium/HTTP checks. Runtime audit found zero vulnerabilities. Reviewed ordinary migrations `0013–0015` were applied afterward; all eight staff/accounts and empty settings retained identical hashes, and ordinary patient/bed counts remained zero. See [current build status](agent/BUILD_HANDOFF.md) for Git/CI acceptance. No ordinary patient or hospital financial policy has been seeded.
