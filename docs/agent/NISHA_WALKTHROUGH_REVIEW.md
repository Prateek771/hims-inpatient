# Nisha illustrated walkthrough and observed issues

Verified **18 October 2026** at the owner's request: walk one fictional inpatient from admission to discharge through all six dashboards, capture actual screens and report gaps. Deliverable: [illustrated PDF](../../output/pdf/nisha-inpatient-walkthrough.pdf), 22 pages with 31 distinct actual screenshots (33 placements, including two split-form views). This supplements the [short process guide](../../output/pdf/hims-inpatient-process.pdf).

## Completed ordinary fictional case

- Demo Nisha Kapoor, UHID `DNK9031801`, admission `IP-2026-00007`, admission ID `c596be50-29b8-4d86-b6f5-97b58e3acb1f`, Demo G-104, insured, Dr Demo Anika Rao. Existing Nurse and Insurance users own the corresponding records.
- Actual normal browser actions covered intake/reservation, INR2,000 deposit, activation, Nurse assignment and shift, case creation/assignment, medicine charge and original-price return, external consultation/blood-count charges, external Doctor instruction, early clinical PDF, checklist, all four applicable checks, physical vacancy/waiting care, external policy/accepted responsibility, deposit allocation, refund, final finance, final PDF, exact delivery, actual exit, turnover and later insurer receipt.
- Gross INR3,000 minus INR100 medicine return = INR2,900. Patient share INR900; accepted insurer share INR2,000. INR2,000 deposit less INR1,100 actual fictional refund leaves INR900 retained. Later fictional insurer receipt INR2,000 clears the receivable. Patient/insurer remaining both zero.
- Current database status DISCHARGED. Bed held/occupied/uncleaned all false; Demo G-104 is Ready. The exact final-document delivery remains recorded. Final PDF SHA-256 before and after the later receipt is identical: `2384e98453c6cf5729a2a6ef997df8dacc9e4618f1e6e5f1f4440aa18c760e42`.
- 28 completed UI action steps, 47 captured snapshots, six roles, no browser page errors on the recorded routes. A real Admission 404 is separately documented below; zero page errors does not mean that every HTTP/navigation result was successful. No app source, schema, credential or provider was changed; full application tests were not rerun for this walkthrough.

## Confirmed issue 1: Admission insurance handoff returns 404

- Trigger: as Admission, create/assign the insured case from `/insurance?admissionId=<new-episode-id>`, then the same admission-linked route resolves its new case.
- Actual: the case is saved, but the page returns the 404 UI. Admin/assigned Insurance can read the saved case. Recreating a case is unnecessary.
- Source: `web/src/app/(staff)/insurance/page.tsx` derives `caseId` from the supplied admission, then calls `notFound()` for Admission before detailed review. The role restriction is valid; the post-save handoff is not useful.
- Desired behavior: show success/assigned ownership and a role-appropriate return/handoff, preserving the prohibition on Reception's detailed case review.
- Workaround: return to Admissions; the assigned Insurance user opens Insurance cases. PDF pages6 and21 show the actual form and failure evidence.

## Confirmed issue 2: closed summary says final papers pending

- Trigger: after final finance, exact final PDF delivery and ordinary Nurse exit, record a later permitted insurer receipt against the receivable.
- Actual: Nisha remains DISCHARGED and the exact delivery/exit/final PDF remain intact, but the retained episode summary says `Clinical papers available · final papers pending`.
- Source: `web/src/components/mvp-summary.tsx` derives the paper label from `review.finance`; `web/src/server/mvp/dependencies.ts` keeps that current finance projection only when its bill version equals the current episode revision. Later receipts can advance that revision. Closed-document generation/history already uses the departure's pinned authority in `web/src/server/documents/mvp.ts`.
- Desired behavior: project historical finance/paper status from the recorded departure authority and exact delivery for closed episodes. Keep later money settlement separate from the original exit; do not fabricate fresh approval or alter the saved PDF.
- Workaround: inspect retained delivery/exit and the existing final document. Do not regenerate a replacement or repeat exit. PDF page21 shows the misleading label.

## Preservation and private evidence

Fresh readable 681,832-byte custom backup plus pre-existing protected-file copies are retained in ignored `tmp/pdfs/nisha-journey-2026-10-18/pre-walkthrough-backup/`; archive SHA-256 `8c3d69a69d9b24ddcb35fa5c9f14973d29c6e28e0618eedb0b6a0a3a534bb527`. It was not restored over the live database.

Before/after hash comparison preserves every previous row, original migration record/source byte, staff/account credential row and protected file. The admission counter alone increases from6 to7, exactly the normal single new admission increment. Existing six sample episodes are untouched. New Nisha operational/audit/document records and staff sessions are additive. No reset/reseed/bootstrap/credential rotation took place.

Private journal, screenshot originals, authentication state, hash-only preservation snapshots, final database checks, PDF generator/extracted text and rendered QA live under ignored `tmp/pdfs/nisha-journey-2026-10-18/`; generator `tmp/pdfs/create-nisha-walkthrough.py`; UI driver `tmp/nisha-walkthrough.mjs`. Authentication states must remain ignored/private. The patient is already discharged and settled; do not rerun completed mutations or reuse receipt identities as a new practice case.

## Scope limits and next work

The guide identifies usability recommendations separately from observed defects: clearer role handoffs, patient continuity, filter explanations and location of cleaning actions. Manual outside Doctor/diagnostic/insurer decisions, recorded hospital-channel payments and manual paperwork remain intentional current boundaries. No provider/integration is enabled by this exercise.

This one ordinary insured walkthrough did not exercise self-pay, transfer, urgent exception, cancellation, temporary identity, uploads or automated paperwork. It is not blanket revalidation of those flows or authorization for real patient use. Real hospital rules/access/backups/retention/TLS/provider arrangements still need their documented owner decisions. Fix the two observed UI issues in a separately requested product change, with focused regression and applicable project checks.
