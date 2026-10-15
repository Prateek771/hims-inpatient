import { sql } from "drizzle-orm";
import { check,index,text,timestamp,uniqueIndex,uuid } from "drizzle-orm/pg-core";
import { hims,settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
import { charges } from "../billing/schema";
import { user } from "../schema/auth";
export const mvpExternalServices=hims.table("mvp_external_services",{
  id:uuid("id").primaryKey(),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),chargeId:uuid("charge_id").notNull().references(()=>charges.id),
  category:text("category").notNull(),itemId:text("item_id").notNull(),quantity:text("quantity").notNull(),unit:text("unit").notNull(),tariffVersionId:uuid("tariff_version_id").notNull().references(()=>settingVersions.id),
  performedAt:timestamp("performed_at",{withTimezone:true}).notNull(),departmentIssuer:text("department_issuer").notNull(),externalBillReference:text("external_bill_reference").notNull(),externalLineReference:text("external_line_reference").notNull(),evidence:text("evidence").notNull(),
  recordedBy:text("recorded_by").notNull().references(()=>user.id),recorderName:text("recorder_name").notNull(),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[uniqueIndex("mvp_external_charge_once").on(t.chargeId),uniqueIndex("mvp_external_bill_line_once").on(t.admissionId,t.departmentIssuer,t.externalBillReference,t.externalLineReference),index("mvp_external_episode").on(t.admissionId,t.recordedAt),check("mvp_external_category",sql`${t.category} in ('consultation','procedure','consumable','lab','radiology')`)]);
