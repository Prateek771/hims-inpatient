import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { user } from "../schema/auth";
import { insuranceCases } from "./schema";
export type ManualSource={documentId:string;text:string};
export type PaperworkSource={caseVersion:number;documentVersion:number;reviewRevision:number;episodeVersion:number;ipCode:string;policyId:string|null;decisionId:string|null;documents:{id:string;name:string;sha256:string}[];manualSources:ManualSource[]};
export type PaperworkPacket={mode:"MANUAL_TEXT";caseId:string;ipCode:string;revision:number;notice:string;citations:PaperworkSource["documents"];quotedSources:ManualSource[];missing:string[];staffNextAction:string;reviewComment:string};
const signed=()=>({recordedBy:text("recorded_by").notNull().references(()=>user.id),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().defaultNow()});
export const paperworkRuns=hims.table("paperwork_runs",{
  id:uuid("id").primaryKey().defaultRandom(),caseId:uuid("case_id").notNull().references(()=>insuranceCases.id),source:jsonb("source").$type<PaperworkSource>().notNull(),sourceHash:text("source_hash").notNull(),status:text("status").notNull().default("PROCESSING"),revision:integer("revision").notNull().default(0),pendingReviewId:uuid("pending_review_id"),...signed(),
},t=>[index("paperwork_case").on(t.caseId,t.recordedAt),check("paperwork_run_state",sql`${t.status} in ('PROCESSING','AWAITING_REVIEW','ACCEPTED','REJECTED') and ${t.revision} between 0 and 3 and ${t.sourceHash} ~ '^[a-f0-9]{64}$'`)]);
export const paperworkProposals=hims.table("paperwork_proposals",{
  id:uuid("id").primaryKey().defaultRandom(),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),revision:integer("revision").notNull(),packet:jsonb("packet").$type<PaperworkPacket>().notNull(),packetHash:text("packet_hash").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_proposal_revision").on(t.runId,t.revision),check("paperwork_proposal_bound",sql`${t.revision} between 1 and 3 and ${t.packetHash} ~ '^[a-f0-9]{64}$'`)]);
export const paperworkReviews=hims.table("paperwork_reviews",{
  id:uuid("id").primaryKey().defaultRandom(),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),revision:integer("revision").notNull(),decision:text("decision").notNull(),comment:text("comment").notNull(),requestId:uuid("request_id").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_review_revision").on(t.runId,t.revision),uniqueIndex("paperwork_review_request").on(t.recordedBy,t.requestId),check("paperwork_review_decision",sql`${t.decision} in ('ACCEPT','REQUEST_CHANGES','REJECT') and ${t.revision} between 1 and 3 and (${t.decision}<>'REQUEST_CHANGES' or ${t.revision}<3)`)]);
export const paperworkPackets=hims.table("paperwork_packets",{
  id:uuid("id").primaryKey().defaultRandom(),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),proposalId:uuid("proposal_id").notNull().references(()=>paperworkProposals.id),reviewId:uuid("review_id").notNull().references(()=>paperworkReviews.id),packet:jsonb("packet").$type<PaperworkPacket>().notNull(),...signed(),
},t=>[uniqueIndex("paperwork_packet_once").on(t.runId)]);
export const paperworkFollowups=hims.table("paperwork_followups",{
  id:uuid("id").primaryKey().defaultRandom(),runId:uuid("run_id").notNull().references(()=>paperworkRuns.id),packetId:uuid("packet_id").notNull().references(()=>paperworkPackets.id),ownerId:text("owner_id").notNull().references(()=>user.id),action:text("action").notNull(),...signed(),
},t=>[uniqueIndex("paperwork_followup_once").on(t.runId)]);
