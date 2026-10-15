import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { admissionOperator } from "../admissions/commands";
import { appendAudit } from "../audit";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { user } from "../schema/auth";
import { availabilityCoordinators, doctorAvailability, doctorDirectory, doctorDirectoryVersions } from "./staff-schema";

const reason=z.string().trim().min(3).max(1000);
const period={startsAt:z.iso.datetime(),endsAt:z.iso.datetime()};
const orderedPeriod=(v:{startsAt:string;endsAt:string})=>new Date(v.endsAt)>new Date(v.startsAt);
export const saveDoctorInput=z.strictObject({id:z.uuid().optional(),name:z.string().trim().min(2).max(150),specialty:z.string().trim().min(2).max(150).optional(),active:z.boolean(),expectedVersion:z.number().int().min(0),reason,requestId:z.uuid()}).refine(v=>!!v.id===(v.expectedVersion>0),"New Doctors start at version zero; changes require their current version");
export const coordinatorInput=z.strictObject({nurseId:z.string().min(1).max(100),backupNurseId:z.string().min(1).max(100).optional(),...period,expectedVersion:z.number().int().min(0),reason,requestId:z.uuid()}).refine(orderedPeriod,"Shift end must follow its start").refine(v=>v.nurseId!==v.backupNurseId,"Backup must be a different Nurse");
export const doctorAvailabilityInput=z.strictObject({doctorId:z.uuid(),status:z.enum(["AVAILABLE","OT","LEAVE","OFF_DUTY"]),...period,expectedReturn:z.iso.datetime().optional(),remarks:reason,expectedVersion:z.number().int().min(0),requestId:z.uuid()}).refine(orderedPeriod,"Availability end must follow its start").refine(v=>!v.expectedReturn||new Date(v.expectedReturn)>=new Date(v.startsAt),"Expected return cannot precede this period");
export type SaveDoctorInput=z.input<typeof saveDoctorInput>;
export type CoordinatorInput=z.input<typeof coordinatorInput>;
export type DoctorAvailabilityInput=z.input<typeof doctorAvailabilityInput>;

async function lockRequest(tx:Transaction,ctx:CommandContext,operation:string,value:{requestId:string}) {
  if(ctx.requestId!==value.requestId) throw new DomainError("VALIDATION","Request keys disagree");
  const staffId=ctx.actor.type==="staff"?ctx.actor.staffId:"";
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mvp-staff:${operation}:${staffId}:${value.requestId}`},0))`);
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function assertReplay(record:{requestPayload:string},payload:string) {
  if(record.requestPayload!==payload) throw new DomainError("CONFLICT","Request key already used for different staff details");
}
const doctorResult=(record:typeof doctorDirectoryVersions.$inferSelect)=>({id:record.doctorId,name:record.name,specialty:record.specialty,active:record.active,version:record.version});
async function currentCoordinator(tx:Transaction) {
  const [record]=await tx.select().from(availabilityCoordinators).where(sql`${availabilityCoordinators.startsAt}<=clock_timestamp() and ${availabilityCoordinators.endsAt}>clock_timestamp()`).orderBy(desc(availabilityCoordinators.version)).limit(1);
  return record??null;
}

