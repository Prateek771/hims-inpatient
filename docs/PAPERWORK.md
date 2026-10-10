# Insurance paperwork preparation

Task14 adds durable, locally reviewed paperwork for an open insured admission. Live model and OCR providers remain unselected. Staff supply explicitly manual text from protected case documents; the system quotes that text, lists local gaps and pauses for a human decision. It does not verify transcription, payer requirements, coverage, clinical facts or payment, and it sends nothing to an insurer or portal.

## Staff flow

Open the case in the Insurance workspace. Supply optional manual text against current attached document IDs and choose **Prepare manual draft**. Review the source citations, quoted text and local gaps, then accept, request changes or reject. Acceptance retains one reviewed local packet and one accountable local staff follow-up. It does not approve coverage, issue a professional seal or complete discharge.

The initial draft counts as revision1; at most three draft revisions are allowed. Revision3 can be accepted or rejected. A requested change requires another human review and retains the earlier proposal and signed decision. A new run is needed when the case sources change. Historical runs remain readable only with current case-purpose access.

Current server-side staff role and case assignment control access. Start and material review require an insured PENDING or ADMITTED episode before departure. A run/thread UUID grants no permission. Wrong-role, foreign-case and stale review requests are rejected by the server.

## Source and retry contract

`expectedDocumentVersion` binds the insurance case's `documentSetRevision`. Review also requires the current `expectedProposalRevision`. Policy/decision references, case and admission versions, current document IDs and hashes, and exact manual quotations bind the run's retained source. Protected files are checked outside the short admission transactions; current authority and source metadata are checked again under the admission lock before local effects.

Manual input is bounded: at most20 cited documents,4,000 characters per quotation and24,000 total characters. The current source inventory supports at most100 documents totaling50 MiB. JSON requests are limited to128 KiB. Text remains inert quoted data, including instructions or markup found in a source.

Every start/review carries a staff-bound request UUID. Retry the same request with the same intent after a capability failure; do not create a different review to replace a recorded pending decision. The UI offers **Retry recorded staff decision** after reloading. Persistent graph completion and the local packet transaction can recover separately; repeated acceptance retains one packet and one local follow-up.

Graph resume binds the server's exact prechecked checkpoint to its own run and root namespace. This prevents an overlapping old change-request retry from consuming the next draft's human-review pause. Native advisory-session loss fails local finalization closed while retaining the original signed intent for recovery.

Review run IDs are normalized after UUID validation before request hashing, the run lock and the graph thread are selected. Differently capitalized representations therefore share one saved run and stable recorded-intent retry payload.

## Persistence and explicit setup

The official pinned LangGraph/PostgresSaver uses `interrupt` and `Command` resume across independent graph/saver instances. Checkpoints live in the fixed server-owned `hims_paperwork_checkpoints` schema. Domain proposals, signed reviews, packets and follow-ups retain immutable history separately from library checkpoint UPSERTs.

Run from the authorized INS folder after database provisioning:

```powershell
npm --prefix web run db:migrate
npm --prefix web run paperwork:setup
```

Setup checks the dedicated non-privileged migration-owner database identity, serializes official library setup and requires its migration versions0–4. It is an explicit owner CLI; importing code or making a request never creates checkpoint tables. Runtime receives scoped checkpoint access without schema CREATE or table DELETE. Missing checkpoint setup is a paperwork failure; ordinary hospital work and its core readiness endpoint remain available.

Runtime grants are per table: SELECT on checkpoint_migrations; SELECT/INSERT on checkpoint_blobs; SELECT/INSERT/UPDATE on checkpoints and checkpoint_writes. Blob UPDATE is unnecessary for the installed saver and is denied. Domain proposals, reviews, packets and follow-ups are SELECT/INSERT only; mutable run updates are limited to status, revision and pending-review ID.

The installed tracing libraries can inherit external tracing settings. Paperwork therefore uses an invocation-local, supported client transport that returns locally without exporting, isolates the parent trace, and excludes replicas/OTEL transport. Internal tracing callbacks can still run; this is a local no-export boundary. A plain disabled-tracing wrapper was insufficient for the installed deferred graph execution. No global application environment is changed and no live provider or telemetry destination is selected.

Preserve both HIMS and checkpoint schemas, migration checksums and protected case-file storage for a future authorized restore. A backup/restore implementation is a later task. Never reset ordinary databases, rewrite applied SQL or seed patient/policy records to make this flow available.

## Verification

The complete project command is `npm --prefix web run check`; runtime dependencies are audited with `npm --prefix web audit --omit=dev`. Task14 acceptance evidence and the exact checkpoint are recorded in [project context](agent/project-context.md) and the local build ledger. Task 14 is independently approved by GPT-6.1 specification and quality review. The controller original full check passed 40 unit tests, 127 actual PostgreSQL tests across 14 files, lint, type checks, production build and 31 Chromium/HTTP checks. After the scoped corrections, the controller passed all 11 affected PostgreSQL tests; the author passed the affected three browser checks, import unit check, lint, type checks and production build. Runtime audit found zero vulnerabilities. Exact final-commit complete CI results are recorded in the local ledger before main integration. Reviewed ordinary migrations 0000–0053 and official checkpointer versions 0–4 are current. Fresh before/after hashes preserve all 25 original records across 71 original tables and columns; all 54 applied SQL checksums match literal files. No database reset, patient/policy seed, live provider, sender or deployment was introduced. The reviewed overlap regression binds resume to the prechecked checkpoint, uppercase run IDs share the canonical thread, and native blob UPDATE is denied. Synthetic tracing tests prove no export while allowing internal local tracing callbacks.
