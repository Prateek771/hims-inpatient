# Human clearances, settlement and departure

> Version 1 contract and retained acceptance evidence. New admissions follow the approved [version 2 scope](PROJECT_SCOPE.md); [implementation progress](agent/MVP_IMPLEMENTATION_PROGRESS.md) records actual verification. Existing episodes keep the original rules described below.

The discharge workspace coordinates four human reviews, actual money records and physical departure. Task11 passed independent specification/quality review and the complete application checks; checkpoint progress is recorded in [build handoff](agent/BUILD_HANDOFF.md). Insurer and payment-service communication remains with staff through their existing channels.

## Staff sequence

| Clearance | Who signs | What they review |
|---|---|---|
| Doctor | The admission's authorized Doctor | Signed diagnosis/course/condition/advice/follow-up, explicit prescription, orders, results, corrections and transfers |
| Pharmacy | Pharmacy staff | Actual ward/home issues and returns, current prescription/preparation, administration reconciliation, medicine money and current medicine identity/expiry |
| Nursing | A currently assigned Nurse | Chart, administration/addenda, consumables, shift/handover/transfer records and attendance covered by the review |
| Billing | Billing or Admin | Current room/department charges, unresolved work, verified payer responsibility, actual receipts/allocations/refunds and separate party dues/excess |

Staff can prepare work beforehand. Formal signing follows Doctor -> Pharmacy -> Nursing -> Billing. Admin cannot issue another profession's seal. A signed empty prescription still requires Pharmacy review. Medicine issue quantity does not prove that a dose was administered, and generic clinical task completion does not substitute for actual pharmacy reconciliation.

Summary-only Pharmacy work opens this discharge review and its real Pharmacy signing form. Episodes with medicine orders, including take-home-only orders, retain the medicine preparation workspace. Doctor transfer withdrawal is attributable original-order history; shared effective transfer state blocks only current authority or a retained actual move awaiting factual recording.

Every seal retains its inputs, signer, role, actual signing time, review hash, reason and predecessor. Billing also binds the bill version. The server checks current staff access and assignment before mutations and historical retries. A changed source reopens the affected review and its successors: ordinary money changes reopen Billing; medicine/MAR changes reopen Pharmacy onward; routine nursing records reopen Nursing onward; clinical summary/order/result changes reopen Doctor onward. Previous signatures remain in history.

Nursing clearance covers the records and hours through that review's signing time. An open shift is shown as open. Financial clearance does not end attendance or stop prescribed monitoring. Later actual care remains attributable and can require another Nursing/Billing review.

A recorded bed vacancy must fall within the Nurse's attendance. Recording an earlier shift end afterwards cannot remove that fact. Application and native database guards check both event orders and concurrent writes; ending the shift exactly at vacancy remains valid. [Accountable exceptions](EXCEPTIONS.md) provide source-bound factual attendance closure after departure and distinctly recorded unavailable-professional authority.

## Actual bed use and hospital departure

The build uses **actual physical bed use** as the room-charge interval. The Nurse records a real bed vacancy, waiting location and handover after the first three current seals. The transaction catches up the original pinned room tariff through that exact cutoff and closes the stay. It retains the admission, bed hold and care while Billing completes settlement.

Billing can then review a stable actual room amount and sign. Staff separately record the later actual hospital departure. Its transaction rechecks current clearances, medicine safety, the reviewed bill version and party settlement, releases the hold once and creates one cleaning task. A final Billing seal alone does not release a bed. Admin/Admission records actual cleaning completion and evidence before another reservation or transfer can use that bed.

Occupied time cannot be frozen or treated as a free waiting interval. An attempted departure while the bed is still occupied commits legitimate room catch-up and returns a new review requirement, without recording hospital departure or releasing the hold. A factual cutoff behind already posted history requires an attributable correction rather than an invented later time. A return to bed needs proper clinical authority and a new attributable priced stay, preserving the prior vacancy/history. [Accountable exceptions](EXCEPTIONS.md) implement those narrow transitions, including proper source-bound Doctor reconsideration before an ordinary departure when a return instruction remains pending.

