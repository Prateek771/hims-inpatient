import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { admissions } from "../admissions/schema";
import { lockBillingAdmission } from "../billing/commands";
import { appendAudit } from "../audit";
import { dischargeDocuments } from "./schema";
import { renderDischargePDF } from "./pdf";
import { canonicalJSON, documentSourceInTransaction, snapshotHash, type DischargeSnapshot, type DocumentSource } from "./snapshot";
import { protectedStorageDirectory } from "../protected-storage";

const hashes = z.string().regex(/^[0-9a-f]{64}$/);
const input = z.strictObject({ admissionId: z.uuid(), billVersion: z.number().int().positive(), clearanceVersions: z.strictObject({ DOCTOR: z.uuid().nullable(), PHARMACY: z.uuid().nullable(), NURSING: z.uuid().nullable(), BILLING: z.uuid().nullable() }), exceptionId: z.uuid().optional(), expectedSourceHash: hashes });
const byteHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Full final-copy delivery purpose is intentionally narrower than raw chart/episode navigation. */
async function documentOperator(tx: Transaction, ctx: CommandContext) { return admissionOperator(ctx, ["ADMIN", "BILLING"], tx); }
function binding(source: DocumentSource) {
  return { admissionId: source.admission.id, billVersion: source.money.bill.revision, clearanceVersions: Object.fromEntries(source.seals.map(s => [s.gate, s.seal?.id ?? null])) as z.infer<typeof input>["clearanceVersions"], ...(source.departure.exception ? { exceptionId: source.departure.exception.id } : {}), expectedSourceHash: snapshotHash(source) };
}
export function documentStorageDirectory() {
  return protectedStorageDirectory("discharge");
}
function pathFor(key: string) { return resolve(documentStorageDirectory(), `${z.uuid().parse(key)}.pdf`); }
type StoredDocument = Omit<typeof dischargeDocuments.$inferSelect, "snapshot"> & { snapshot: DischargeSnapshot };
function assertSnapshot(row: StoredDocument) {
  if (row.hash !== snapshotHash(row.snapshot) || row.snapshot.documentId !== row.id || row.snapshot.version !== row.version || row.snapshot.sourceHash !== row.sourceHash || row.snapshot.admission.id !== row.admissionId) throw new DomainError("PRECONDITION", "Immutable document metadata is inconsistent; restore the original verified record");
}
async function readPDF(row: StoredDocument) {
  assertSnapshot(row);
  try {
    const stat = await lstat(pathFor(row.storageKey));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.sizeBytes || stat.size > 10_485_760) throw Error();
    const bytes = await readFile(pathFor(row.storageKey));
    if (byteHash(bytes) !== row.pdfHash || !bytes.subarray(0,5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw Error();
    return bytes;
  } catch { throw new DomainError("PRECONDITION", "Protected final PDF is unavailable or changed; restore the verified original file"); }
}
function verificationURL(id: string) {
  let base: URL; try { base = new URL(process.env.BETTER_AUTH_URL ?? ""); } catch { throw new DomainError("PRECONDITION", "Configure the authenticated application URL before creating documents"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new DomainError("PRECONDITION", "Use a valid configured application URL for document verification");
  return new URL(`/documents/${id}/verify`, base).href;
}
export async function getDischargeDocumentReview(ctx: CommandContext, admissionId: string) { return withTransaction(async tx => {
  await documentOperator(tx, ctx);
  const e = await lockBillingAdmission(tx, z.uuid().parse(admissionId)), source = await documentSourceInTransaction(tx, e);
  const versions = await tx.select({ id: dischargeDocuments.id, version: dischargeDocuments.version, sourceHash: dischargeDocuments.sourceHash, createdAt: dischargeDocuments.createdAt }).from(dischargeDocuments).where(eq(dischargeDocuments.admissionId, e.id)).orderBy(desc(dischargeDocuments.version));
  return { input: binding(source), versions, ipCode: e.ipCode, name: source.patient?.name, departureKind: source.departure.kind };
}); }
type PreparedDocument = { input: z.infer<typeof input> } & ({ existing: { documentId: string; version: number; hash: string } } | { existing: null; snapshot: DischargeSnapshot; hash: string; replacesDocumentId: string | null });
export async function createDischargeDocument(ctx: CommandContext, value: unknown) {
  const prepared = await withTransaction(tx => prepareDischargeDocumentInTransaction(tx, ctx, value));
  // Bounded local layout never monopolizes admission/source ownership or a SQL waiter.
  const bytes = prepared.existing ? null : await renderDischargePDF(prepared.snapshot, prepared.hash);
  return withTransaction(tx => publishDischargeDocumentInTransaction(tx, ctx, prepared, bytes));
}
/** Internal server composition only. Client actions accept reviewed IDs/hashes, never snapshots/bytes. */
export async function prepareDischargeDocumentInTransaction(tx: Transaction, ctx: CommandContext, value: unknown): Promise<PreparedDocument> {
  const v = input.parse(value); await documentOperator(tx, ctx); const e = await lockBillingAdmission(tx, v.admissionId);
  const source = await documentSourceInTransaction(tx, e), current = binding(source);
  if (canonicalJSON(v) !== canonicalJSON(current)) throw new DomainError("CONFLICT", "Reviewed document sources, bill or departure seals changed; refresh and review the current version");
  documentStorageDirectory();
  const [previous] = await tx.select().from(dischargeDocuments).where(eq(dischargeDocuments.admissionId, e.id)).orderBy(desc(dischargeDocuments.version)).limit(1);
  const same = previous?.sourceHash === current.expectedSourceHash ? previous : undefined;
  if (same) { await readPDF(same as StoredDocument); return { input: v, existing: { documentId: same.id, version: same.version, hash: same.hash } }; }
  const documentId = randomUUID(), version = (previous?.version ?? 0) + 1, createdAt = new Date();
  const snapshot: DischargeSnapshot = { ...source, documentId, version, createdAt: createdAt.toISOString(), verificationUrl: verificationURL(documentId), sourceHash: current.expectedSourceHash };
  return { input: v, existing: null, snapshot, hash: snapshotHash(snapshot), replacesDocumentId: previous?.id ?? null };
}
/** Reread material sources/current access under the same authority before short publication. */
export async function publishDischargeDocumentInTransaction(tx: Transaction, ctx: CommandContext, prepared: PreparedDocument, bytes: Buffer | null) {
  const v = input.parse(prepared.input), staff = await documentOperator(tx, ctx), e = await lockBillingAdmission(tx, v.admissionId);
  const current = binding(await documentSourceInTransaction(tx, e));
  if (canonicalJSON(v) !== canonicalJSON(current)) throw new DomainError("CONFLICT", "Sources changed during document preparation; review and generate the current copy");
  const [previous] = await tx.select().from(dischargeDocuments).where(eq(dischargeDocuments.admissionId, e.id)).orderBy(desc(dischargeDocuments.version)).limit(1);
  const same = previous?.sourceHash === current.expectedSourceHash ? previous : undefined;
  if (same) { await readPDF(same as StoredDocument); return { documentId: same.id, version: same.version, hash: same.hash }; }
  if (prepared.existing || !bytes) throw new DomainError("CONFLICT", "Prepared document predecessor is no longer available");
  const { snapshot, hash } = prepared, { documentId, version, createdAt: captured, verificationUrl, sourceHash, ...source } = snapshot;
  if (prepared.replacesDocumentId !== (previous?.id ?? null) || version !== (previous?.version ?? 0) + 1) throw new DomainError("CONFLICT", "Document predecessor changed; review the current version");
  if (!z.uuid().safeParse(documentId).success || !z.iso.datetime().safeParse(captured).success || verificationUrl !== verificationURL(documentId) || sourceHash !== current.expectedSourceHash || snapshotHash(source) !== sourceHash || snapshotHash(snapshot) !== hash || bytes.length > 10_485_760 || !bytes.subarray(0,5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new DomainError("PRECONDITION", "Prepared immutable document content or bytes are inconsistent");
  const directory = documentStorageDirectory(), createdAt = new Date(captured), storageKey = randomUUID(), pdfHash = byteHash(bytes);
  await mkdir(directory, { recursive: true });
  const folder = await lstat(directory); if (!folder.isDirectory() || folder.isSymbolicLink()) throw new DomainError("PRECONDITION", "Protected storage must be a regular project directory");
  // Minimal generated manifests retain identity even if file/metadata COMMIT is ambiguous.
  // Never delete an orphan on COMMIT error: its matching document may actually have committed.
  await writeFile(resolve(directory, `${storageKey}.manifest.json`), JSON.stringify({ storageKey, documentId, admissionId: e.id, version, sourceHash: snapshot.sourceHash, hash, pdfHash, sizeBytes: bytes.length, createdAt: snapshot.createdAt }), { flag: "wx", mode: 0o600 });
  await writeFile(resolve(directory, `${storageKey}.staging`), bytes, { flag: "wx", mode: 0o600 });
  await rename(resolve(directory, `${storageKey}.staging`), pathFor(storageKey));
  const row: StoredDocument = { id: documentId, admissionId: e.id, version, replacesDocumentId: previous?.id ?? null, sourceHash: snapshot.sourceHash, hash, snapshot, storageKey, pdfHash, sizeBytes: bytes.length, createdBy: staff.id, createdAt };
  await readPDF(row);
  await tx.insert(dischargeDocuments).values(row);
  await appendAudit(tx, ctx, { event: "document.created", entityType: "discharge-document", entityId: documentId, reason: "Immutable final-copy snapshot and protected PDF published from reviewed actual departure sources", beforeVersion: previous?.version, afterVersion: version });
  return { documentId, version, hash };
}
async function ownedDocument(tx: Transaction, ctx: CommandContext, documentId: string) {
  await documentOperator(tx, ctx);
  // Initial immutable lookup locates ownership only. Reread under admission ownership.
  const [located] = await tx.select({ admissionId: dischargeDocuments.admissionId }).from(dischargeDocuments).where(eq(dischargeDocuments.id, z.uuid().parse(documentId)));
  if (!located) throw new DomainError("FORBIDDEN", "Final document access denied");
  const e = await lockBillingAdmission(tx, located.admissionId);
  const [row] = await tx.select().from(dischargeDocuments).where(and(eq(dischargeDocuments.id, documentId), eq(dischargeDocuments.admissionId, e.id)));
  if (!row) throw new DomainError("FORBIDDEN", "Final document access denied");
  return { e, row: row as StoredDocument };
}
async function status(tx: Transaction, e: typeof admissions.$inferSelect, row: StoredDocument) {
  try { await readPDF(row); } catch (error) { if (error instanceof DomainError && error.code === "PRECONDITION") return "FILE_UNAVAILABLE" as const; throw error; }
  const [newer] = await tx.select({ id: dischargeDocuments.id }).from(dischargeDocuments).where(and(eq(dischargeDocuments.admissionId, e.id), sql`${dischargeDocuments.version}>${row.version}`)).limit(1);
  if (newer) return "SUPERSEDED" as const;
  try { return row.sourceHash === snapshotHash(await documentSourceInTransaction(tx, e)) ? "CURRENT" as const : "SOURCE_CHANGED" as const; }
  catch (error) { if (error instanceof DomainError && error.code === "PRECONDITION") return "SOURCE_CHANGED" as const; throw error; }
}
export async function getDischargeDocument(ctx: CommandContext, documentId: string) { return withTransaction(async tx => {
  const { e, row } = await ownedDocument(tx, ctx, documentId); assertSnapshot(row);
  const currentStatus = await status(tx, e, row);
  await appendAudit(tx, ctx, { event: "document.viewed", entityType: "discharge-document", entityId: row.id, reason: "Authorized final-copy delivery view" });
  return { ...row, status: currentStatus };
}); }
export async function verifyDocument(ctx: CommandContext, documentId: string) { return withTransaction(async tx => {
  const { e, row } = await ownedDocument(tx, ctx, documentId), currentStatus = await status(tx, e, row);
  await appendAudit(tx, ctx, { event: "document.verified", entityType: "discharge-document", entityId: row.id, reason: "Authenticated minimal document integrity and version verification" });
  return { documentId: row.id, version: row.version, hash: row.hash, pdfHash: row.pdfHash, status: currentStatus };
}); }
export async function downloadDischargeDocument(ctx: CommandContext, documentId: string) { return withTransaction(async tx => {
  const { row } = await ownedDocument(tx, ctx, documentId), bytes = await readPDF(row);
  await appendAudit(tx, ctx, { event: "document.downloaded", entityType: "discharge-document", entityId: row.id, reason: "Authorized protected final-copy PDF download" });
  return { bytes, name: `discharge-${row.id}-v${row.version}.pdf`, pdfHash: row.pdfHash };
}); }
export async function documentWorkspace(ctx: CommandContext) { return withTransaction(async tx => {
  await documentOperator(tx, ctx);
  return tx.select({ id: admissions.id, ipCode: admissions.ipCode }).from(admissions).where(eq(admissions.status, "DISCHARGED")).orderBy(desc(admissions.admittedAt));
}); }
