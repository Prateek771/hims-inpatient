# Staff-entered insurance and protected case files

The Insurance workspace records decisions verified outside HIMS and prepares local staff work. It does not verify eligibility, contact an insurer, send documents or choose an AI/OCR provider. See [scope](PROJECT_SCOPE.md) and [current review status](agent/BUILD_HANDOFF.md).

## Cases, assignment and provenance

Admission, Admin and Billing can create one case for an open insured admission and assign an active Insurance account. Admin/Billing can reassign or revoke it with a recorded reason. Assigned Insurance staff and Admin/Billing can work with the case. Admission retains limited creation/assignment context, without policy, financial or file access. Clinical/department roles do not receive insurance-file or unrestricted chart access.

Policy and payer records retain insurer/TPA, member/policy identity, verified validity, external verifier/time/reference, evidence and the authenticated recording staff member. Pre-authorization, enhancement and appeal decisions retain PENDING/APPROVED/PARTIAL/REJECTED status and previous versions. Local follow-up completion requires the actual same-case open work item; insurer email/portal work stays with staff.

An insured transfer's original follow-up task remains immutable. Resolution records its current case, same-admission task, later non-pending decision and external provenance. The Care pending list removes only resolved work. Conversion records an explicit disposition of remaining transfer tasks rather than deleting their history.

## Responsibility and actual money

Money uses integer paise and exact half-up co-pay rounding. Insurer liability is capped by recorded authorization and eligible charges less co-pay. Patient minimum is co-pay once plus non-payables. An approval shortfall remains unallocated until staff record verified responsibility; arithmetic cannot establish payer coverage.

Saved allocation binds the current posted bill/version and a Billing-owned economic-source fingerprint. New charges, same-net source changes, reversals, finalizations or posted room charges make it stale. Receipt-only changes preserve its economic basis. Policy changes also require a new review. Pending charges and unposted room estimates remain explicit; a running allocation is not final settlement or discharge approval.

Authorization never becomes cash. The case view separates actual receipts, insurer/patient dues, excess received amounts and unallocated patient deposits. Deposit allocation adds no payment. Configured alert thresholds are reused; the source 80% default is identified when hospital settings are absent. No/zero authorization has no utilization ratio.

Admin/Billing conversion to self-pay requires external decision provenance, reason and complete verified responsibility. Retained insurer liability must equal actual insurer cash already received, and retained insurer liability plus verified patient liability must equal the posted bill. Previous authorizations, actual receipts and obligations remain. An overpaid bill needs the authorized refund/exception workflow; conversion cannot invent that disposition. Later economic changes require current self-pay financial review. Refunds, human seals and final room/departure settlement belong to the discharge workflow.

## Protected documents

Ordinary PDF/JPEG/PNG files use generated UUID paths under `INS/private-uploads/insurance`, outside public and ignored by Git. Synthetic use requires `HIMS_INSURANCE_STORAGE=synthetic` and uses the separate `INS/tmp/insurance-test-storage` root. Mixed database/storage configuration and supplied storage paths are refused.

`HIMS_INSURANCE_MAX_BYTES` defaults to 10 MiB and accepts 1 KiB–50 MiB. Files need agreeing MIME, extension and signature, valid names, nonzero size and verified bytes. These checks do not establish document truth or provide malware scanning. Staff-approved case materials remain protected attachments.

Uploads stage complete generated files before transactional metadata. Replacements retain original versions and advance the document-set revision. Exact retries recheck current permission and file availability. Downloads verify same-case access, regular-file size/hash and audit access; responses are attachments with no-store, nosniff and restrictive CSP. Failed metadata transactions retain no valid document record; an unreferenced file may remain after an ambiguous commit error. Recovery must reconcile DB and storage together without deleting a possibly committed file.

The authenticated route is `POST /api/insurance/cases/[caseId]/documents` with file, expectedCaseVersion, requestId and optional replacesDocumentId; download is GET with documentId. Uploads require same origin and stream a bounded multipart body. A guessed case/document ID never grants access.

## Server composition and handoff

Public commands include createInsuranceCase, assignInsuranceCase, recordPolicyVerification, recordPayerDecision, recordInsuranceFollowup, resolveTransferInsuranceTask, convertToSelfPay, attachCaseDocument and downloadCaseDocument. getInsuranceCase and insuranceWorkspace return purpose-limited projections. Command inputs never supply audit actors; external verifiedBy is provenance.

Supplied-transaction entrypoints for payer decisions, conversion, attachment and insuranceReviewInTransaction compose without a nested pool transaction. Lock order is shared settings/staff advisory729104211, current staff, actor/request, owning admission, then mutable case state. Successful old retries still require current active role and assignment.

Case version changes for every mutation; reviewRevision tracks policy/decision/conversion; documentSetRevision tracks upload/replacement. Discharge consumes financial review inputs and actual money, while durable paperwork binds the document set. Original source/rate/cash identities and applied SQL bytes are preserved.

Task10 verification and independent acceptance are recorded in [build status](agent/BUILD_HANDOFF.md). Tests use only guarded synthetic PostgreSQL, synthetic files and real browser/HTTP sessions. The ordinary database has no seeded patient or hospital policy, and this feature does not establish permission for real-patient use.
