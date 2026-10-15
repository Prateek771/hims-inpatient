import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { admissions } from "../admissions/schema";
import { user } from "../schema/auth";
export const dischargeDocuments = hims.table("discharge_documents", {
  id: uuid("id").primaryKey(), admissionId: uuid("admission_id").notNull().references(() => admissions.id), version: integer("version").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1), kind: text("kind").notNull().default("FINAL"),
  replacesDocumentId: uuid("replaces_document_id"), sourceHash: text("source_hash").notNull(), hash: text("hash").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(), storageKey: uuid("storage_key").notNull(), pdfHash: text("pdf_hash").notNull(), sizeBytes: integer("size_bytes").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, t => [uniqueIndex("discharge_document_version").on(t.admissionId, t.version), index("discharge_document_source").on(t.admissionId, t.sourceHash), uniqueIndex("discharge_document_storage").on(t.storageKey), index("discharge_document_creator").on(t.createdBy), index("discharge_document_predecessor").on(t.replacesDocumentId), check("discharge_document_values", sql`${t.version}>0 and ${t.sizeBytes}>0 and ${t.sizeBytes}<=10485760 and ${t.hash}~'^[0-9a-f]{64}$' and ${t.sourceHash}~'^[0-9a-f]{64}$' and ${t.pdfHash}~'^[0-9a-f]{64}$'`)]);
