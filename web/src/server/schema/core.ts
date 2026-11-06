import { sql } from "drizzle-orm";
import { check, index, int, json, mysqlTable, text, unique } from "drizzle-orm/mysql-core";
import { key, utc, utcNow, uuid, uuidDefault } from "./columns";

export const hospitalSettings = mysqlTable("hospital_settings", {
  id: uuid("id").primaryKey().default(uuidDefault),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  identity: json("identity").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: utc("created_at").notNull().default(utcNow),
});

export const settingVersions = mysqlTable("setting_versions", {
  id: uuid("id").primaryKey().default(uuidDefault),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  kind: key("kind", 16).notNull().$type<"tariff" | "rule">(),
  version: int("version").notNull(),
  // Each domain command must validate its concrete payload before use.
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  actorType: key("actor_type", 16).notNull().$type<"staff" | "system">(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: utc("created_at").notNull().default(utcNow),
}, (t) => [
  unique("setting_versions_hospital_kind_version").on(t.hospitalId, t.kind, t.version),
  check("setting_versions_positive", sql`${t.version} > 0`),
  check("setting_versions_kind", sql`${t.kind} in ('tariff', 'rule')`),
  check("setting_versions_actor", sql`${t.actorType} = 'staff' AND char_length(trim(${t.actorId})) > 0`),
  check("setting_versions_reason", sql`char_length(trim(${t.reason})) > 0`),
]);

export const auditEvents = mysqlTable("audit_events", {
  id: uuid("id").primaryKey().default(uuidDefault),
  actorType: key("actor_type", 16).notNull().$type<"staff" | "system">(),
  actorId: key("actor_id").notNull(),
  source: text("source").notNull(),
  requestId: text("request_id").notNull(),
  event: text("event").notNull(),
  entityType: key("entity_type").notNull(),
  entityId: key("entity_id").notNull(),
  reason: text("reason").notNull(),
  beforeVersion: int("before_version"),
  afterVersion: int("after_version"),
  occurredAt: utc("occurred_at").notNull().default(utcNow),
}, (t) => [
  index("audit_events_entity_time").on(t.entityType, t.entityId, t.occurredAt),
  index("audit_events_actor_time").on(t.actorType, t.actorId, t.occurredAt),
  check("audit_events_actor", sql`(${t.actorType} = 'staff' AND char_length(trim(${t.actorId})) > 0) OR (${t.actorType} = 'system' AND ${t.actorId} = 'room-charge')`),
  check("audit_events_required_text", sql`char_length(trim(${t.source})) > 0 AND char_length(trim(${t.requestId})) > 0 AND char_length(trim(${t.event})) > 0 AND char_length(trim(${t.entityType})) > 0 AND char_length(trim(${t.entityId})) > 0 AND char_length(trim(${t.reason})) > 0`),
  check("audit_events_versions", sql`(${t.beforeVersion} IS NULL OR ${t.beforeVersion} > 0) AND (${t.afterVersion} IS NULL OR ${t.afterVersion} > 0)`),
]);