export async function getDoctorDirectory(ctx:CommandContext) {
  return withTransaction(async tx=>{
    await admissionOperator(ctx,["ADMIN","ADMISSION","NURSE"],tx);
    const versions=await tx.select().from(doctorDirectoryVersions).orderBy(desc(doctorDirectoryVersions.version));
    const latest=new Map<string,ReturnType<typeof doctorResult>>();
    for(const record of versions) if(!latest.has(record.doctorId))latest.set(record.doctorId,doctorResult(record));
    return [...latest.values()].sort((a,b)=>a.name.localeCompare(b.name));
  });
}
export async function saveDoctor(ctx:CommandContext,input:unknown) {
  const value=saveDoctorInput.parse(input);
  return withTransaction(async tx=>{
    const actor=await admissionOperator(ctx,["ADMIN"],tx),payload=await lockRequest(tx,ctx,"doctor",value);
    const [retry]=await tx.select().from(doctorDirectoryVersions).where(and(eq(doctorDirectoryVersions.recordedBy,actor.id),eq(doctorDirectoryVersions.requestId,value.requestId)));
    if(retry){assertReplay(retry,payload);return doctorResult(retry);}
    const id=value.id??randomUUID();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`doctor-directory:${id}`},0))`);
    const [last]=await tx.select().from(doctorDirectoryVersions).where(eq(doctorDirectoryVersions.doctorId,id)).orderBy(desc(doctorDirectoryVersions.version)).limit(1);
    if((last?.version??0)!==value.expectedVersion)throw new DomainError("CONFLICT","Doctor directory changed; refresh before saving");
    if(!value.id)await tx.insert(doctorDirectory).values({id});
    const [record]=await tx.insert(doctorDirectoryVersions).values({doctorId:id,name:value.name,specialty:value.specialty??null,active:value.active,version:value.expectedVersion+1,reason:value.reason,recordedBy:actor.id,requestId:value.requestId,requestPayload:payload}).returning();
    await appendAudit(tx,ctx,{event:"mvp.doctor-directory-saved",entityType:"doctor-directory",entityId:id,reason:value.reason,beforeVersion:value.expectedVersion||undefined,afterVersion:record.version});
    return doctorResult(record);
  });
}
export async function assignAvailabilityCoordinator(ctx:CommandContext,input:unknown) {
  const value=coordinatorInput.parse(input);
  return withTransaction(async tx=>{
    const actor=await admissionOperator(ctx,["ADMIN"],tx),payload=await lockRequest(tx,ctx,"coordinator",value);
    const [retry]=await tx.select().from(availabilityCoordinators).where(and(eq(availabilityCoordinators.recordedBy,actor.id),eq(availabilityCoordinators.requestId,value.requestId)));
    if(retry){assertReplay(retry,payload);return {id:retry.id};}
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('availability-coordinator',0))`);
    const [last]=await tx.select().from(availabilityCoordinators).orderBy(desc(availabilityCoordinators.version)).limit(1);
    if((last?.version??0)!==value.expectedVersion)throw new DomainError("CONFLICT","Coordinator roster changed; refresh before assigning");
    for(const id of [value.nurseId,value.backupNurseId].filter((id):id is string=>!!id).sort()) {
      const [nurse]=await tx.select().from(user).where(eq(user.id,id)).for("share");
      if(!nurse||nurse.banned||nurse.role!=="NURSE")throw new DomainError("VALIDATION","Coordinator and backup must be active Nurses");
    }
    const [record]=await tx.insert(availabilityCoordinators).values({nurseId:value.nurseId,backupNurseId:value.backupNurseId??null,startsAt:new Date(value.startsAt),endsAt:new Date(value.endsAt),version:value.expectedVersion+1,reason:value.reason,recordedBy:actor.id,requestId:value.requestId,requestPayload:payload}).returning();
    await appendAudit(tx,ctx,{event:"mvp.availability-coordinator-assigned",entityType:"availability-coordinator",entityId:record.id,reason:value.reason});
    return {id:record.id};
  });
}
export async function recordDoctorAvailability(ctx:CommandContext,input:unknown) {
  const value=doctorAvailabilityInput.parse(input);
  return withTransaction(async tx=>{
    const actor=await admissionOperator(ctx,["NURSE"],tx),payload=await lockRequest(tx,ctx,"availability",value);
    const [retry]=await tx.select().from(doctorAvailability).where(and(eq(doctorAvailability.recordedBy,actor.id),eq(doctorAvailability.requestId,value.requestId)));
    if(retry){assertReplay(retry,payload);return {id:retry.id};}
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('availability-coordinator',0))`);
    const coordinator=await currentCoordinator(tx);
    if(!coordinator||![coordinator.nurseId,coordinator.backupNurseId].includes(actor.id))throw new DomainError("FORBIDDEN","Only the current designated Nurse or backup may update Doctor availability");
    if(new Date(value.startsAt)<coordinator.startsAt||new Date(value.endsAt)>coordinator.endsAt)throw new DomainError("VALIDATION","Availability must fit the designated shift period");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`doctor-directory:${value.doctorId}`},0))`);
    const [doctor]=await tx.select().from(doctorDirectoryVersions).where(eq(doctorDirectoryVersions.doctorId,value.doctorId)).orderBy(desc(doctorDirectoryVersions.version)).limit(1);
    if(!doctor?.active)throw new DomainError("VALIDATION","Select an active directory Doctor");
    const [last]=await tx.select().from(doctorAvailability).where(eq(doctorAvailability.doctorId,value.doctorId)).orderBy(desc(doctorAvailability.version)).limit(1);
    if((last?.version??0)!==value.expectedVersion)throw new DomainError("CONFLICT","Doctor availability changed; refresh before recording");
    const [record]=await tx.insert(doctorAvailability).values({doctorId:value.doctorId,coordinatorId:coordinator.id,status:value.status,startsAt:new Date(value.startsAt),endsAt:new Date(value.endsAt),expectedReturn:value.expectedReturn?new Date(value.expectedReturn):null,remarks:value.remarks,version:value.expectedVersion+1,recordedBy:actor.id,requestId:value.requestId,requestPayload:payload}).returning();
    await appendAudit(tx,ctx,{event:"mvp.doctor-availability-recorded",entityType:"doctor-availability",entityId:record.id,reason:value.remarks});
    return {id:record.id};
  });
}
export async function getDoctorAvailability(ctx:CommandContext) {
  return withTransaction(async tx=>{
    await admissionOperator(ctx,["ADMIN","ADMISSION","NURSE"],tx);
    const coordinator=await currentCoordinator(tx);
    const [latestAssignment]=await tx.select().from(availabilityCoordinators).orderBy(desc(availabilityCoordinators.version)).limit(1);
    const history=await tx.select().from(doctorAvailability).orderBy(desc(doctorAvailability.version));
    const latest=new Map<string,typeof doctorAvailability.$inferSelect>();
    for(const record of history)if(!latest.has(record.doctorId))latest.set(record.doctorId,record);
    const asOf=new Date(),current=new Map<string,typeof doctorAvailability.$inferSelect>();
    for(const record of history)if(record.startsAt<=asOf&&asOf<record.endsAt&&!current.has(record.doctorId))current.set(record.doctorId,record);
    const nurses=await tx.select({id:user.id,name:user.name}).from(user).where(and(eq(user.role,"NURSE"),eq(user.banned,false))).orderBy(asc(user.name));
    return {coordinator,coordinatorVersion:latestAssignment?.version??0,records:[...latest.values()],currentRecords:[...current.values()],asOf,nurses};
  });
}
