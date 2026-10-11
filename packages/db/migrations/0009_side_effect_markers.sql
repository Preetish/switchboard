ALTER TABLE "bookings" ADD COLUMN "confirmation_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "crm_synced_at" timestamp with time zone;