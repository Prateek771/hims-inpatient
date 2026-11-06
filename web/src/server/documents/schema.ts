import { sql } from "drizzle-orm";
import { check, customType, index, int, json, mysqlTable, primaryKey, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, utc, utcNow, key } from "../schema/columns";
import { admissions } from "../admissions/schema";
import { user } from "../schema/auth";
export const dischargeDocuments = mysqlTable("discharge_documents", {
  id: uuid("id").primaryKey(), admissionId: uuid("admission_id").notNull().references(() => admissions.id), version: int("version").notNull(),
  schemaVersion: int("schema_version").notNull().default(1), kind: text("kind").notNull().default("FINAL"),
  replacesDocumentId: uuid("replaces_document_id"), sourceHash: key("source_hash").notNull(), hash: text("hash").notNull(),
  snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(), storageKey: uuid("storage_key").notNull(), pdfHash: text("pdf_hash").notNull(), sizeBytes: int("size_bytes").notNull(),
  createdBy: key("created_by").notNull().references(() => user.id), createdAt: utc("created_at").notNull(),
}, t => [uniqueIndex("discharge_document_version").on(t.admissionId, t.version), index("discharge_document_source").on(t.admissionId, t.sourceHash), uniqueIndex("discharge_document_storage").on(t.storageKey), index("discharge_document_creator").on(t.createdBy), index("discharge_document_predecessor").on(t.replacesDocumentId), check("discharge_document_values", sql`${t.version}>0 and ${t.sizeBytes}>0 and ${t.sizeBytes}<=10485760 and ${t.hash} REGEXP '(?-i)^[0-9a-f]{64}$' and ${t.sourceHash} REGEXP '(?-i)^[0-9a-f]{64}$' and ${t.pdfHash} REGEXP '(?-i)^[0-9a-f]{64}$'`)]);

const longblob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });
/** Immutable stored file bytes: insurance documents, discharge PDFs and their manifests (see ../file-store.ts). */
export const protectedFiles = mysqlTable("protected_files", {
  kind: key("kind", 16).notNull().$type<"insurance" | "discharge">(), name: key("name", 128).notNull(), content: longblob("content").notNull(),
  sha256: key("sha256", 64).notNull(), sizeBytes: int("size_bytes").notNull(), createdAt: utc("created_at").notNull().default(utcNow),
}, t => [primaryKey({ columns: [t.kind, t.name] }), check("protected_files_kind_check", sql`${t.kind} in ('insurance', 'discharge')`)]);
