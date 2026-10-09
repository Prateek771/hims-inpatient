CREATE TABLE "hims"."nurse_assignment_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"authority" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nurse_assignment_revocations_assignment_id_unique" UNIQUE("assignment_id")
);
--> statement-breakpoint
DROP INDEX "hims"."nurse_assignment_identity_idx";--> statement-breakpoint
ALTER TABLE "hims"."nurse_assignment_revocations" ADD CONSTRAINT "nurse_assignment_revocations_assignment_id_nurse_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "hims"."nurse_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hims"."nurse_assignment_revocations" ADD CONSTRAINT "nurse_assignment_revocations_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "hims"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nurse_assignment_identity_idx" ON "hims"."nurse_assignments" USING btree ("admission_id","nurse_id");