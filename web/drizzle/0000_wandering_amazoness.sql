CREATE SCHEMA "hims";
--> statement-breakpoint
CREATE TABLE "hims"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"source" text NOT NULL,
	"request_id" text,
	"event" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"reason" text NOT NULL,
	"before_version" integer,
	"after_version" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor" CHECK (("hims"."audit_events"."actor_type" = 'staff' AND length(trim("hims"."audit_events"."actor_id")) > 0) OR ("hims"."audit_events"."actor_type" = 'system' AND "hims"."audit_events"."actor_id" = 'room-charge')),
	CONSTRAINT "audit_events_required_text" CHECK (length(trim("hims"."audit_events"."source")) > 0 AND length(trim("hims"."audit_events"."event")) > 0 AND length(trim("hims"."audit_events"."entity_type")) > 0 AND length(trim("hims"."audit_events"."entity_id")) > 0 AND length(trim("hims"."audit_events"."reason")) > 0),
	CONSTRAINT "audit_events_versions" CHECK (("hims"."audit_events"."before_version" IS NULL OR "hims"."audit_events"."before_version" > 0) AND ("hims"."audit_events"."after_version" IS NULL OR "hims"."audit_events"."after_version" > 0))
);
--> statement-breakpoint
CREATE TABLE "hims"."hospital_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hims"."setting_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_versions_hospital_kind_version" UNIQUE("hospital_id","kind","version"),
	CONSTRAINT "setting_versions_positive" CHECK ("hims"."setting_versions"."version" > 0),
	CONSTRAINT "setting_versions_kind" CHECK ("hims"."setting_versions"."kind" in ('tariff', 'rule')),
	CONSTRAINT "setting_versions_actor" CHECK ("hims"."setting_versions"."actor_type" = 'staff' AND length(trim("hims"."setting_versions"."actor_id")) > 0),
	CONSTRAINT "setting_versions_reason" CHECK (length(trim("hims"."setting_versions"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "hims"."setting_versions" ADD CONSTRAINT "setting_versions_hospital_id_hospital_settings_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "hims"."hospital_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_time" ON "hims"."audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_time" ON "hims"."audit_events" USING btree ("actor_type","actor_id","occurred_at");