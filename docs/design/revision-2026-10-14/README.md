# Inpatient coordination Figma revision

Status: **completed, independently reviewed, ready for owner prototype review**. The owner approved the five-page revision and authorized this separate Figma phase using subagents. Actual application/backend work requires a later explicit go-ahead.

- [Editable revision](https://www.figma.com/design/IuHawGiBaoUkOQsz7gtrdK?node-id=2008-2401).
- [Start the clickable prototype](https://www.figma.com/proto/IuHawGiBaoUkOQsz7gtrdK/HIMS-Inpatient-Coordination?node-id=2007-2248&starting-point-node-id=2007%3A2248&scaling=scale-down&content-scaling=fixed).
- [Graphical patient journey](https://www.figma.com/proto/IuHawGiBaoUkOQsz7gtrdK/HIMS-Inpatient-Coordination?node-id=2008-2401&starting-point-node-id=2008%3A2401&scaling=scale-down&content-scaling=fixed).
- [Protected original](https://www.figma.com/design/SHtJNa3gp1oqOpNm8VzcmQ).
- [Approved revision document](../../revisions/2026-10-14/README.md), [verification](verification.json), [independent review](qa-review.md), [final native audit](source/final-audit.json).

## What changed

One native duplicate preserves the original 96-view file and its copied components/tokens. A single active page now contains **65 editable revised views and 454 valid navigation/overlay connections**, covering all eight roles. Every active frame is reachable from Start. The copy’s original full HIMS page remains an archive; ward/finance construction references are retained separately. No active destination enters those archives.

Admission uses UHID/IP lookup, clinician instruction, suitable Ward > Room > Bed, deposit prerequisites and actual arrival. Doctor approval is digital or assigned-nurse-attested signed paper. Nurses publish printable checklists; departments check independently in parallel. Nurse factual vacancy and handover precede a stable final Billing/Admin review. Clinical papers remain available after doctor approval, independently of exit authorization. Nurse delivery and actual exit precede closure; authorized bed staff confirm cleaning before availability.

The fictional case reconciles ₹120,000 gross − ₹5,000 accepted returns = ₹115,000 net. ₹30,000 actual patient deposit − ₹5,000 actual refund settles ₹25,000 patient responsibility. ₹90,000 verified insurer authorization remains a receivable, with ₹0 insurer receipts at ordinary exit. Cashier later records payer receipts without rewriting the pre-exit v1 or closed v2 packet. Authorization, money received and obligations remain distinct.

Doctor charts, Nursing MAR/vitals, Pharmacy inventory and diagnostic production leave active core menus; historical records remain retained. Staff permissions, controlled exceptions, optional Admin-confirmed N/A and configuration are visible. Cross-role editor links show read-only handoff overlays and require an explicit demo-role preview. Nurse print/status/request views expose no Billing editor. Payer receipt entry belongs to Billing/Cashier, not Insurance.

## Review and limits

Two role authors worked independently; the controller integrated native copies, navigation and role handoffs; a separate reviewer checked approved workflow coverage, all eight roles, geometry, editability and links. Corrected findings include transfer history, future timeline labels, paper recording/packet versions, insurer-check timing, receipt ownership, patient-credit scope and purpose-limited Nurse access. No blocking review finding remains.

Final native checks: 4,193 scene nodes including 643 instances; IBM Plex Sans only; no flattened/image-filled UI, internal text escapes, canvas overlap, dangling/self/archive links. All 65 active frames are reachable. Representative source and active screenshots were reviewed, and the actual browser prototype loaded and navigated from Start to the graphical map. [Workflow screenshot](workflow-map.png) shows the final map; [timed journey](patient-journey.png) is an earlier composition before the expanded Admin core menu was added.

The protected original was read before and after: role-page fingerprint `2ee1df3a2d92b89c`, library fingerprint `d1b2a3c4c03a3184`, 96 original views and 854 original connections match exactly. Duplicate hashes are not directly comparable because the fingerprint includes file-specific referenced style IDs and page names; the initial native duplicate matched the original node/view/link counts. The protected source was never written.

Actual app source, database, migrations, credentials, preview and deployment remain unchanged. Git HEAD stayed `8ffa9691ca2bf8acfcd8e8a58ba8141ad56c2e54` on `codex/hims-development`; only design/revision/progress documents were changed. No app suite was run for this Figma-only task. JSON parsing, local document links and `git diff --check` passed; no `web/` diff or staged change exists. Existing unrelated demo/explainer/output work and original design-reference changes remain preserved; nothing was staged, committed or pushed.

This prototype illustrates hypothetical data and screen transitions. It does not execute login, signatures, file/camera capture, print, permissions, financial commands or data persistence. Hospital policies and future server enforcement remain later implementation work.

## Source record

`source/` retains native helpers, role construction scripts and state/action/audit snapshots. They are design provenance with captured IDs, not app code or an idempotent rebuild tool; inspect the live new file before reuse. Original copy, active consolidation and explicit role previews are all recorded in verification. Never run these scripts against the original file.
