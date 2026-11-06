import { sql } from "drizzle-orm";
import { check, index, json, mysqlTable, mysqlView, text } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";

import { user } from "../schema/auth";
import { admissions, beds, roomStays } from "../admissions/schema";
import { careOccurrences } from "../clinical/schema";
const time = (name: string) => utc(name);
const signed = () => ({
  signedBy: key("signed_by")
    .notNull()
    .references(() => user.id),
  signedAt: time("signed_at").notNull().default(utcNow),
});
export const nurseAssignments = mysqlTable(
  "nurse_assignments",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    nurseId: key("nurse_id")
      .notNull()
      .references(() => user.id),
    authority: text("authority").notNull(),
    reason: text("reason").notNull(),
    ...signed(),
  },
  (t) => [
    index("nurse_assignment_identity_idx").on(t.admissionId, t.nurseId),
    index("nurse_assignment_nurse_idx").on(t.nurseId),
  ],
);
export const nurseAssignmentRevocations = mysqlTable(
  "nurse_assignment_revocations",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    assignmentId: uuid("assignment_id")
      .notNull()
      .unique()
      .references(() => nurseAssignments.id),
    reason: text("reason").notNull(),
    authority: text("authority").notNull(),
    ...signed(),
  },
);
export const nursingShifts = mysqlTable(
  "nursing_shifts",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    nurseId: key("nurse_id")
      .notNull()
      .references(() => user.id),
    startedAt: time("started_at").notNull(),
    handover: text("handover").notNull(),
    ...signed(),
  },
  (t) => [
    index("nursing_shift_episode_idx").on(t.admissionId),
    index("nursing_shift_nurse_idx").on(t.nurseId),
  ],
);
export const nursingShiftEnds = mysqlTable("nursing_shift_ends", {
  id: uuid("id").primaryKey().default(uuidDefault),
  shiftId: uuid("shift_id")
    .notNull()
    .unique()
    .references(() => nursingShifts.id),
  endedAt: time("ended_at").notNull(),
  handover: text("handover").notNull(),
  ...signed(),
});
export const nursingObservations = mysqlTable(
  "nursing_observations",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => nursingShifts.id),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .unique()
      .references(() => careOccurrences.id),
    observedAt: time("observed_at").notNull(),
    values: json("values").$type<Record<string, number>>().notNull(),
    ...signed(),
  },
  (t) => [
    index("nursing_observation_episode_idx").on(t.admissionId),
    index("nursing_observation_shift_idx").on(t.shiftId),
  ],
);
export const medicationAdministrations = mysqlTable(
  "medication_administrations",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => nursingShifts.id),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .unique()
      .references(() => careOccurrences.id),
    actualAt: time("actual_at").notNull(),
    actualDose: text("actual_dose").notNull(),
    doseUnit: text("dose_unit").notNull(),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    ...signed(),
  },
  (t) => [
    index("mar_episode_idx").on(t.admissionId),
    index("mar_shift_idx").on(t.shiftId),
    check("mar_outcome", sql`${t.outcome} in ('GIVEN','HELD','REFUSED')`),
    check(
      "mar_reason",
      sql`${t.outcome}='GIVEN' or char_length(trim(${t.reason}))>0`,
    ),
  ],
);
export const nursingConsumables = mysqlTable(
  "nursing_consumables",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => nursingShifts.id),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => beds.id),
    stayId: uuid("stay_id")
      .notNull()
      .references(() => roomStays.id),
    usedAt: time("used_at").notNull(),
    itemId: text("item_id").notNull(),
    quantity: text("quantity").notNull(),
    unit: text("unit").notNull(),
    reason: text("reason").notNull(),
    ...signed(),
  },
  (t) => [
    index("nursing_consumable_episode_idx").on(t.admissionId),
    index("nursing_consumable_shift_idx").on(t.shiftId),
    index("nursing_consumable_stay_idx").on(t.stayId),
    index("nursing_consumable_bed_idx").on(t.bedId),
  ],
);
export const nursingAddenda = mysqlTable(
  "nursing_addenda",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    reason: text("reason").notNull(),
    text: text("text").notNull(),
    ...signed(),
  },
  (t) => [
    index("nursing_addendum_episode_idx").on(t.admissionId),
    index("nursing_addendum_record_idx").on(t.recordId),
    check(
      "nursing_addendum_type",
      sql`${t.recordType} in ('MAR','OBSERVATION','SHIFT','CONSUMABLE')`,
    ),
  ],
);

export const effectiveShiftEnds = mysqlView("effective_shift_ends", {
 id:uuid("id").notNull(),shiftId:uuid("shift_id").notNull(),endedAt:time("ended_at").notNull(),handover:text("handover"),signedBy:text("signed_by").notNull(),signedAt:time("signed_at").notNull(),endKind:text("end_kind").notNull(),operationalEvidence:text("operational_evidence"),
}).existing();
