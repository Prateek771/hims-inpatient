# Independent Figma revision QA

14 October 2026. File `IuHawGiBaoUkOQsz7gtrdK`, active page `2004:2248`. **PASS: no unresolved blocking design, content or prototype-link defect.** This accepts the Figma revision for owner review; it does not authorize or verify application/backend implementation.

The complete approved revision JSON and corrected draft review governed this check. Read native content from the original 53 revision screens, all five added Nurse status/document/changed-facts views and the role handoffs; re-read corrected active content. Visual checks covered all eight role workflows plus paper approval, vacancy/exit, printable checklist/packet, staff ownership, cash receipt and handoff states. The original HIMS and construction reference pages remain outside the active prototype.

Final independently observed native evidence:

- **65/65 active frames reachable** from Start; all eight role entries and both guide entries valid.
- **454 valid NODE navigation/overlay connections**, 461 reaction nodes; no dangling, self, non-top-level, cross-page or archive destinations.
- **73 role handoffs** route through explicitly labelled read-only handoff overlays and a deliberate demo-role switch. Nurse views retain their own read-only statement/packet/status actions. Actual payer receipt entry and confirmation belong to Billing/Cashier, Neha Gupta.
- **4,193 native scene nodes**, including 2,438 text nodes and 643 component instances; IBM Plex Sans only, no image fills, no text escapes from internal ancestors and no top-level frame overlap. Long app views have deliberate vertical scrolling; paper previews contain native editable text.
- Current Department identity is confirmed by a native banner screenshot and geometry: Meera / MGH-00127 / IP-2026-00108; banner at y174–250, following note at y266–331. An earlier full-frame screenshot delivery was stale/partial; no design change was required.

Approved behaviour is represented: responsible Doctor digital approval or assigned-Nurse verification of signed Doctor paper; independently deliverable clinical papers; Nurse checklist and parallel attributable department checks; Admin-only optional N/A with reasons and mandatory-check exclusions; factual vacancy before finance; current pre-exit packet before Nurse exit; held bed, closure and authorized cleaning before availability. No Pharmacy cash gate or automatic deposit allocation is shown.

The consistent case retains **INR 120,000 gross − INR 5,000 returns = INR 115,000 net**. **INR 30,000 deposit − INR 5,000 actual refund settles INR 25,000 patient responsibility**. Ordinary exit retains **INR 90,000 insurer receivable with INR 0 insurer receipt**, named collection owner and follow-up date. Later actual payer receipt settles current AR without replacing the original pre-exit/closed packet.

All material findings were rechecked after correction: complete G-12 → G-10 → G-12 movement history; paper recording at 10:03; Pharmacy at 10:08, Lab at 10:09, Insurance at 10:11 and Nursing at 10:12 before vacancy at 10:15 and finance at 10:25; pre-exit v1/closed v2; external-transfer exception wording; missing-item/as-of clocks; role ownership; insurer credit distinguished from unpaid patient shortfall.

Initial duplicate evidence files match **2 pages, 96 views, 7,477 role-page nodes, 39 component-page nodes, 14 components, 4 component sets and 854 connections**; copied hashes differ because style references were remapped. The coordinator's exact original before/after fingerprints remain **2ee1df3a2d92b89c** and **d1b2a3c4c03a3184**. That preservation comparison is controller evidence, distinct from this reviewer's independent active-page checks.

Detailed final observations are in `qa-final-evidence.json`; current IDs/wiring are in `active-state.json`, with the controller's matching `final-audit.json`. Prototype controls do not prove working uploads, forms, printing, persistence or server authorization. No app, database, Git or original-file mutation was performed by QA; only QA artifacts were written in this project.
