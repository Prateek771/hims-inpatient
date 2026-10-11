# Approved Figma reference

## Current approval · 11 October 2026

The owner approved **HIMS · Final Product — Role Workflows** and authorized actual implementation in one next chat in this same INS folder, with parallel subagents and a dedicated illustrated patient-journey guide agent. This replaces the older visual layout below; existing Tasks 1–16 business behavior and server authority remain controlling.

- [Current editable workspace](https://www.figma.com/design/SHtJNa3gp1oqOpNm8VzcmQ)
- [Doctor prototype entry](https://www.figma.com/proto/SHtJNa3gp1oqOpNm8VzcmQ/HIMS-Final-Product?node-id=3-4&starting-point-node-id=3%3A4&scaling=scale-down&content-scaling=fixed)
- File key `SHtJNa3gp1oqOpNm8VzcmQ`; pages `0:1` (Role workspaces), `2:2` (Components & tokens).
- [Implementation handoff](agent/UI_REDESIGN_HANDOFF.md). Sole-folder native source, role coverage and current 96-view state: ignored `tmp/final-product/README.md` and `tmp/final-product/final-state-current.json`; earlier states are historical. Inspect live Figma before implementation.

| Role | Entry node | Job navigation |
| --- | --- | --- |
| Admin | `7:456` | Home, Beds, Staff, Assignments, Billing, Pharmacy, Insurance, Discharge, Documents, Exceptions, Settings |
| Doctor | `3:4` | Patients, Discharge, Exceptions; clinical work is inside patient tabs |
| Nurse | `6:236` | My shift, Discharge, Exceptions; actual care is inside nursing tabs |
| Admission | `10:957` | Admissions, Insurance, Exceptions; intake, patient deposit and actual activation stay together |
| Pharmacy | `11:1096` | Medicines, Discharge, Exceptions |
| Lab | `12:1392` | Lab, Exceptions |
| Insurance | `12:1852` | Cases, Exceptions |
| Billing | `13:1663` | Billing, Insurance, Discharge, Documents, Exceptions |

No arbitrary section cap. No staff Home repeats its principal worklist. Preserve navy navigation, teal selection, restrained reporting/status colour, IBM Plex Sans, exact occupancy denominators and clear ownership. Top-right Profile/Logout and neighbouring Customize are approved. Implement real authorized data/forms and useful responsive layouts; synthetic Figma values are never ordinary app fixtures. Personal appearance does not change policy or permissions.

Native design checks: 96/96 views reachable, 838 valid links, no cross-role/dangling/self destinations, frame overlaps, horizontal text escapes, component text clipping or image fills; 40 unique General-bed labels. The prototype does not execute forms/signatures/login/print/scan or persist preferences and does not establish a full phone flow; those application behaviors require implementation/verification.

Current source rules override older prose: admission creation is Admission-only; activation is Admission/Admin; Admission records patient deposits/top-ups only; Billing cannot activate. Admin cannot open clinical charts or sign another profession’s gate. Final settlement allocates original deposits and records actual refunds. Settings use six implemented configuration types with fixed deposit amounts; no formula/slab policy is configured.

## Implemented source and review · 11 October 2026

All eight role workspaces now implement this approved direction with real authorized data and existing forms. The shared shell, exact menus/role homes, real Profile/password/signout, per-staff Customize preferences, keyboard-accessible retained task panels and responsive layouts received independent specification/quality and whole-branch review. Current physical occupancy comes from a read-only exact source projection rather than Figma sample counts. Previous financial/clinical/role/source/HTTP checks remain effective; new browser checks exercise narrow screens, keyboard links, retained drafts, nonempty nursing schedules and actual computed text contrast.

The [15-page illustrated guide](guides/README.md) uses eight reconciled screenshots of the tested implementation, with separate fictional narrative values. Capture application SHA256 is `021d46011ef00b58d6ef5a625052c89344c528fd82b61005d1db365ce65f36c0`; the manifest retains exact image/build/test provenance. These excerpts are implementation illustrations, not all96 prototype frames or real patient records. Source acceptance and final guide QA are complete; full local/recovery/preservation, exact development/main CI and copied ordinary preview have their own observed gates in [redesign progress](agent/UI_REDESIGN_PROGRESS.md) and `tmp/ui-redesign/release-evidence.json`.

## Historical approval · 9 October 2026

The owner approved the clean, minimal sections and data presentation on **9 October 2026**. Use this file as the visual starting point when implementing or reviewing a corresponding role/workflow.

- [Editable Figma workspace](https://www.figma.com/design/I4LQwHYp5IKZq0JQPZyM7X?node-id=4-2)
- [Navigable prototype](https://www.figma.com/proto/I4LQwHYp5IKZq0JQPZyM7X/HIMS-Inpatient-Prototype?node-id=4-2&starting-point-node-id=4%3A2)
- File key: `I4LQwHYp5IKZq0JQPZyM7X`
- File: **HIMS • Inpatient Care Workspace — Prototype**
- Pages: **01 · Role prototypes** (`0:1`), **02 · UI foundations** (`3:2`).
- Preserved builder and saved design state: [local prototype source](design/prototype/README.md). These are historical generation files; inspect current Figma screens before implementing or changing the design.

## Role and screen locators

| Screen | For whom / what it shows | Node |
|---|---|---|
| Start here | Review guide and staff role navigation | `4:2` |
| Hospital overview | Admin/head: current hospital work, beds and discharge blockers | `4:3` |
| Admission desk | Admission staff: patient, triage/destination, bed, deposit and insurance records | `4:4` |
| Clinical care | Doctor: rounds, orders, transfers and discharge summary | `4:5` |
| Nursing | Ward team: shifts, vitals, medicines, handover and consumables | `4:6` |
| Pharmacy | Pharmacy: medicine stock, issue/return and clearance | `4:7` |
| Lab worklist | Lab: orders, samples/barcodes, results and status | `4:8` |
| Charges and receipts | Billing: itemized ledger, deposits, manual receipts and refunds | `4:9` |
| Insurance paperwork | Insurance staff: externally verified data, documents and bounded AI help | `4:10` |
| Discharge waiting | Staff: four human gates and insurer money still outstanding | `4:11` |
| Final clearance ready | Billing/admin: actual receipt/refund recorded, ready for final human seal | `4:12` |
| Final discharge copy | Staff delivering documents: clinical summary, reconciled bill and seals | `4:13` |
| Exception register | Admin: reason, authority, remaining obligations and follow-up | `4:14` |

To locate a screen directly, use the file URL with `?node-id=4-4` for node `4:4`, and the corresponding value for another screen. Native node IDs may change after later design edits; verify the relevant current screen when needed.

## Visual direction to preserve

- Calm white surfaces, light grey-blue canvas, teal actions (`#087F82`) and navy text/navigation (`#122C3A`).
- IBM Plex Sans, readable labels/numbers, restrained status badges and generous spacing.
- Role-specific worklists and patient context, clear pending work and visible human ownership.
- Tables and simple summary cards for operational/financial information. Color accompanies readable state labels.
- Reuse the Figma foundation page's button, navigation, status, field and metric components rather than inventing unrelated patterns.
- Keep clinical readiness, financial approval and actual money received visibly distinct.

## What was delivered and checked

13 editable native Figma screens and 89 saved navigation links; both role navigation and the insurer-receipt-to-final-document review path were checked. Screens and the complete discharge-document footer were visually reviewed; the financial sample was reconciled. The screens contain editable elements, not full-screen image mockups.

These are representative prototype states. Form input, the insurance/self-pay selector, print/save controls, real signatures and document verification are visual previews; they are not implemented application behavior. The prototype QR/verification reference opens the design preview. All patient data and financial examples are synthetic.

Product behavior is controlled by [PROJECT_SCOPE.md](PROJECT_SCOPE.md). A prototype label/value does not override an owner decision or create a hospital policy. For Figma inspection/implementation, use the relevant installed Figma skills and current design context before writing UI code.
