import { sql } from "drizzle-orm";
import { boolean, index, int, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { user } from "../schema/auth";

const time = (name:string) => utc(name);
const attribution = () => ({recordedBy:key("recorded_by").notNull().references(()=>user.id),recordedAt:time("recorded_at").notNull().default(utcNow),requestId:uuid("request_id").notNull(),requestPayload:text("request_payload").notNull()});
// The identity is permanent; every directory edit appends a separately attributable version.
export const doctorDirectory = mysqlTable("doctor_directory",{id:uuid("id").primaryKey().default(uuidDefault),createdAt:time("created_at").notNull().default(utcNow)});
export const doctorDirectoryVersions = mysqlTable("doctor_directory_versions",{
  id:uuid("id").primaryKey().default(uuidDefault),doctorId:uuid("doctor_id").notNull().references(()=>doctorDirectory.id),
  name:text("name").notNull(),specialty:text("specialty"),active:boolean("active").notNull(),version:int("version").notNull(),reason:text("reason").notNull(),...attribution(),
},t=>[uniqueIndex("doctor_directory_version_idx").on(t.doctorId,t.version),uniqueIndex("doctor_directory_retry_idx").on(t.recordedBy,t.requestId)]);
export const availabilityCoordinators = mysqlTable("availability_coordinators",{
  id:uuid("id").primaryKey().default(uuidDefault),nurseId:key("nurse_id").notNull().references(()=>user.id),backupNurseId:key("backup_nurse_id").references(()=>user.id),
  startsAt:time("starts_at").notNull(),endsAt:time("ends_at").notNull(),version:int("version").notNull().unique(),reason:text("reason").notNull(),...attribution(),
},t=>[uniqueIndex("availability_coordinator_retry_idx").on(t.recordedBy,t.requestId),index("availability_coordinator_nurse_idx").on(t.nurseId),index("availability_coordinator_backup_idx").on(t.backupNurseId)]);
export const doctorAvailability = mysqlTable("doctor_availability",{
  id:uuid("id").primaryKey().default(uuidDefault),doctorId:uuid("doctor_id").notNull().references(()=>doctorDirectory.id),coordinatorId:uuid("coordinator_id").notNull().references(()=>availabilityCoordinators.id),
  status:text("status",{enum:["AVAILABLE","OT","LEAVE","OFF_DUTY"]}).notNull(),startsAt:time("starts_at").notNull(),endsAt:time("ends_at").notNull(),expectedReturn:time("expected_return"),remarks:text("remarks").notNull(),version:int("version").notNull(),...attribution(),
},t=>[uniqueIndex("doctor_availability_version_idx").on(t.doctorId,t.version),uniqueIndex("doctor_availability_retry_idx").on(t.recordedBy,t.requestId),index("doctor_availability_coordinator_idx").on(t.coordinatorId)]);
