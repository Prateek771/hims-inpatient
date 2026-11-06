import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type Transaction } from "./db";
import { protectedFiles } from "./documents/schema";

export type FileKind = "insurance" | "discharge";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Protected insurance documents, discharge PDFs and their manifests live in the database (table protected_files):
 * the hosting platform replaces the application folder on every deploy, so local files would be lost. A file is
 * written in the same transaction as the record that references it, is immutable (append-only trigger), and is
 * backed up with the rest of the database.
 */
export async function putFile(tx: Pick<Transaction, "insert">, kind: FileKind, name: string, bytes: Uint8Array) {
  await tx.insert(protectedFiles).values({ kind, name, content: Buffer.from(bytes), sha256: sha256(bytes), sizeBytes: bytes.length });
}

/** The stored bytes, or null when absent. Callers still verify size and content hash against their own metadata. */
export async function getFile(kind: FileKind, name: string, reader: Pick<Transaction, "select"> = db): Promise<Buffer | null> {
  const [row] = await reader.select({ content: protectedFiles.content }).from(protectedFiles).where(and(eq(protectedFiles.kind, kind), eq(protectedFiles.name, name)));
  return row ? Buffer.from(row.content) : null;
}
