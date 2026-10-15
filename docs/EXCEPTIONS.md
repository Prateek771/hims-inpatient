# Accountable exceptions and corrections

## Version 2 exception contract

Assigned Nurse records external clinical disposition and factual movement; Admin records source-bound exception authority, reason, evidence and follow-up owner. A credit exception retains actual debt and absent checks. Planned exceptional papers must be generated, verified intact and delivered before actual Nurse exit. Return-to-bed needs current unperformed external instruction, Admin routing and completed actual turnover; consumed movements cannot be cancelled.

Later collection keeps original exit/papers intact. Originally complete responsibility uses the lower of original and current corrected party shares, less retained cash. An originally unresolved insurance-delay exit requires the exact later Admin-authorized insurance allocation amendment, current verified allocation, party remainder and remaining original-net limit; each receipt retains its amendment source. Post-exit financial changes use linked authority/amendments and the actual permitted staff role. Source: `web/src/server/mvp/{commands,exceptions}.ts`; native guards in0058. Version1 behavior below remains retained.


The exceptions workspace records an unusual hospital situation, the responsible person's decision, the supporting professional evidence and the remaining follow-up. Administrator authority routes work; Doctor and Nurse evidence records clinical decisions and actual events. Outstanding money and missing professional approvals remain visible. Task12 passed independent specification/quality review after the three clinical-freshness, corrected-witness and selected-access findings were fixed and reviewed by a fresh GPT-6.1 reviewer. Fresh controller verification passed 36 unit tests, 92 actual PostgreSQL tests across 12 files, lint, type checks, the standard production build and 26 Chromium/HTTP checks at six workers; runtime audit found zero vulnerabilities. Reviewed ordinary migrations 0000–0048 are current. Fresh before/after hashes preserve all 25 original records across all 61 original tables and columns; all 49 applied SQL files retain their literal bytes. No ordinary patient/policy seed, provider/integration or deployment was introduced.

## Hospital workflow

| Situation | Staff route and retained result |
|---|---|
| Urgent admission without the required deposit | Admin authorizes the named episode; Billing activates actual occupancy against that authority. The original configured deposit requirement and actual later receipts remain visible. |
| Unknown identity during urgent intake | Admission records truthful temporary identity and provenance without invented age, date of birth or contact. Later attributable identification adds a version; the original identity remains in history. |
| Delayed/denied insurer payment or agreed credit | Admin records the reason, authority and follow-up owner. Current deterministic insurer/patient obligations remain outstanding until actual recorded settlement. Planned exceptional departure requires appropriate professional evidence. |
| Abrupt early exit | The assigned Nurse records actual physical departure; Admin records the exceptional route. Unavailable Doctor advice remains explicitly unreviewed with a named follow-up owner. |
| Against advice, external transfer or death | The proper Doctor records the disposition and the Nurse records the actual physical event; Admin supplies routing authority. Admin cannot make a diagnosis, declare death or supply another profession's seal. |
| Unavailable approver/attendance | Admin records the unavailable professional and follow-up. An available original Nurse can close truthful attendance after departure; an administrative closure remains clearly distinct from a Nurse's signature. |
| Cancelled, never occupied admission | Narrow Admin authority permits the original deposit's actual linked return. No fictional discharge seals, occupied stay or inferred cancellation fee is created. |
| Return to bed during an active off-bed wait | Current Doctor instruction, actual Nurse handover and Admin authority create a fresh attributable priced stay. Previous vacancy, source tariff and cleaning history remain. Closed episodes do not regain occupancy. |
| Delayed actual transfer or final room cutoff correction | Proper original professional sources and Admin authority support the factual interval. Linked charge adjustments preserve original rates/cursors and account for occupied time. |
| Later collections or corrections after departure | Admin authorizes a specific original source and correction kind; the proper current professional or cashier applies the narrowly scoped change. Original notes, receipts and actual departure remain retained. |

The exceptional-exit transaction records actual bed cutoff and later hospital departure separately, catches up/corrects original-rate room money, closes the episode, releases its hold once and records one required cleaning task. An exceptional exit never asserts that missing ordinary seals exist or that unpaid amounts were received. Cleaning must be recorded before the bed can be reused.

## Current professional decisions

New Doctor exception facts, including source-related later review and return instructions, enter the clinical review sources and invalidate Doctor and dependent seals. An unconsumed return instruction blocks ordinary Doctor clearance. The Doctor can explicitly reconsider an unwitnessed instruction using `RETURN_CANCELLED` linked to that exact original instruction; the original evidence remains. A witnessed or completed actual return cannot be cancelled. Cancelled instructions cannot authorize a Nurse handover, new return authority or a priced return.

After reconsideration, ordinary signing still follows Doctor -> Pharmacy -> Nursing -> Billing. Nurse exception facts and corrected physical witnesses reopen Nursing and dependent Billing review. Pure Admin or financial follow-up leaves unrelated clinical approvals intact. The first ordinary vacancy follows its Nursing seal and does not invalidate that preceding review by itself. See [ordinary discharge](DISCHARGE.md).

