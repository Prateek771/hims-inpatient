CREATE TABLE "hims"."paperwork_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"action" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."paperwork_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"packet" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."paperwork_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"packet" jsonb NOT NULL,
	"packet_hash" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paperwork_proposal_bound" CHECK ("hims"."paperwork_proposals"."revision" between 1 and 3 and "hims"."paperwork_proposals"."packet_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "hims"."paperwork_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text NOT NULL,
	"request_id" uuid NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paperwork_review_decision" CHECK ("hims"."paperwork_reviews"."decision" in ('ACCEPT','REQUEST_CHANGES','REJECT') and "hims"."paperwork_reviews"."revision" between 1 and 3 and ("hims"."paperwork_reviews"."decision"<>'REQUEST_CHANGES' or "hims"."paperwork_reviews"."revision"<3))
);
--> statement-breakpoint
CREATE TABLE "hims"."paperwork_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"source" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"pending_review_id" uuid,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paperwork_run_state" CHECK ("hims"."paperwork_runs"."status" in ('PROCESSING','AWAITING_REVIEW','ACCEPTED','REJECTED') and "hims"."paperwork_runs"."revision" between 0 and 3 and "hims"."paperwork_runs"."source_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "hims"."paperwork_followups" ADD CONSTRAINT "paperwork_followups_run_id_paperwork_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "hims"."paperwork_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_followups" ADD CONSTRAINT "paperwork_followups_packet_id_paperwork_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "hims"."paperwork_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_followups" ADD CONSTRAINT "paperwork_followups_owner_id_staff_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_followups" ADD CONSTRAINT "paperwork_followups_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_packets" ADD CONSTRAINT "paperwork_packets_run_id_paperwork_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "hims"."paperwork_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_packets" ADD CONSTRAINT "paperwork_packets_proposal_id_paperwork_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "hims"."paperwork_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_packets" ADD CONSTRAINT "paperwork_packets_review_id_paperwork_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "hims"."paperwork_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_packets" ADD CONSTRAINT "paperwork_packets_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_proposals" ADD CONSTRAINT "paperwork_proposals_run_id_paperwork_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "hims"."paperwork_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_proposals" ADD CONSTRAINT "paperwork_proposals_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_reviews" ADD CONSTRAINT "paperwork_reviews_run_id_paperwork_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "hims"."paperwork_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_reviews" ADD CONSTRAINT "paperwork_reviews_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_runs" ADD CONSTRAINT "paperwork_runs_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."paperwork_runs" ADD CONSTRAINT "paperwork_runs_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paperwork_followup_once" ON "hims"."paperwork_followups" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paperwork_packet_once" ON "hims"."paperwork_packets" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paperwork_proposal_revision" ON "hims"."paperwork_proposals" USING btree ("run_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "paperwork_review_revision" ON "hims"."paperwork_reviews" USING btree ("run_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "paperwork_review_request" ON "hims"."paperwork_reviews" USING btree ("recorded_by","request_id");--> statement-breakpoint
CREATE INDEX "paperwork_case" ON "hims"."paperwork_runs" USING btree ("case_id","recorded_at");
