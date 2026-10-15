import { sql } from "drizzle-orm";
import { boolean, integer, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { user } from "../schema/auth";

const time = (name:string) => timestamp(name,{withTimezone:true});
const attribution = () => ({recordedBy:text("recorded_by").notNull().references(()=>user.id),recordedAt:time("recorded_at").notNull().default(sql`clock_timestamp()`),requestId:uuid("request_id").notNull(),requestPayload:text("request_payload").notNull()});
// The identity is permanent; every directory edit appends a separately attributable version.
export const doctorDirectory = hims.table("doctor_directory",{id:uuid("id").primaryKey().defaultRandom(),createdAt:time("created_at").notNull().defaultNow()});
export const doctorDirectoryVersions = hims.table("doctor_directory_versions",{
  id:uuid("id").primaryKey().defaultRandom(),doctorId:uuid("doctor_id").notNull().references(()=>doctorDirectory.id),
  name:text("name").notNull(),specialty:text("specialty"),active:boolean("active").notNull(),version:integer("version").notNull(),reason:text("reason").notNull(),...attribution(),
},t=>[uniqueIndex("doctor_directory_version_idx").on(t.doctorId,t.version),uniqueIndex("doctor_directory_retry_idx").on(t.recordedBy,t.requestId)]);
export const availabilityCoordinators = hims.table("availability_coordinators",{
  id:uuid("id").primaryKey().defaultRandom(),nurseId:text("nurse_id").notNull().references(()=>user.id),backupNurseId:text("backup_nurse_id").references(()=>user.id),
  startsAt:time("starts_at").notNull(),endsAt:time("ends_at").notNull(),version:integer("version").notNull().unique(),reason:text("reason").notNull(),...attribution(),
},t=>[uniqueIndex("availability_coordinator_retry_idx").on(t.recordedBy,t.requestId),index("availability_coordinator_nurse_idx").on(t.nurseId),index("availability_coordinator_backup_idx").on(t.backupNurseId)]);
export const doctorAvailability = hims.table("doctor_availability",{
  id:uuid("id").primaryKey().defaultRandom(),doctorId:uuid("doctor_id").notNull().references(()=>doctorDirectory.id),coordinatorId:uuid("coordinator_id").notNull().references(()=>availabilityCoordinators.id),
  status:text("status",{enum:["AVAILABLE","OT","LEAVE","OFF_DUTY"]}).notNull(),startsAt:time("starts_at").notNull(),endsAt:time("ends_at").notNull(),expectedReturn:time("expected_return"),remarks:text("remarks").notNull(),version:integer("version").notNull(),...attribution(),
},t=>[uniqueIndex("doctor_availability_version_idx").on(t.doctorId,t.version),uniqueIndex("doctor_availability_retry_idx").on(t.recordedBy,t.requestId),index("doctor_availability_coordinator_idx").on(t.coordinatorId)]);
