import "server-only";
import { and,desc,eq,isNull,lte,sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError,type CommandContext } from "../contracts";
import { withTransaction } from "../db";
import { admissions,beds,bedHolds,roomStays,effectiveRoomStays } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { user } from "../schema/auth";
import { billingRequest,roomPolicyInput,lockBillingAdmission } from "../billing/commands";
import { reconcileRoomChargesInTransaction } from "../billing/room-charges";
import { roomVacations,bedTurnovers } from "../discharge/schema";
import { shiftForCare } from "../nursing/commands";
import { appendAudit } from "../audit";
import { jsonSnapshot } from "../discharge/dependencies";
import { assertMvpDelivery } from "../documents/mvp";
import { ownMvpEpisode } from "./commands";
import { mvpState } from "./dependencies";
import { mvpExceptionEvents,mvpExceptionalDepartures,mvpRoomReturns } from "./schema";
const note=z.string().trim().min(3).max(2000),time=z.iso.datetime(),common={admissionId:z.uuid(),requestId:z.uuid(),expectedReviewHash:z.string().length(64)};
const clinicalType=z.enum(["PLANNED_EXIT","AGAINST_ADVICE","EXTERNAL_TRANSFER","DEATH","RETURN_TO_BED","RETURN_CANCELLED"]);
export const mvpExceptionInput=z.discriminatedUnion("action",[
  z.strictObject({...common,action:z.literal("clinical"),type:clinicalType,sourceId:z.uuid().optional(),authorizerName:note,sourceTime:time,evidence:note,notes:note}),
  z.strictObject({...common,action:z.literal("authorize"),type:z.enum(["CREDIT","INSURANCE_DELAY","INSURANCE_DENIAL","AGAINST_ADVICE","EXTERNAL_TRANSFER","DEATH","RETURN_TO_BED"]),clinicalId:z.uuid(),authority:note,reason:note,evidence:note,followUpOwnerId:z.string().min(1),sourceId:z.uuid().optional()}),
  z.strictObject({...common,action:z.literal("follow-up"),authorityId:z.uuid(),ownerId:z.string().min(1),note}),
  z.strictObject({...common,action:z.literal("vacancy"),clinicalId:z.uuid(),shiftId:z.uuid(),vacatedAt:time,waitingLocation:note,handover:note}),
  z.strictObject({...common,action:z.literal("deliver"),authorityId:z.uuid(),documentId:z.uuid(),recipient:note,deliveredAt:time,evidence:note}),
  z.strictObject({...common,action:z.literal("exit"),authorityId:z.uuid(),shiftId:z.uuid(),departedAt:time}),
  z.strictObject({...common,action:z.literal("return"),authorityId:z.uuid(),shiftId:z.uuid(),returnedAt:time,handover:note}),
]);
export type MvpExceptionInput=z.input<typeof mvpExceptionInput>;
export async function recordMvpException(ctx:CommandContext,input:unknown){
  const v=mvpExceptionInput.parse(input);if(v.requestId!==ctx.requestId)throw new DomainError("VALIDATION","Request keys disagree");
  return withTransaction(async tx=>{
    const {staff,e}=await ownMvpEpisode(tx,ctx,v.admissionId,v.action==="authorize"||v.action==="follow-up"?["ADMIN"]:v.action==="deliver"?["ADMIN","NURSE"]:["NURSE"]);
    return billingRequest(tx,ctx,`mvp.exception.${v.action}`,v,async()=>{
      const state=await mvpState(tx,e);if(v.expectedReviewHash!==state.reviewHash)throw new DomainError("CONFLICT","Review the current exception sources and obligations");
      if(v.action!=="follow-up"&&e.status!=="ADMITTED")throw new DomainError("PRECONDITION","New exceptional facts require an active episode; closed history remains retained");
      async function insert(action:string,type:string,sourceId:string|null,payload:Record<string,unknown>){const [row]=await tx.insert(mvpExceptionEvents).values({admissionId:e.id,action,type,sourceId,payload:jsonSnapshot({...payload,recorderName:staff.name}),billVersion:(await lockBillingAdmission(tx,e.id)).billRevision,recordedBy:staff.id}).returning();await appendAudit(tx,ctx,{event:`mvp.exception.${action.toLowerCase()}`,entityType:"mvp-exception-event",entityId:row.id,reason:String(payload.reason??payload.notes??payload.handover??payload.evidence??"Recorded accountable exception")});return row;}
      if(v.action==="clinical"){
        const at=new Date(v.sourceTime);if(at>new Date()||!e.admittedAt||at<e.admittedAt)throw new DomainError("VALIDATION","External clinical source time must fit the actual admission");
        if(v.type==="RETURN_TO_BED"&&(!state.vacancy||v.sourceId!==state.vacancy.id||at<state.vacancy.vacatedAt||state.exceptions.some(x=>x.action==="CLINICAL"&&x.type==="RETURN_TO_BED"&&x.sourceId===v.sourceId&&!state.exceptions.some(c=>c.type==="RETURN_CANCELLED"&&c.sourceId===x.id)&&!state.returns.some(r=>r.clinicalId===x.id))))throw new DomainError("PRECONDITION","One current unperformed external return instruction must bind the current vacancy");
        if(v.type==="RETURN_CANCELLED"){
          const original=state.exceptions.find(x=>x.id===v.sourceId&&x.action==="CLINICAL"&&x.type==="RETURN_TO_BED");
          if(!original||!state.vacancy||original.sourceId!==state.vacancy.id||state.returns.some(r=>r.clinicalId===original.id)||state.exceptions.some(c=>c.type==="RETURN_CANCELLED"&&c.sourceId===original.id)||at<new Date(String(original.payload.sourceTime)))throw new DomainError("PRECONDITION","Reconsideration must bind the current unperformed and uncancelled external return instruction");
        }
        return {id:(await insert("CLINICAL",v.type,v.sourceId??null,v)).id};
      }
      if(v.action==="authorize"){
        const clinical=state.exceptions.find(x=>x.id===v.clinicalId&&x.action==="CLINICAL"),expected=["CREDIT","INSURANCE_DELAY","INSURANCE_DENIAL"].includes(v.type)?"PLANNED_EXIT":v.type;
        const [owner]=await tx.select().from(user).where(eq(user.id,v.followUpOwnerId));
        if(!owner||owner.banned||clinical?.type!==expected||state.exceptions.find(x=>x.action==="CLINICAL")?.id!==clinical.id)throw new DomainError("PRECONDITION","Current named external disposition and active follow-up owner required");
        if(expected==="PLANNED_EXIT"&&state.exceptions.some(p=>p.action==="CLINICAL"&&p.type==="RETURN_TO_BED"&&!state.exceptions.some(c=>c.type==="RETURN_CANCELLED"&&c.sourceId===p.id)&&!state.returns.some(r=>r.clinicalId===p.id)))throw new DomainError("PRECONDITION","Planned exception exit requires actual return or source-bound external reconsideration first");
        if(v.type==="RETURN_TO_BED"&&(!state.vacancy||clinical.sourceId!==state.vacancy.id))throw new DomainError("PRECONDITION","Return authority must retain the current vacancy");
        if(["INSURANCE_DELAY","INSURANCE_DENIAL"].includes(v.type)){
          const result=await tx.execute(sql`select c.id,(select status from hims.insurance_decisions d where d.case_id=c.id order by case_version desc limit 1) status from hims.insurance_cases c where c.admission_id=${e.id} and c.id=${v.sourceId??null}`);
          if(!result.rows.length||(v.type==="INSURANCE_DENIAL"&&result.rows[0].status!=="REJECTED"))throw new DomainError("PRECONDITION","Exact current externally recorded insurance case/denial required");
        }
        const row=await insert("AUTHORITY",v.type,clinical.id,{...v,bill:state.bill,financial:state.financial,outstandingObligations:state.blockers});
        if(v.type==="RETURN_TO_BED"&&state.vacancy){const [turnover]=await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId,state.vacancy.stayId));if(!turnover)await tx.insert(bedTurnovers).values({bedId:e.bedId,stayId:state.vacancy.stayId,admissionId:e.id,vacatedAt:state.vacancy.vacatedAt,reason:"External Doctor return; actual turnover before reuse",signedBy:staff.id});}
        return {id:row.id};
      }
      if(v.action==="follow-up"){
        const source=state.exceptions.find(x=>x.id===v.authorityId&&x.action==="AUTHORITY"),[owner]=await tx.select().from(user).where(eq(user.id,v.ownerId));
        if(!source||!owner||owner.banned)throw new DomainError("PRECONDITION","Original Admin authority and active accountable owner required");
        return {id:(await insert("FOLLOWUP",source.type,source.id,{...v,reason:v.note})).id};
      }
      if(v.action==="vacancy"){
        const clinical=state.exceptions.find(x=>x.id===v.clinicalId&&x.action==="CLINICAL");if(!clinical||clinical.type.startsWith("RETURN"))throw new DomainError("PRECONDITION","External exit disposition required for exceptional vacancy");
        if(state.vacancy)throw new DomainError("CONFLICT","A factual current vacancy already exists");
        const {actual:T}=await shiftForCare(tx,staff,v.shiftId,e.id,v.vacatedAt);
        const [stay]=await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId,e.id),isNull(effectiveRoomStays.endedAt)));
        if(!stay||T<=stay.startedAt||(stay.lastReconciledAt&&T<stay.lastReconciledAt))throw new DomainError("CONFLICT","Vacancy conflicts with retained physical history");
        await tx.select().from(beds).where(eq(beds.id,stay.bedId)).for("update");
        await reconcileRoomChargesInTransaction(tx,{admissionId:e.id,cutoff:T,actorContext:ctx});await tx.update(roomStays).set({endedAt:T}).where(eq(roomStays.id,stay.id));
        const witness=await insert("VACANCY",clinical.type,clinical.id,{...v,stayId:stay.id});
        const [row]=await tx.insert(roomVacations).values({admissionId:e.id,stayId:stay.id,mvpExceptionId:witness.id,shiftId:v.shiftId,vacatedAt:T,waitingLocation:v.waitingLocation,handover:v.handover,signedBy:staff.id}).returning();return {id:row.id};
      }
      const authority=state.exceptions.find(x=>x.id===v.authorityId&&x.action==="AUTHORITY"),clinical=state.exceptions.find(x=>x.id===authority?.sourceId&&x.action==="CLINICAL");
      if(!authority||!clinical||state.exceptions.find(x=>x.action==="CLINICAL")?.id!==clinical.id)throw new DomainError("PRECONDITION","Current source-bound Admin authority and external clinical instruction required");
      if(v.action==="deliver"){
        const document=await assertMvpDelivery(tx,e,v.documentId,"FINAL",state,true);
        if((document.snapshot.exception as {id?:string}|undefined)?.id!==authority.id||new Date(v.deliveredAt)<document.createdAt||new Date(v.deliveredAt)>new Date())throw new DomainError("PRECONDITION","Exact current exceptional final papers and actual delivery time required");
        return {id:(await insert("DELIVERY",authority.type,authority.id,{...v,documentHash:document.hash})).id};
      }
      const {actual:T}=await shiftForCare(tx,staff,v.shiftId,e.id,v.action==="return"?v.returnedAt:v.departedAt);
      if(T<new Date(String(clinical.payload.sourceTime)))throw new DomainError("VALIDATION","Actual movement cannot precede the external instruction");
      if(v.action==="return"){
        if(authority.type!=="RETURN_TO_BED"||!state.vacancy||clinical.sourceId!==state.vacancy.id||state.exceptions.some(x=>x.type==="RETURN_CANCELLED"&&x.sourceId===clinical.id))throw new DomainError("PRECONDITION","Current uncancelled return instruction must bind this vacancy");
        const [bed]=await tx.select().from(beds).where(eq(beds.id,e.bedId)).for("update");
        const clean=await tx.execute(sql`select 1 from hims.effective_bed_turnovers t left join hims.bed_turnover_completions c on c.turnover_id=t.id where t.bed_id=${bed.id} and (c.id is null or c.completed_at>${T})`);
        if(clean.rows.length)throw new DomainError("PRECONDITION","Authorized actual turnover must finish before returning to the held bed");
        const versions=await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId,e.hospitalId),lte(settingVersions.createdAt,T))).orderBy(desc(settingVersions.version)),tariff=versions.find(x=>x.payload.type==="tariff"&&x.payload.category===bed.category);
        if(!tariff)throw new DomainError("PRECONDITION","Actual return tariff required");roomPolicyInput.parse(tariff.payload);
        const [stay]=await tx.insert(roomStays).values({admissionId:e.id,bedId:bed.id,tariffVersionId:tariff.id,startedAt:T,lastReconciledAt:T}).returning();
        const [row]=await tx.insert(mvpRoomReturns).values({admissionId:e.id,vacationId:state.vacancy.id,authorityId:authority.id,clinicalId:clinical.id,stayId:stay.id,shiftId:v.shiftId,returnedAt:T,handover:v.handover,recordedBy:staff.id}).returning();
        await tx.update(admissions).set({version:sql`${admissions.version}+1`,billRevision:sql`${admissions.billRevision}+1`}).where(eq(admissions.id,e.id));return {id:row.id};
      }
      if(!state.vacancy||authority.type==="RETURN_TO_BED"||authority.billVersion!==e.billRevision||T<state.vacancy.vacatedAt)throw new DomainError("CONFLICT","Current exceptional financial authority and factual vacancy required");
      if(["CREDIT","INSURANCE_DELAY","INSURANCE_DENIAL"].includes(authority.type)&&!state.exceptions.some(x=>x.action==="DELIVERY"&&x.sourceId===authority.id&&new Date(String(x.payload.deliveredAt))<=T))throw new DomainError("PRECONDITION","Planned exceptional exit requires authorized papers delivered first");
      await tx.select().from(beds).where(eq(beds.id,e.bedId)).for("update");
      const [departure]=await tx.insert(mvpExceptionalDepartures).values({admissionId:e.id,authorityId:authority.id,clinicalId:clinical.id,stayId:state.vacancy.stayId,shiftId:v.shiftId,departedAt:T,snapshot:jsonSnapshot({authority,clinical,bill:state.bill,financial:state.financial,checks:state.checks,outstandingObligations:state.blockers,deliveries:state.exceptions.filter(x=>x.action==="DELIVERY")}),recordedBy:staff.id}).returning();
      await tx.update(admissions).set({status:"DISCHARGED",version:sql`${admissions.version}+1`}).where(eq(admissions.id,e.id));await tx.delete(bedHolds).where(eq(bedHolds.admissionId,e.id));
      const [turnover]=await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId,state.vacancy.stayId));if(!turnover)await tx.insert(bedTurnovers).values({bedId:e.bedId,stayId:state.vacancy.stayId,admissionId:e.id,vacatedAt:state.vacancy.vacatedAt,reason:"Actual exceptional exit; obligations and missing papers retained",signedBy:staff.id});
      await appendAudit(tx,ctx,{event:"mvp.exception.exit",entityType:"mvp-exceptional-departure",entityId:departure.id,reason:String(authority.payload.reason)});return {id:departure.id};
    });
  });
}
