import { sql } from "drizzle-orm";
import { check, index, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, utc, utcNow, key } from "../schema/columns";
import { settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
import { charges } from "../billing/schema";
import { user } from "../schema/auth";
export const mvpExternalServices=mysqlTable("mvp_external_services",{
  id:uuid("id").primaryKey(),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),chargeId:uuid("charge_id").notNull().references(()=>charges.id),
  category:text("category").notNull(),itemId:text("item_id").notNull(),quantity:text("quantity").notNull(),unit:text("unit").notNull(),tariffVersionId:uuid("tariff_version_id").notNull().references(()=>settingVersions.id),
  performedAt:utc("performed_at").notNull(),departmentIssuer:key("department_issuer",64).notNull(),externalBillReference:key("external_bill_reference").notNull(),externalLineReference:key("external_line_reference").notNull(),evidence:text("evidence").notNull(),
  recordedBy:key("recorded_by").notNull().references(()=>user.id),recorderName:text("recorder_name").notNull(),recordedAt:utc("recorded_at").notNull().default(utcNow),
},t=>[uniqueIndex("mvp_external_charge_once").on(t.chargeId),uniqueIndex("mvp_external_bill_line_once").on(t.admissionId,t.departmentIssuer,t.externalBillReference,t.externalLineReference),index("mvp_external_episode").on(t.admissionId,t.recordedAt),check("mvp_external_category",sql`${t.category} in ('consultation','procedure','consumable','lab','radiology')`)]);
