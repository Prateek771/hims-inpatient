# Fictional hospital: testing the six dashboards

This document describes the owner's existing local training installation. For a separate clone with fresh accounts and its own sample patients, follow [the clone demo guide](CLONE_DEMO.md); its four starter cases differ from the historical examples below.

Configured in the existing local PostgreSQL application on **15 October 2026**, at the owner's request. Open [the local application](http://localhost:3000/login).

**Lotus Grove Demo Hospital** is entirely fictional. Its prices, patients, external Doctors, insurer, paperwork, receipts and approvals are training examples. Existing staff accounts, passwords and original data are retained. Nothing was reset, bootstrapped or deployed.

## Current practice set — 19 October 2026

Latest illustrated example: [Sameer's focused admission-to-discharge guide](../output/pdf/sameer-admission-to-discharge-visual-guide.pdf), with full portal pages and button arrows. **Demo Sameer Khanna · IP-2026-00014 · G-104 · insured** completed the entire local cycle and signed handover. Net bill₹2,900; patient retained₹900; refund₹1,100; insurer cash₹2,000 after exit; receivable₹0; G-104 Ready. Original final paper/exit unchanged. This adds one episode to the snapshot below, bringing the current total to **14 patient/admission episodes**, with16beds and14staff. Existing staged cases and credentials remain intact. Review this completed example rather than repeating its receipts or exit.

The hospital was expanded additively after the six-dashboard UI review. It now has **16 beds, 13 patient/admission episodes, 14 staff accounts, three external Doctors and six priced catalogue items**. All seven earlier episodes and original accounts/passwords remain. The earlier 15 October starting states below are historical; use the live app for current balances and status.

| New patient / admission | Bed / route | Starting point and next action |
|---|---|---|
| Demo Ananya Rao · IP-2026-00009 | G-107 · self-pay | Pending reservation. Admission records the configured ₹3,000 deposit and actual arrival; Admin then assigns Nurse responsibility and Nurse starts the care shift. |
| Demo Kabir Sethi · IP-2026-00010 | G-108 · self-pay | Ongoing assigned care, ₹3,000 deposit. Five medicine packs charged, one accepted return: ₹400 posted medicine. External Doctor instruction is not yet recorded. |
| Demo Tara Mehta · IP-2026-00011 | P-205 · insured | Ongoing care, ₹2,000 deposit and ₹300 medicine. Assigned Insurance case awaits verified policy and external payer decision. |
| Demo Arjun Iyer · IP-2026-00012 | P-206 · self-pay | ₹5,000 deposit and ₹400 medicine. Doctor instruction/checklist and Nursing readiness recorded; Insurance/Diagnostics confirmed N/A. Pharmacy reconciliation is pending. Vacancy and financial work follow. |
| Demo Pooja Nair · IP-2026-00013 | G-105 · self-pay | Physical vacancy recorded, bed held, all checks resolved. Frozen bill ₹1,400, deposit ₹3,000, allocation ₹1,400. Billing must record ₹1,600 actual refund, then final finance; authorized papers, Nurse actual exit and Admin turnover remain. |
| Demo Rohan Desai · IP-2026-00008 | G-104 · insured | Completed browser walkthrough: ₹2,900 net bill, ₹900 patient retained, ₹1,100 refund, ₹2,000 insurer cash received after exit. Original final PDF unchanged, care shift ended and G-104 Ready. Review retained history rather than replaying the actions. |

Four beds were added: G-107/G-108 (General) and P-205/P-206 (Private), using existing tariffs/deposit rules. G-104, G-106, P-203, P-204 and H-302 were Ready in the final snapshot. No category, tariff or catalogue setting was overwritten. Open occupied stays accrue room units; use the live bill. Pooja's stated total is stable because vacancy is recorded.

Use existing role-name logins for the prepared cases: the existing Nurse owns the active patients and existing Insurance owns the new insured case. Added named accounts are **Demo Mira Kapoor (Admin), Demo Neel Joshi (Admission), Demo Asha Menon (Nurse), Demo Ved Jain (Billing), Demo Ritu Shah (Pharmacy), Demo Ishan Bhat (Insurance)**. Their emails/password remain only in the owner's ignored `tmp/section-review-2026-10-19/new-staff-logins.txt`; this private handoff is not distributed with a clone. Fresh installations generate their own credentials through [the clone demo guide](CLONE_DEMO.md). Existing passwords were not changed. The new Nurse/Insurance accounts are unassigned; Admin must deliberately assign responsibility before they can work those cases. This restriction was verified in the browser.

Recommended first exercise: **Pharmacy → Arjun**, then **Billing → Pooja**, then **Admission → Ananya**. For the full roles/sections and completed patient cycle, read the [dashboard review](agent/DASHBOARD_SECTION_REVIEW.md). Current desktop screenshots and mobile/access checks are linked there.

Preservation proof retains all original 560 non-counter rows across96tables and134protected files; exactly six new admission-counter increments. Final snapshot836rows/138files. Pre-addition backup and additive setup journal are retained privately in `tmp/section-review-2026-10-19/`. No migration, reset, deployment or existing-data replacement occurred. Never replay the completed setup over later training progress.

## Sign in and switch roles

Use the same existing password and role names: `admin`, `admission`, `nurse`, `pharmacy`, `billing`, `insurance`. Sign out through the profile menu before switching, or use separate browser profiles. The private credential handoff remains in ignored `tmp/development-logins.txt`; no password is included here.

The application permits five sign-in attempts per minute from one browser/network source. If a sixth role switch is throttled, wait a full minute before retrying. Role restrictions still apply. Nurses see assigned patients and Insurance sees assigned cases. Choose **All patients** if a case is absent from **Needs action**.

## Original configuration — 15 October 2026

The tables below describe the original setup. The four added beds and later patient states are listed above; prices remain unchanged.

### Beds, deposits and prices

| Bed category | Beds | Room price per started 24 hours | Self-pay deposit | Insured deposit |
|---|---|---:|---:|---:|
| Demo General Ward | G-101 to G-106 | ₹1,200 | ₹3,000 | ₹2,000 |
| Demo Private Room | P-201 to P-204 | ₹2,500 | ₹5,000 | ₹2,000 |
| Demo High Dependency | H-301 to H-302 | ₹4,000 | ₹10,000 | ₹5,000 |

All bed labels begin with “Demo”. Deposits are required and room tariffs have no grace period: even a short occupied stay consumes the first started 24-hour unit. Registration alone does not start room charges. An open occupied stay can accrue another unit after 24 hours; use the current bill rather than assuming yesterday's total.

Six beds are initially available: **G-104, G-105, G-106, P-203, P-204 and H-302**. Three beds are physically occupied; three are held, comprising one pending reservation and two vacated rooms awaiting patient exit/turnover. Physical vacancy does not itself make a bed reusable.

| Configured service | Training price |
|---|---:|
| External consultation / visit | ₹800 |
| Minor procedure | ₹1,500 |
| Medicine pack | ₹100 |
| Dressing kit | ₹150 |
| Blood count | ₹400 |
| Chest X-ray | ₹700 |

These are configured catalogue prices, not editable arbitrary charges. MVP Pharmacy records patient medicine bills/returns; these examples do not create the historical workflow's batch-stock inventory or prescriptions.

The external Doctor directory contains **Dr Demo Anika Rao**, **Dr Demo Vikram Sen** and **Dr Demo Farah Ali**. The existing Nurse account coordinates availability for a fictional period ending **22 October 2026, 4:38 pm IST**. No second Nurse account was created for backup. Admin can renew that period; the designated Nurse can change availability. The recorded OT/available states are training examples, separate from clinical discharge authority.

## Patients prepared for you

| Patient / admission | Bed / route | Starting point and next exercise |
|---|---|---|
| Demo Aarav Sharma · IP-2026-00001 | G-101 · self-pay | Active, assigned Nurse; deposit ₹3,000. Consultation, blood count and medicine charges exist. Start with external Doctor approval, publish the checklist and coordinate applicable checks. Diagnostics needs external confirmation because a blood-count charge exists. |
| Demo Meera Shah · IP-2026-00002 | G-102 · insured | Active, clinical instruction/checklist recorded. Fictional policy verified and case assigned to Insurance; accepted responsibility still needs recording. Six medicine packs charged and one accepted return leave ₹500 net medicine cost. |
| Saira · IP-2026-00003 | P-201 · self-pay | Pending reservation with no deposit or activation. Start here for admission, ₹5,000 deposit and actual arrival. This fictional single-name patient has a permanent UHID with one initial plus seven digits. |
| Demo Kavya Patel · IP-2026-00004 | G-103 · self-pay | All four applicable checks resolved and physical vacancy recorded. Final bill **₹2,300**, deposit **₹3,000**. Billing must allocate ₹2,300 and record the **₹700** excess refund before final finance. |
| Demo Isha Verma · IP-2026-00005 | P-202 · insured | Ready for final paper delivery and actual exit. Bill **₹3,800** = patient **₹800** + accepted insurer credit **₹3,000**. ₹2,000 deposit recorded, ₹800 allocated and ₹1,200 refunded. Final finance authorized; final PDF prepared. Insurer cash is still ₹0. |
| Demo Dev Malhotra · IP-2026-00006 | H-301 · self-pay | Active, external instruction/checklist recorded, ₹10,000 deposit. Diagnostic confirmation deliberately pending for the charged chest X-ray. Practise resolving this blocker with named external confirmation and evidence. |

All five active cases are assigned to the existing Nurse and have an open care shift. Meera and Isha's insurance cases are assigned to the existing Insurance account. Saira needs Nurse assignment and a care shift after activation.

## Suggested test order

1. **Admin:** open Patients & admissions and Beds. Confirm the six cases and six free beds. Review Staff & settings and Doctor availability. Staff identities/passwords are unchanged.
2. **Admission:** open **Saira**, record the fictional ₹5,000 deposit using a unique training cash-book reference, then record actual arrival after the reservation. Admin assigns the existing Nurse through **Assign responsible Nurse** / the care assignment screen. Nurse starts an assigned care shift. Alternatively, create a fresh insured patient in a free bed to run every stage from the beginning.
3. **Nurse:** open **Aarav** for an early-stage case. Record a clearly fictional external Doctor approval, then publish the physical checklist. Complete Nursing and record named external diagnostic confirmation for the blood count. Propose Insurance as N/A for this self-pay case; Admin confirms that applicability. Pharmacy completes its own medicine check. For a new insured admission, Admin creates/assigns the insurance case and Insurance owns its policy/decision work.
4. **Pharmacy:** open **Meera** to inspect original medicine charges and the accepted one-pack return. Add another fictional charge/return only if you want to practise the resulting financial review. Mark the current Pharmacy check complete after reconciliation; it is separate from Nurse readiness.
5. **Insurance:** open **Meera** and follow the assigned case link. Policy verification is already present. Record a fictional external payer decision and complete responsibility allocation against the current bill. Accepted authorization is credit, not a receipt. Complete the Insurance check once the allocation is current. If room charges or other economic sources change, refresh/review the allocation before final finance. For a stable final total, Nurse completes readiness and records physical vacancy before the final payer allocation.
6. **Billing:** open **Kavya**, then **Money & insurance**. Allocate ₹2,300 from the existing deposit, record the ₹700 refund using a unique fictional cash-book reference, and authorize final finance after the blockers clear. Allocation uses money already received; do not enter a second deposit or payment. Open **Isha** to compare accepted insurer credit with actual cash received.
7. **Nurse:** open **Isha**, then **Vacancy, papers & exit**. The final PDF is already prepared. Deliver the exact authorized final document version to the fictional recipient, record acknowledgment and actual delivery time, then confirm actual hospital exit with your existing care shift. Record times after the corresponding source events. Do not re-record bed vacancy; it is already present.
8. **Admin:** inspect the bed after exit. Complete **Cleaning & turnover before bed reuse** with a fictional housekeeping confirmation. Only then should that bed become available for another admission.
9. **Billing:** after Isha exits, record a fictional ₹3,000 insurer receipt against the retained receivable. The receivable should settle while the original exit and immutable final PDF remain unchanged. Retained episodes are available through the history filter.

For an easier first test, do **Kavya's Billing steps**, then **Isha's Nurse exit steps**. Both bills are frozen by physical vacancy, so their stated amounts are stable. Leave some cases unfinished to test blocked states. Refresh before the next action if another role changed the episode; the server rejects stale reviews intentionally.

## Verified setup and limits

- A fresh readable PostgreSQL custom backup and copies of the pre-existing protected files were saved under ignored `tmp/fictional-hospital-2026-10-15/pre-setup-backup/` before any addition. The backup is retained and was not restored over the live database.
- Before/after comparison verifies every original row across **96 tables / 109 rows**, every original private file, all eight staff accounts/credential records and all 61 applied migration records remain unchanged. Setup uses normal application commands, existing authenticated roles and retained audit history. New sessions/audit events and fictional operational records are additive.
- All six real role logins and populated dashboards returned HTTP 200 in Chromium. Admin/Admission/Pharmacy/Billing show six cases, Nurse five assigned active cases, and Insurance two assigned cases. Fresh intake exposes free beds/Doctors. Nurse can retrieve Isha's actual final PDF; Pharmacy is denied that PDF. Live domain checks confirm Isha has no final-finance blocker and Kavya has only the expected allocation/refund blockers.
- Admin Settings has an existing non-blocking React date-text hydration warning when browser/server default locales differ (local Node defaults to `en-IN`). The settings values were separately verified. Other five dashboard checks had no browser page errors. No application source or dependency changed for this data setup; the prior complete application suite was not rerun.
- Setup progress, exact fictional IDs, snapshots and browser/domain evidence are retained in ignored `tmp/fictional-hospital-2026-10-15/`. The completed setup refuses to replay over your subsequent training progress. No automatic cleanup or reset is scheduled. Ordinary testing creates persistent training history.

This local exercise does not enable real insurers, banking, email sending, live AI/OCR or real-patient operation. Use fictional references and evidence throughout. Existing manual insurer verification and staff authority boundaries remain in force.
