-- Rotation state per membership, case-insensitive rep emails, and the
-- indexes the erasure, routing, and cascade paths use.
UPDATE "team_members" SET "weight" = 1 WHERE "weight" <= 0;--> statement-breakpoint
UPDATE "team_members" SET "weekly_capacity" = 0 WHERE "weekly_capacity" < 0;--> statement-breakpoint
DROP INDEX "forms_org_slug_uq";--> statement-breakpoint
DROP INDEX "users_org_email_uq";--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "rr_credit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "forms_rule_set_idx" ON "forms" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX "submissions_org_email_idx" ON "submissions" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_uq" ON "users" USING btree ("org_id",lower("email"));--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_weight_positive" CHECK ("team_members"."weight" > 0);--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_capacity_nonnegative" CHECK ("team_members"."weekly_capacity" >= 0);