## Physical time, witness and money history

Effective room stays, vacancy facts, current off-bed state, shift ends, turnover and patient identity provide shared current projections over immutable original records and linked amendments. Room worker, bill, attendance, availability, ordinary discharge and exception commands consume those same projections.

A changed final vacancy cutoff carries the correction's actual Nurse shift, signature and findings. The original time, Nurse, attendance and handover remain separately inspectable. If a later door-exit event corroborates an unchanged earlier valid vacancy, the earlier cutoff retains its original witness. A later Nurse whose shift does not cover a newly proposed earlier cutoff cannot certify that cutoff. Administrative cleaning scheduling remains separate from the physical witness.

Attendance guards check both insertion orders. Admission ownership and native physical-source locks serialize competing writes; a stale stronger-isolation writer must refresh/retry rather than commit contradictory history. Charge cursors never rewind, occupied time is never waived, and original pinned tariffs are preserved through linked reversals/adjustments.

Obligations reuse the shared [billing](BILLING.md)/[insurance](INSURANCE.md) projection. Authorization is distinct from receipts; allocation applies already received cash; refunds are linked actual returns limited by original remaining cash. Follow-up notes do not add receipts or change deterministic debt. Unpriced work and unknown payer responsibility remain unresolved. A deferred deposit requirement remains separate from terminal charge debt.

## Server access and interfaces

Current staff role, assignment, authority, episode state, source and request identity are enforced on the server. Selected details recheck assignment and re-read current identity/bed after admission ownership, before returning professional history, money or action bindings. The pre-lock worklist supplies navigation only. Doctor/Nurse evidence text is minimized from financial/operational views. Existing payer-review access revalidation remains in place.

| Interface | Purpose |
|---|---|
| `authorizeException` | Admin-only episode/type/disposition/authority/reason/evidence/follow-up record, optionally bound to a specific source/correction kind. Obligations are computed rather than supplied as replacement client totals. |
| `recordExceptionEvidence` | Proper Doctor/Nurse signed evidence with actual time, exact source and applicable shift. |
| `recordExceptionalDeparture` | One source-bound actual exceptional departure and its physical/financial effects. |
| `applyPostDischargeCorrection` | Current proper-role change bound to persisted Admin authority, original source and correction kind. |
| `applyDelayedTransfer`, `correctRoomCutoff`, `returnToBed` | Narrow professional-source-bound physical transitions and linked original-rate money. |
| `returnCancelledDeposit`, `closeUnavailableAttendance` | Distinct cancelled cash and unavailable-professional operations. |
| `identifyTemporaryPatient`, `recordExceptionFollowup` | Attributable identity version and accountable follow-up history. |
| `exceptionWorkspace`, `getExceptionReview` | Authorized current register, selected sources, obligations and history. |

Public commands require a server-built staff context. Composition uses the supplied transaction, shared settings/staff advisory lock before staff/request/admission and sorted physical sources. Original retry results still require current access. Native append-only/source/attendance/invalidation guards complement application checks. Applied SQL is additive and immutable.

## Current limits

One-sided correction of an already completed intermediate transfer/return boundary is denied without effects. Supporting it would require coordinated adjoining professional segments, attendance/source attribution and original-rate adjustments; this is not arbitrary historical repair. Supported delayed actual transfer and final-cutoff correction retain the contracts above.

Native wall-clock checks are scoped to exception evidence and administrative attendance; ordinary server actual-time and native bidirectional source/attendance/departure bounds remain the documented contract. This guide does not imply complete native ordinary wall-clock enforcement.

Versioned final discharge copies/PDFs, bounded manual paperwork and local pilot safeguards have their own contracts. No insurer/payment connector, AI approval, live provider selection or production readiness is implied.

The later-correction form offers `REVERSE_CHARGE` for a remaining original non-room line and `CARE_BILLING` for originally retained performed unpriced consultation/consumable sources. Both bind to Admin authority, source identity, current bill version and exact persisted result. Billing/Admin executes the bounded reversal; the original source's proper current Doctor or assigned Nurse resolves the care source. Original money, records and departure history remain, and changed document sources require a new reviewed final-copy version. New clinical work after exit is unavailable.

For Doctor `DEATH`, `EXTERNAL_TRANSFER`, `AGAINST_ADVICE` and planned financial exceptional exits, selected actual professional facts cannot occur after the witnessed hospital exit. Signing later to retain a genuinely earlier fact is permitted. Planned `CREDIT`, `INSURANCE_DELAY` and `INSURANCE_DENIAL` cannot use an old plan over a pending uncancelled `RETURN_TO_BED`. The Doctor must record source-bound cancellation or an actual attributable return followed by a fresh appropriate planned exit. This is rechecked at authority and departure and guarded natively. A truthful unplanned `EARLY_EXIT` still records the actual event and retained obligations without fabricated advice or seals. Delayed factual moves before transfer withdrawal retain the qualification in [Transfers](TRANSFERS.md).
