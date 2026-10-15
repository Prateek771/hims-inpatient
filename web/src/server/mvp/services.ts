import "server-only";
import { and,asc,desc,eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError,type CommandContext } from "../contracts";
import { withTransaction,type Transaction } from "../db";
import { admissions } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { billingRequest,itemPolicyInput,postChargeInTransaction,resolveBillableRate } from "../billing/commands";
import { appendAudit } from "../audit";
import { ownMvpEpisode } from "./commands";
import { mvpExternalServices } from "./services-schema";
export const externalServiceCategories=["consultation","procedure","consumable","lab","radiology"] as const;
const note=z.string().trim().min(3).max(2000),reference=z.string().trim().min(1).max(200);
export const externalServiceChargeInput=z.strictObject({
  admissionId:z.uuid(),requestId:z.uuid(),expectedBillVersion:z.number().int().positive(),category:z.enum(externalServiceCategories),itemId:z.string().regex(/^[A-Z0-9_-]{2,32}$/),quantity:z.string(),unit:reference,expectedTariffVersionId:z.uuid(),performedAt:z.iso.datetime(),departmentIssuer:note,externalBillReference:reference,externalLineReference:reference,evidence:note,
});
export type ExternalServiceChargeInput=z.input<typeof externalServiceChargeInput>;
/** Staff record performed-service billing evidence; no professional clinical seal is asserted. */
export async function recordExternalServiceCharge(ctx:CommandContext,input:unknown){
  const v=externalServiceChargeInput.parse(input);
  if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  return withTransaction(async tx=>{
    const {staff,e}=await ownMvpEpisode(tx,ctx,v.admissionId,["ADMIN","BILLING"]);
    return billingRequest(tx,ctx,"mvp.external-service-charge",v,async()=>{
      if(e.status!=="ADMITTED")throw new DomainError("PRECONDITION","Performed-service charges require an active episode");
      if(e.billRevision!==v.expectedBillVersion)throw new DomainError("CONFLICT","Review the current bill before recording another source");
      const performed=new Date(v.performedAt);
      if(!e.admittedAt||performed<e.admittedAt||performed>new Date())throw new DomainError("VALIDATION","Performed time must fit this actual admission and cannot be in the future");
      const [old]=await tx.select({id:mvpExternalServices.id}).from(mvpExternalServices).where(and(eq(mvpExternalServices.admissionId,e.id),eq(mvpExternalServices.departmentIssuer,v.departmentIssuer),eq(mvpExternalServices.externalBillReference,v.externalBillReference),eq(mvpExternalServices.externalLineReference,v.externalLineReference)));
      if(old)throw new DomainError("CONFLICT","This external issuer bill line is already recorded; retain its original source");
      const id=randomUUID(),rate=await resolveBillableRate(tx,{itemId:v.itemId,eventKind:v.category,unit:v.unit,quantity:v.quantity});
      const charge=await postChargeInTransaction(tx,ctx,{admissionId:e.id,sourceEventId:id,category:v.category,itemId:v.itemId,quantity:v.quantity,unit:v.unit,tariffVersionId:v.expectedTariffVersionId,status:"FINAL"},rate);
      await tx.insert(mvpExternalServices).values({id,admissionId:e.id,chargeId:charge.id,category:v.category,itemId:v.itemId,quantity:v.quantity,unit:v.unit,tariffVersionId:rate.version.id,performedAt:performed,departmentIssuer:v.departmentIssuer,externalBillReference:v.externalBillReference,externalLineReference:v.externalLineReference,evidence:v.evidence,recordedBy:staff.id,recorderName:staff.name});
      await appendAudit(tx,ctx,{event:"mvp.external-service-recorded",entityType:"mvp-external-service",entityId:id,reason:"Staff recorded external performed-service billing evidence at the configured deterministic rate"});
      return {id};
    });
  });
}
export async function externalServiceProjection(tx:Transaction,e:typeof admissions.$inferSelect){
  const versions=await tx.select().from(settingVersions).where(and(eq(settingVersions.kind,"tariff"),eq(settingVersions.hospitalId,e.hospitalId))).orderBy(desc(settingVersions.version));
  const seen=new Set<string>(),serviceItems:{itemId:string;name:string;category:string;unit:string;quantityScale:number;tariffVersionId:string;unitPricePaise:string}[]=[];
  for(const version of versions){
    if(version.payload.type!=="billable-item")continue;
    const policy=itemPolicyInput.parse(version.payload);if(seen.has(policy.code))continue;seen.add(policy.code);
    if(policy.active&&externalServiceCategories.some(c=>c===policy.category))serviceItems.push({itemId:policy.code,name:policy.name,category:policy.category,unit:policy.unit,quantityScale:policy.quantityScale,tariffVersionId:version.id,unitPricePaise:policy.amount});
  }
  const serviceSources=await tx.select().from(mvpExternalServices).where(eq(mvpExternalServices.admissionId,e.id)).orderBy(asc(mvpExternalServices.recordedAt),asc(mvpExternalServices.id));
  return {serviceItems,serviceSources};
}
