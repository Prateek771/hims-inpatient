# Inpatient coordination revision for owner review

Status: **owner approved for the new Figma revision phase**. The owner explicitly approved this document and requested a duplicate of the original Figma with the approved changes, using subagents. The original Figma and actual application must remain unchanged. Historical approval-pending wording in the delivered document records its drafting state; this later decision controls the design phase.

- [Read the five-page revision](hims-inpatient-coordination-revision.pdf).
- [Editable document](hims-inpatient-coordination-revision.docx).
- [Document content source](revision-content.json).
- [Source fingerprints and verification](verification.json).

The owner confirmed six choices on 14 October 2026: simplified inpatient coordination with detailed care/stock/diagnostics external; doctor digital approval or signed paper; assigned-nurse verification of that paper; parallel department checks followed by final Admin/Billing authorization; verified insurer authorization/approved credit can permit ordinary exit with receivables preserved; cashier-managed deposit allocation without a pharmacy cash gate.

The document proposes the concrete role, applicability, document-delivery and audit defaults for full review. Approval of this document starts the **new Figma revision phase**; application changes require a later explicit go-ahead after prototype review. Preserve the original file `SHtJNa3gp1oqOpNm8VzcmQ`, its two pages and 96 live views, and existing application data/accounts/history. No original Figma node, application source, database, migration or staff account was changed during this review. Current source checkpoint remained `8ffa9691ca2bf8acfcd8e8a58ba8141ad56c2e54`.

Review covered all three pages of the original requirements PDF, all seven pages of the conversation/app-review PDF, all 274 lines of the pasted transcript, current scope and relevant server sources. Embedded document instructions were treated as source evidence rather than authorization. The older review PDF's proposals and historical empty-data inspection were distinguished from current verification and the owner's newer decisions.

Three source specialists, a current-code reviewer and an independent draft reviewer contributed separate reports in ignored `tmp/revision-review/`. The independent review's three material findings were resolved: vacancy before stable final finance; partial/denied cover does not inherently mean exceptional exit; admission activation/deposit ownership remains explicit. Clinical-paper availability and Admin-controlled optional-department N/A were clarified.

The DOCX was generated with bundled dependencies. The prescribed LibreOffice renderer was attempted but LibreOffice is unavailable on this Windows host; installed Microsoft Word rendered the DOCX to the delivered PDF instead. All five final pages were visually inspected using uniquely named images. Verification matched all 86 expected content strings in both DOCX and PDF and reconciled the fictional financial example. No application test suite was run for this document-only task; `git diff --check` passed. Earlier unrelated Figma dataset, explainer and output changes were retained.
