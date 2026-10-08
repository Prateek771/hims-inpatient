import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const hims = pgSchema("hims");
export const hospitalSettings = hims.table("hospital_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  identity: jsonb("identity").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingVersions = hims.table("setting_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  kind: text("kind", { enum: ["tariff", "rule"] }).notNull(),
  version: integer("version").notNull(),
  // Each domain command must validate its concrete payload before use.
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  actorType: text("actor_type", { enum: ["staff", "system"] }).notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("setting_versions_hospital_kind_version").on(t.hospitalId, t.kind, t.version),
  check("setting_versions_positive", sql`${t.version} > 0`),
  check("setting_versions_kind", sql`${t.kind} in ('tariff', 'rule')`),
  check("setting_versions_actor", sql`${t.actorType} = 'staff' AND length(trim(${t.actorId})) > 0`),
  check("setting_versions_reason", sql`length(trim(${t.reason})) > 0`),
]);

export const auditEvents = hims.table("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type", { enum: ["staff", "system"] }).notNull(),
  actorId: text("actor_id").notNull(),
  source: text("source").notNull(),
  requestId: text("request_id").notNull(),
  event: text("event").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  reason: text("reason").notNull(),
  beforeVersion: integer("before_version"),
  afterVersion: integer("after_version"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_events_entity_time").on(t.entityType, t.entityId, t.occurredAt),
  index("audit_events_actor_time").on(t.actorType, t.actorId, t.occurredAt),
  check("audit_events_actor", sql`(${t.actorType} = 'staff' AND length(trim(${t.actorId})) > 0) OR (${t.actorType} = 'system' AND ${t.actorId} = 'room-charge')`),
  check("audit_events_required_text", sql`length(trim(${t.source})) > 0 AND length(trim(${t.requestId})) > 0 AND length(trim(${t.event})) > 0 AND length(trim(${t.entityType})) > 0 AND length(trim(${t.entityId})) > 0 AND length(trim(${t.reason})) > 0`),
  check("audit_events_versions", sql`(${t.beforeVersion} IS NULL OR ${t.beforeVersion} > 0) AND (${t.afterVersion} IS NULL OR ${t.afterVersion} > 0)`),
]);
