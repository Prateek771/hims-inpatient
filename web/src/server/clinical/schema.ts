import { sql } from "drizzle-orm";
import { check, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { settingVersions } from "../schema/core";
import { user } from "../schema/auth";
import { admissions } from "../admissions/schema";
import type { ClinicalOrderDetails, PrescriptionLine } from "./input";
const time = (name: string) => utc(name);
const signed = () => ({
  signedBy: key("signed_by")
    .notNull()
    .references(() => user.id),
  signedAt: time("signed_at").notNull().default(utcNow),
});
export const clinicalRounds = mysqlTable(
  "clinical_rounds",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    notes: text("notes").notNull(),
    ...signed(),
  },
  (t) => [index("clinical_rounds_episode_idx").on(t.admissionId)],
);
export const clinicalAddenda = mysqlTable(
  "clinical_addenda",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    noteId: uuid("note_id")
      .notNull()
      .references(() => clinicalRounds.id),
    reason: text("reason").notNull(),
    text: text("text").notNull(),
    ...signed(),
  },
  (t) => [index("clinical_addenda_note_idx").on(t.noteId)],
);
export const clinicalOrders = mysqlTable(
  "clinical_orders",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    roundId: uuid("round_id")
      .notNull()
      .references(() => clinicalRounds.id),
    kind: text("kind").notNull(),
    requestedItem: text("requested_item").notNull(),
    details: json("details").$type<ClinicalOrderDetails>().notNull(),
    medicineItemId: text("medicine_item_id"),
    medicineCatalogVersionId: uuid("medicine_catalog_version_id").references(
      () => settingVersions.id,
    ),
    ...signed(),
  },
  (t) => [
    index("clinical_orders_episode_idx").on(t.admissionId),
    index("clinical_orders_round_idx").on(t.roundId),
    index("clinical_order_medicine_version_idx").on(t.medicineCatalogVersionId),
    check(
      "clinical_order_kind",
      sql`${t.kind} in ('MEDICINE','LAB','RADIOLOGY','PROCEDURE','DIET','VITALS')`,
    ),
    check(
      "clinical_medicine_identity",
      sql`(${t.medicineItemId} is null) = (${t.medicineCatalogVersionId} is null)`,
    ),
  ],
);
export const careTasks = mysqlTable(
  "care_tasks",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => clinicalOrders.id),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    ownerRole: text("owner_role").notNull(),
    createdAt: time("created_at").notNull().default(utcNow),
  },
  (t) => [index("care_tasks_episode_idx").on(t.admissionId)],
);
export const clinicalTaskEvents = mysqlTable(
  "clinical_task_events",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    orderId: uuid("order_id")
      .notNull()
      .references(() => clinicalOrders.id),
    status: key("status").notNull(),
    reason: text("reason").notNull(),
    ...signed(),
  },
  (t) => [
    index("clinical_task_events_order_idx").on(t.orderId),
    check("clinical_task_status", sql`${t.status} in ('COMPLETED','STOPPED')`),
    uniqueIndex("clinical_task_once_idx").on(t.orderId, t.status),
  ],
);
export const careOccurrences = mysqlTable(
  "care_occurrences",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => clinicalOrders.id),
    scheduledAt: time("scheduled_at").notNull(),
  },
  (t) => [
    uniqueIndex("care_occurrence_identity_idx").on(t.orderId, t.scheduledAt),
    index("care_occurrence_episode_idx").on(t.admissionId),
  ],
);
export const careBillingEvents = mysqlTable(
  "care_billing_events",
  {
    id: uuid("id").primaryKey(),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    orderId: uuid("order_id").references(() => clinicalOrders.id),
    roundId: uuid("round_id").references(() => clinicalRounds.id),
    category: text("category").notNull(),
    itemId: text("item_id").notNull(),
    quantity: text("quantity").notNull(),
    unit: text("unit").notNull(),
    tariffVersionId: uuid("tariff_version_id").references(
      () => settingVersions.id,
    ),
    resolutionReason: text("resolution_reason"),
    state: text("state", { enum: ["UNRESOLVED", "READY", "POSTED"] }).notNull(),
    createdAt: time("created_at").notNull().default(utcNow),
  },
  (t) => [
    index("care_billing_episode_idx").on(t.admissionId),
    index("care_billing_order_idx").on(t.orderId),
    index("care_billing_round_idx").on(t.roundId),
    index("care_billing_tariff_idx").on(t.tariffVersionId),
    check(
      "care_billing_state",
      sql`${t.state} in ('UNRESOLVED','READY','POSTED')`,
    ),
  ],
);
export const clinicalSummaries = mysqlTable(
  "clinical_summaries",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    version: int("version").notNull(),
    diagnosis: text("diagnosis").notNull(),
    course: text("course").notNull(),
    condition: text("condition").notNull(),
    followUp: text("follow_up").notNull(),
    advice: text("advice").notNull(),
    prescription: json("prescription").$type<PrescriptionLine[]>().notNull(),
    ...signed(),
  },
  (t) => [
    uniqueIndex("clinical_summary_version_idx").on(t.admissionId, t.version),
  ],
);