This distinction is an implementation judgment, not an approved policy for a particular hospital. A hospital charging until its door exit regardless of physical bed use needs a revised documented charging contract before real financial use. Actual vacancy and hospital exit must always remain separate facts.

Exceptional selected Doctor disposition facts must have occurred no later than the Nurse's actual hospital exit; later retrospective signing is legitimate. Planned financial exceptional exit also rechecks outstanding return-to-bed instructions. A source-bound Doctor cancellation or actual return followed by a fresh plan is required. A truthful unplanned early exit remains available with retained debt, follow-up and missing seals. See [Exceptions](EXCEPTIONS.md) for current native/application source rules and later financial amendments.

## Actual cash and responsibility

Billing owns the money projection reused by [Insurance](INSURANCE.md) and discharge. Authorization never counts as received money; allocation applies existing cash and adds no receipt. Original receipts and allocations remain immutable. Cancellation appends a linked record and restores held cash; a refund appends a linked actual return and subtracts retained cash once.

Refunds and allocation corrections require the first three current human seals and the exact Gate4 review/bill version. Staff record the original receipt, amount, mode, channel/book, source reference, evidence, reason and actual refund time. The server limits a refund to remaining original cash and the reviewed party's actual excess. Request identity and refund-reference identity independently prevent duplication. The software records the manual transaction; it does not transfer funds.

Ordinary insured clearance needs a current complete responsibility allocation, the insurer money actually owed, patient settlement and resolution of excess/held deposits. Unknown or stale party responsibility is shown as awaiting review. Self-pay has no insurer-receipt requirement. After conversion, a renewed self-pay review caps the insurer share by the original resolved share, cash still retained after refunds and current net bill; new self-pay charges cannot recreate unverified insurer debt. Original conversion, receipts and refunds remain visible.

The verified synthetic example has a ₹115,000 net bill, ₹90,000 received from the insurer, a ₹30,000 patient deposit and an actual ₹5,000 refund. The hospital retains ₹115,000 with nothing outstanding. Without the insurer receipt, ordinary insured clearance remains blocked.

## Server interfaces and later work

The public operations require a server-built staff context:

- `getClearanceReview(ctx, admissionId, gate)` supplies the caller's professional inputs and status/history. Billing alone gets the typed bill from that same locked transaction; it receives no Doctor chart or Nursing handover narrative.
- `issueClearance(ctx, { admissionId, gate, expectedReviewHash, expectedBillVersion?, reviewNote? })` signs the current reviewed inputs; Billing requires the exact bill version.
- `recordRoomVacated(ctx, { admissionId, shiftId, vacatedAt, waitingLocation, handover, requestId })` records actual Nurse-attested bed vacancy.
- `recordDeparture(ctx, { admissionId, departedAt, expectedBillVersion, requestId })` returns the recorded departure or committed `REVIEW_REQUIRED` amounts/version.
- `completeBedTurnover(ctx, { turnoverId, completedAt, evidence, requestId })` records real cleaning.
- Billing's `refundReceipt`, `cancelAllocation` and `reviewSelfPayResponsibility` preserve actual linked money history.

Composition uses the supplied transaction with shared advisory lock `729104211` before staff, then request/admission and the existing sorted physical-source locks. No nested pool transaction is opened while holding the admission. Source-linked native triggers append invalidations; unassigned stock operations do not acquire other admissions in reverse lock order. Dynamic medicine safety handles expiry/catalogue changes without a multi-admission trigger.

[Accountable exceptions](EXCEPTIONS.md) implement premature/unsettled exits, cancelled deposits, supported retrospective physical corrections, later collections and attributable post-discharge amendments. Versioned final documents consume the stored departure/Billing seal and predecessor inputs; they must retain actual room end, later hospital exit, reviewed attendance coverage and outstanding obligations. No AI approval, external payer/payment connector or deployment is implied by these interfaces.
