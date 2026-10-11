# Hospital overview and staff worklists

Task 15 connects the overview and eight staff projections to authorized hospital records. The owner-approved 11 October role UI makes `/workspace` redirect to each role's actual worklist: Admin `/overview`, Admission `/admissions`, Doctor `/clinical`, Nurse `/nursing`, Pharmacy `/pharmacy`, Lab `/lab`, Insurance `/insurance`, and Billing `/billing`. Every principal page retains its authorized source alerts, evaluation time and permitted history. `/overview` remains Administrator-only. Reading these screens creates no task, charge, signature or other record. Human professionals retain their existing authority. Current implementation and verification are recorded in [UI progress](agent/UI_REDESIGN_PROGRESS.md).

## Work and access

| Role | Current work |
|---|---|
| Administrator | Occupancy, reservations, turnover, discharge blockers, operational alerts and permitted financial summaries; no private clinical notes or professional signing |
| Admission | Pending intake, actual deposit and activation checks, permitted admission history |
| Doctor | Their current admitting-doctor episodes, pending ordered work, diagnostics and the current Doctor discharge gate |
| Nurse | Active assignments, prescribed observations/MAR across shifts, incoming handover and the eligible Nursing gate |
| Pharmacy | Actual medicine issues/returns, current prescriptions, take-home preparation and shared inventory |
| Lab | Actual samples, processing, human reports, fee work and supported stopped-work disposition |
| Insurance | Currently assigned cases, source-bound manual paperwork review, missing documents, recorded external decisions, threshold and transfer follow-up |
| Billing | Deterministic responsibility, actual receipts/deposits/refunds, pending charges, financial clearance and departure work |

Authorization is enforced on the server using current account, role, assignment and episode/task purpose. Nurse, Pharmacy and Lab current work excludes closed episodes. The other permitted role lists retain at most the latest 50 closed episodes alongside open work. History remains available through authorized existing screens. Alerts have stable source/kind identities and show their responsible action. Resolved care, handovers, actual dispensing/reports, receipts and reassignment remove the corresponding current alert without erasing history. Saved accepted/rejected/stale paperwork is distinguished from a review still awaiting staff action.

Doctor/Admin transfer review uses the same current authority and retained factual witness state as care and discharge. Unperformed withdrawn orders leave history without a permanent blocker; a genuinely earlier actual move reported later still requires factual reconciliation. Pharmacy rows with a clinical summary but no medicine order open the authorized discharge review, where explicit empty-prescription clearance is available. Rows with medicine orders retain the preparation workspace.

Current insurer policy/decision/paperwork/limit requirements apply to the current insured payment route. Converting to self-pay retains case history and actual money without requesting impossible insurer work. Independently recorded manual pre-auth/enhancement/appeal follow-ups use each work item's latest OPEN/COMPLETED event, so unrelated case updates do not hide unfinished work. Such manual follow-ups may remain open on a converted self-pay case until staff actually complete them; completed history is retained. Current assignment still controls access.

## Query and money contracts

`getOverview(ctx, { asOf, bedCategory? })` requires Administrator access and a valid evaluation time. `getStaffWorklist(ctx, { asOf?, bedCategory? })` returns the permitted role projection. Both use a read-only repeatable-read transaction. `asOf` evaluates current records, deadlines, hospital-day boundaries and financial projections; it does not reconstruct a historical database snapshot.

The implementation uses `bedCategory` instead of the plan's proposed `wardId`, because this hospital model has physical beds/categories and no ward entity. Unknown categories and an unsupported `wardId` are rejected. The filter scopes episodes, beds, turnover, departure and money. Shared medicine stock remains hospital-wide, which the interface states explicitly.

The physical bed projection supplies exact category totals and ready, occupied, reserved, cleaning and disabled counts. Occupied requires an actual open effective room stay. An ADMITTED episode whose Nurse has recorded actual bed vacancy retains a reservation hold while money/departure work continues; it is not physically occupied. Category denominators include configured disabled beds. The five Home metrics and category bars use these same read-only source facts.

Money reuses the existing integer-paise bill and responsibility calculations. Insurer authorization, insurer cash actually received, net posted charges, retained patient cash and unallocated deposits stay separate. Missing or stale responsibility produces a visible review requirement and unknown dues, rather than zero. The financial cohort is open episodes plus the latest 50 closed episodes, not all-history hospital revenue. Configured thresholds and the visible 80% insurance default have distinct provenance; unconfigured stock thresholds do not mean zero stock. Query failures show unavailable data and retry guidance. The clearance projection checks current source hashes/versions and the earliest incomplete human gate without invalidating or issuing a seal; original clearance commands retain their existing invalidation behavior.

## Hospital time

Live staff screens use the current hospital IANA timezone. If no hospital setting exists, the existing Asia/Kolkata default is visibly identified as unconfigured. Timestamp adapters for admission, activation, clinical/nursing care, transfers, insurance, discharge/refunds and exceptions convert native hospital-local input on the server before calling the existing commands. The rendered timezone is checked against current settings; missing, stale or forged timezone context requires refresh. Invalid dates and ambiguous/nonexistent daylight-saving times are rejected before effects and require an unambiguous time. Native inputs retain millisecond precision; saved timestamps and immutable signed/document snapshots are unchanged. Displayed `<time>` elements retain their exact ISO instant in attributes.

## Verification and limits

Author verification includes actual guarded PostgreSQL role/access/resolution/no-write cases, original discharge regressions, all eight desktop/narrow role views, keyboard/table operation, long multilingual names, zero/large money, safe unavailable/loading states and a browser in America/Los_Angeles entering hospital Asia/Kolkata time. Frozen evidence is retained under ignored `tmp/task15/author-final`. The unavailable screenshot exercises an invalid category, not a simulated database outage. The brief loading test uses a bounded synthetic source-table lock and releases it promptly; it changes no grants.

The controller runs the documented `npm --prefix web run check` and `npm --prefix web audit --omit=dev`, verifies source/evidence hashes and all56 current SQL files (including the original54 unchanged bytes), and records exact results/review/CI/preview identity in [build handoff](agent/BUILD_HANDOFF.md) and [UI progress](agent/UI_REDESIGN_PROGRESS.md). Some existing per-episode financial/gate queries are reused; Nurse My shift also reads each authorized active care projection to present actual due/future work without a cap. No scale/load benchmark or real-patient/pilot-readiness claim is made. No dependency, schema migration, live AI/OCR, payer/payment integration or sender is added. Tasks1–16 are accepted; real hospital policies and access remain owner decisions in the [local pilot](LOCAL_PILOT.md).
