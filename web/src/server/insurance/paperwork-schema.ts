import { sql } from "drizzle-orm";
import { check, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { user } from "../schema/auth";
import { insuranceCases } from "./schema";
export type ManualSource={documentId:string;text:string};
export type PaperworkSource={caseVersion:number;documentVersion:number;reviewRevision:number;episodeVersion:number;ipCode:string;policyId:string|null;decisionId:string|null;documents:{id:string;name:string;sha256:string}[];manualSources:ManualSource[]};
export type PaperworkPacket={mode:"MANUAL_TEXT";caseId:string;ipCode:string;revision:number;notice:string;citations:PaperworkSource["documents"];quotedSources:ManualSource[];missing:string[];staffNextAction:string;reviewComment:string};
const signed=()=>({recordedBy:key("recorded_by").notNull().references(()=>user.id),recordedAt:utc("recorded_at").notNull().default(utcNow)});
export const paperworkRuns=mysqlTable("paperwork_runs",{
  id:uuid("id").primaryKey().default(uuidDefault),caseId:uuid("case_id").notNull().references(()=>insuranceCases.id),source:json("source").$type<PaperworkSource>().notNull(),sourceHash:text("source_hash").notNull(),status:text("status").notNull().default("PROCESSING"),revision:int("revision").notNull().default(0),pendingReviewId:uuid("pending_review_id"),...signed(),
},t=>[index("paperwork_case").on(t.caseId,t.recordedAt),check("paperwork_run_state",sql`${t.status} in ('PROCESSING','AWAITING_REVIEW','ACCEPTED','REJECTED') and ${t.revision} between 0 and 3 and ${t.sourceHash} REGEXP '(?-i)^[a-f0-9]{64}$'`)]);
export const paperworkProposals=mysqlTable("paperwork_proposals",{
  id:uuid("id").primaryKey().default(uuidDefault),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),revision:int("revision").notNull(),packet:json("packet").$type<PaperworkPacket>().notNull(),packetHash:text("packet_hash").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_proposal_revision").on(t.runId,t.revision),check("paperwork_proposal_bound",sql`${t.revision} between 1 and 3 and ${t.packetHash} REGEXP '(?-i)^[a-f0-9]{64}$'`)]);
export const paperworkReviews=mysqlTable("paperwork_reviews",{
  id:uuid("id").primaryKey().default(uuidDefault),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),revision:int("revision").notNull(),decision:text("decision").notNull(),comment:text("comment").notNull(),requestId:uuid("request_id").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_review_revision").on(t.runId,t.revision),uniqueIndex("paperwork_review_request").on(t.recordedBy,t.requestId),check("paperwork_review_decision",sql`${t.decision} in ('ACCEPT','REQUEST_CHANGES','REJECT') and ${t.revision} between 1 and 3 and (${t.decision}<>'REQUEST_CHANGES' or ${t.revision}<3)`)]);
export const paperworkPackets=mysqlTable("paperwork_packets",{
  id:uuid("id").primaryKey().default(uuidDefault),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),proposalId:uuid("proposal_id").notNull().references(()=>paperworkProposals.id),reviewId:uuid("review_id").notNull().references(()=>paperworkReviews.id),packet:json("packet").$type<PaperworkPacket>().notNull(),...signed(),
},t=>[uniqueIndex("paperwork_packet_once").on(t.runId)]);
export const paperworkFollowups=mysqlTable("paperwork_followups",{
  id:uuid("id").primaryKey().default(uuidDefault),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),packetId:uuid("packet_id").notNull().references(()=>paperworkPackets.id),ownerId:key("owner_id").notNull().references(()=>user.id),action:text("action").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_followup_once").on(t.runId)]);
