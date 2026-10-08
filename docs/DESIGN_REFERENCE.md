# Approved Figma reference

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
