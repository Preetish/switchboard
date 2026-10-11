-- Google Calendar is now connected per rep. Org-wide Google rows from earlier
-- builds cannot be attributed to a rep, so they are dropped; reps reconnect.
DELETE FROM "integrations" WHERE "provider" = 'google_calendar';--> statement-breakpoint
DROP INDEX "integrations_org_provider_uq";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_provider_uq" ON "integrations" USING btree ("user_id","provider") WHERE "integrations"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_uq" ON "integrations" USING btree ("org_id","provider") WHERE "integrations"."user_id" is null;