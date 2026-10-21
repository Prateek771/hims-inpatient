# Independent Figma revision acceptance checklist

14 October 2026. Basis: the complete owner-approved `docs/revisions/2026-10-14/revision-content.json` and corrected `tmp/revision-review/draft-review.md`. The owner's current approval permits a new Figma revision only; historical draft approval-pending sentences do not reopen that decision. App/backend implementation, ordinary data, staff accounts, Git, and the original Figma remain outside this work.

Status: **PASS for the Figma prototype; no unresolved blocking defect**. Final native/link/screenshot observations and the explicit controller-preservation evidence are recorded in `qa-review.md` and `qa-final-evidence.json`. Record actual evidence and concrete defects; prototype presentation does not prove server enforcement or working print/camera/forms.

## Preservation and editable duplicate

- [x] New file has a distinct key/name. Original `SHtJNa3gp1oqOpNm8VzcmQ` is unchanged: before/after fingerprints match on both original pages, including text, structure, styling, components and links.
- [x] Before revision, native duplicate proof matches the complete source: **2 pages, 96 views, 7,477 role-page nodes, 39 component-page nodes, 14 components, 4 component sets, 854 valid connections**. Preserve components/tokens/styles, fictional data and link destinations; report any counting convention explicitly.
- [x] Legacy clinical chart, stock and diagnostic screens remain as clearly labelled reference pages, outside the active revised prototype. They are not deleted from the actual app or presented as revised core navigation.
- [x] Revised screens use editable native frames/text/components. No screenshot/image-filled UI, flattened mockups, missing fonts, destructive component detachment or opaque text overlays. Fictional examples are easy to select and edit.

## Active journey and role authority

- [x] Demonstrated order: **responsible Doctor approval → assigned-Nurse published/printed checklist → required parallel department checks → actual Nurse-recorded bed vacancy/waiting location/handover → reconciled final Admin/Billing financial authorization → current pre-exit packet delivery → Nurse actual hospital exit → closure and staff-confirmed cleaning/availability**.
- [x] Both Doctor routes exist: responsible authorized Doctor digital approval; or assigned Nurse verification/capture of that Doctor's signed paper. Show clinical authorizer separately from recorder/verifier, source/evidence version and stated approval versus recording time. Unclear paper remains pending.
- [x] Current Doctor-approved summary/prescription/follow-up papers can be viewed/printed/delivered while finance/exit is pending. Their status does not imply exit permission; missing exit checks block the ordinary exit-authorized copy only.
- [x] Nurse owns checklist, nursing readiness, factual vacancy/handover and final exit; does not impersonate Doctor approval or settle finance. Pharmacy and each department clear only their own work. Insurance records externally verified decisions; Admin/Billing owns financial authorization/credit/exceptions. No universal role-wide approval button or misleading professional seal.
- [x] Department table visibly supports independent parallel status, named user/time/remarks, required/applicable labels and precise missing items. Billing can prepare concurrently; final authorization waits for required checks. Changed facts reopen affected checks/dependencies, retaining prior history.
- [x] Nursing proposes applicability; **Admin alone** confirms optional-department N/A with reason and no relevant service/pending work. N/A differs from clearance and must be reconsidered on new work. Doctor approval, Nursing readiness/exit and final finance have no N/A route.
- [x] Dashboard/Core menus follow permission: Dashboard, Patients/Admissions, Beds, Billing/Insurance, Discharge, Exceptions, Settings. Role-specific entry jobs replace detailed Doctor/Nurse charts, stock and diagnostic production. Shared UHID/IP lookup and View/Print appear where appropriate.
- [x] All eight active role entries and their navigation/overlay/back links lead to valid intended native destinations; no dangling, self, accidental cross-role or legacy-reference navigation. Every active revised view is reachable.

## Money, admissions and physical beds

- [x] Consistent Meera case: **INR 120,000 gross − INR 5,000 accepted medicine returns = INR 115,000 net**. Patient responsibility **INR 25,000** is settled by **INR 30,000 deposit − INR 5,000 recorded refund**. Deposit allocation is not another receipt; accepted return is not proof of cash refund.
- [x] At successful ordinary exit: verified/accepted insurer authorization or credit **INR 90,000**, actual insurer receipt **INR 0**, outstanding insurer receivable **INR 90,000**, patient due **INR 0**. Show acceptance/evidence, collection owner and due date. Never show zero overall obligations, cash received INR 115,000, or mandatory insurer receipt merely to exit this approved case.
- [x] Cashier/Billing controls allocations, manual existing-channel receipts and authorized refunds. No Pharmacy cash gate, automatic deposit spending, assumed live payment/payer integration or AI-set amount/approval.
- [x] Routine post-exit insurer collection retains the approved receivable and original discharged document; it does not require an exception just because the admission closed. Partial cover with settled patient responsibility or denial converted to settled self-pay can be ordinary. Exceptions retain real unmet obligations and actual authority.
- [x] Admission uses persistent patient ID and separate unique IP; lookup locates records without granting access. Admission/Admin acceptance and actual activation retain clinician instruction, current hold, tariff and required deposit; urgent exception retains deposit debt. Registration/reservation starts no room charge; pending cancellation preserves IP/history.
- [x] Ward → Room → Bed selection distinguishes capability, isolation suitability, category, AC/non-AC, tariff and physical state. No invented arrival/transfer/vacancy/exit time or forecast of future readiness.
- [x] Factual vacancy is the room-charge cutoff. Occupied-bed estimates remain provisional. Vacated-but-Held stays unallocatable through required exit/turnover; bed staff confirm cleaning before Available. Return to bed or changed charges requires relevant financial/packet review.
- [x] Admission, care, bed, discharge, patient settlement and insurer collection statuses remain separate. Financial clearance does not end ongoing clinical care before appropriate handover/exit.

## Documents, completeness and visual review

- [x] Daily/as-of, current pre-exit-authorized, exception and later closed versions are visibly distinct and attributable. Pre-exit packet shows identity/IP, clinical component papers, department statuses, financial approval, actual receipts/refunds and remaining receivable/exception. Pharmacy prints only its own reconciliation report.
- [x] Camera/file evidence capture, checklist print, missing-item alerts, financial review, packet delivery and Nurse exit affordances are visibly present, with prototype limitations identified honestly.
- [x] No implied removal of historical charts/stock/lab records, old professional seals, signed PDFs/hashes, identities or active-episode history from the app. Additive future backend adoption and reviewed active-episode transition are presented as future implementation, not completed capability.
- [x] Native inspection covers all revised views: text fits, intended content stays within frames, canvases do not overlap, status labels accompany colours, no clipped buttons/tables/footers or flat image UI. Screenshot review covers every role entry plus digital/paper evidence, parallel checks/N/A, occupied versus vacated bed, receivable authorization, pre-exit packet, Nurse exit and closed collection state.
- [x] Keep the existing calm hospital visual system, IBM Plex Sans, navy/teal, readable numbers and clear pending/blocked/approved/receivable labels. Financial and document details remain readable without compressing text to conceal overflow.

## QA evidence to record

New file key/page IDs and role-entry IDs; original before/after fingerprint results; initial native duplicate counts; current active/legacy view and valid-link inventory; native geometry/font/image/component results; screenshot node IDs; and each defect's priority, node ID, observed behaviour and approved criterion. Mark unreviewed items as pending, never pass by inference.
