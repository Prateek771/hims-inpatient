# Discharge copies

Task13 is independently accepted with the complete application checks. This guide records the accepted contracts and current limits; checkpoint and preview evidence are in the current handoff.

Admin and Billing staff create a final copy after the recorded hospital departure. The document contains the patient/admission and hospital details, recorded care and instructions, the deterministic financial statement, the actual professional clearances or exceptional authority, and the document reference and verification QR. Creating a copy does not approve coverage, discharge a patient, sign for another professional or erase an unpaid balance. Insurance verification and payments remain staff-entered external facts.

## Staff flow and access

Open **Documents** as Admin/Billing, select the departed admission, review its current sources and create the copy. The stored version has an HTML view, a separate browser print view and an authenticated PDF download. The QR opens the application's authenticated verification page; it does not reveal patient information publicly. Creation, viewing, printing, downloading and minimal verification require a current persisted Admin/Billing role. Chart assignments alone do not grant this purpose.

`getDischargeDocumentReview` returns the reviewed bill version, exact historical clearance IDs, exceptional authority when present and source hash. `createDischargeDocument` accepts these references and returns the document ID, version and content hash. Internal preparation and publication helpers receive server-owned snapshots; clients cannot submit document content or PDF bytes.

## Versions and provenance

Each copy stores immutable source/content snapshots and a canonical sorted-JSON SHA-256. Its actual PDF bytes have a separate SHA-256 and size. An unchanged latest-source retry reuses the latest copy. Changed sources append a version linked to its predecessor; changing A to B and back to A produces a third version, preserving all three. Concurrent same-source creators converge on one latest version.

Ordinary copies retain the exact recorded departure's historical seal chain and bill version. Later amendments preserve the original signatures and factual invalidations; they do not invent new professional seals. Exceptional copies retain their actual authority, unknown clinical facts and outstanding obligations. Printing later does not re-evaluate historically issued medicine against today's expiry date.

Later exception follow-up routing is a material source. Copies distinguish the original authority's owner from the current recorded owner and retain attributable routing history. A reassignment changes the source hash; earlier PDFs remain intact and a newly reviewed copy appends a version.

Verification reports `CURRENT`, `SOURCE_CHANGED`, `SUPERSEDED` or `FILE_UNAVAILABLE`. Its response contains only document identity, version and hashes/status. Authorized historical PDFs remain downloadable after source changes or replacement when their original verified bytes are present. An unavailable or modified file is rejected rather than regenerated under the same immutable identity.

## Rendering and storage

Preparation and publication use two short database transactions. Between them, bounded local rendering releases admission/source ownership. Publication rechecks current access, exact material sources and predecessor before accepting bytes. Native source writers participate in the same admission/patient identity serialization. Existing applied migrations and historical review hashes are preserved.

The statement groups recorded room deltas only when their original stay, bed, pinned tariff/rate and amendment/status agree. It sums recorded integer paise and retains all raw charge IDs and provenance. Transfers, linked reversals, department charges and actual corrections remain distinct. It never reprices or changes the ledger; HTML/PDF consume the same frozen statement projection.

Portable Noto Sans and Mukta OFL fonts are bundled for Latin/Devanagari text, without network or system-font dependence. Unsupported glyphs or sources exceeding the bounded renderer's limits are rejected before publication, preserving the original records. Human names and recorded actions are audit signatures, not cryptographic signature certificates.

Current hard bounds are 50,000 raw charges, 2,500 statement lines, 64 million canonical source characters, 500,000 printable characters, 1,600 characters per row, 200 A4 pages and 10 MiB of generated PDF bytes. Rows may continue across pages, preserving original text. These are rejection ceilings, not a guarantee of throughput or support for every stay duration/source combination.

Browser printing and the downloaded PDF may paginate differently. In current Chromium, some displayed Devanagari conjuncts in `क्षेत्र`, `करें` and `रखें` extract as NUL mappings from its saved print PDF despite correct visible glyphs. Use the server PDF download when exact extracted Hindi text is needed; its checked fixture retains the original conjunct text without NUL mappings. This limitation does not alter stored clinical text or canonical source hashes.

Ordinary generated PDFs live under ignored `private-uploads/discharge/`. Explicit synthetic database identity and `HIMS_DOCUMENT_STORAGE=synthetic` use ignored `tmp/document-test-storage/`; arbitrary supplied paths or mixed identities are rejected. Generated manifest/staging files precede verified final bytes and immutable metadata. Failed or ambiguous commits retain minimal manifests/orphans for the later reviewed recovery work. Downloads verify regular-file status, size, PDF signature and byte hash, and are audited with attachment/no-store protections.

See [scope](PROJECT_SCOPE.md), [discharge](DISCHARGE.md), [exceptions](EXCEPTIONS.md), [database setup](DATABASE_SETUP.md) and [current handoff](agent/BUILD_HANDOFF.md). Paperwork agents and recovery/pilot safeguards remain later owner-gated tasks.
