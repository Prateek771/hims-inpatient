CREATE TABLE "hims"."insurance_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"assigned_staff_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"review_revision" integer DEFAULT 1 NOT NULL,
	"document_set_revision" integer DEFAULT 0 NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_case_versions" CHECK ("hims"."insurance_cases"."version">0 and "hims"."insurance_cases"."review_revision">0 and "hims"."insurance_cases"."document_set_revision">=0)
);
--> statement-breakpoint
CREATE TABLE "hims"."insurance_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version" integer NOT NULL,
	"reason" text NOT NULL,
	"decision_reference" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"allocation" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."insurance_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version" integer NOT NULL,
	"policy_event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"approved_paise" bigint NOT NULL,
	"co_pay_bps" integer NOT NULL,
	"allocation" jsonb NOT NULL,
	"document_ids" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_decision_status" CHECK ("hims"."insurance_decisions"."status" in ('PENDING','APPROVED','PARTIAL','REJECTED')),
	CONSTRAINT "insurance_decision_kind" CHECK ("hims"."insurance_decisions"."kind" in ('PREAUTH','ENHANCEMENT','APPEAL')),
	CONSTRAINT "insurance_decision_money" CHECK ("hims"."insurance_decisions"."approved_paise">=0 and "hims"."insurance_decisions"."co_pay_bps" between 0 and 10000 and ("hims"."insurance_decisions"."status" not in ('PENDING','REJECTED') or "hims"."insurance_decisions"."approved_paise"=0))
);
--> statement-breakpoint
CREATE TABLE "hims"."insurance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"set_revision" integer NOT NULL,
	"replaces_document_id" uuid,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" uuid NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_document_type" CHECK ("hims"."insurance_documents"."mime" in ('application/pdf','image/jpeg','image/png')),
	CONSTRAINT "insurance_document_size" CHECK ("hims"."insurance_documents"."size_bytes">0 and "hims"."insurance_documents"."set_revision">0 and "hims"."insurance_documents"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "hims"."insurance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_event_kind" CHECK ("hims"."insurance_events"."kind" in ('ASSIGNMENT','POLICY','FOLLOWUP'))
);
--> statement-breakpoint
CREATE TABLE "hims"."insurance_transfer_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"decision_id" uuid,
	"conversion_id" uuid,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_transfer_source" CHECK (("hims"."insurance_transfer_resolutions"."decision_id" is not null) <> ("hims"."insurance_transfer_resolutions"."conversion_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "hims"."insurance_cases" ADD CONSTRAINT "insurance_cases_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hims"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_cases" ADD CONSTRAINT "insurance_cases_assigned_staff_id_staff_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_cases" ADD CONSTRAINT "insurance_cases_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_conversions" ADD CONSTRAINT "insurance_conversions_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_conversions" ADD CONSTRAINT "insurance_conversions_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_decisions" ADD CONSTRAINT "insurance_decisions_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_decisions" ADD CONSTRAINT "insurance_decisions_policy_event_id_insurance_events_id_fk" FOREIGN KEY ("policy_event_id") REFERENCES "hims"."insurance_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_decisions" ADD CONSTRAINT "insurance_decisions_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_documents" ADD CONSTRAINT "insurance_documents_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_documents" ADD CONSTRAINT "insurance_documents_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_events" ADD CONSTRAINT "insurance_events_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_events" ADD CONSTRAINT "insurance_events_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_transfer_resolutions" ADD CONSTRAINT "insurance_transfer_resolutions_case_id_insurance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "hims"."insurance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_transfer_resolutions" ADD CONSTRAINT "insurance_transfer_resolutions_task_id_transfer_insurance_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "hims"."transfer_insurance_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_transfer_resolutions" ADD CONSTRAINT "insurance_transfer_resolutions_decision_id_insurance_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "hims"."insurance_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_transfer_resolutions" ADD CONSTRAINT "insurance_transfer_resolutions_conversion_id_insurance_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "hims"."insurance_conversions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."insurance_transfer_resolutions" ADD CONSTRAINT "insurance_transfer_resolutions_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_case_admission" ON "hims"."insurance_cases" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "insurance_case_assignee" ON "hims"."insurance_cases" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_conversion_once" ON "hims"."insurance_conversions" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_decision_version" ON "hims"."insurance_decisions" USING btree ("case_id","case_version");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_document_storage" ON "hims"."insurance_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_document_revision" ON "hims"."insurance_documents" USING btree ("case_id","set_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_document_replacement" ON "hims"."insurance_documents" USING btree ("replaces_document_id");--> statement-breakpoint
CREATE INDEX "insurance_events_case" ON "hims"."insurance_events" USING btree ("case_id","case_version");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_transfer_resolved_once" ON "hims"."insurance_transfer_resolutions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "insurance_transfer_case" ON "hims"."insurance_transfer_resolutions" USING btree ("case_id");