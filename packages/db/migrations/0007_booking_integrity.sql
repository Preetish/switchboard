-- Booking integrity: overlapping bookings for a rep are rejected by an
-- exclusion constraint (not just identical start times), cancelled rows no
-- longer block their slot, a lead holds at most one live booking, and
-- idempotency keys are scoped to the lead.
--
-- Earlier builds could store several live bookings for one lead; keep the
-- first and cancel the rest so the new unique index can be created.
UPDATE "bookings" SET "status" = 'cancelled'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "submission_id" ORDER BY "created_at") AS rn
    FROM "bookings"
    WHERE "status" IN ('hold', 'confirmed') AND "submission_id" IS NOT NULL
  ) ranked
  WHERE rn > 1
);--> statement-breakpoint
DROP INDEX "bookings_user_start_uq";--> statement-breakpoint
DROP INDEX "bookings_idempotency_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_submission_uq" ON "bookings" USING btree ("submission_id") WHERE "bookings"."status" in ('hold', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_submission_idempotency_uq" ON "bookings" USING btree ("submission_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bookings_user_start_idx" ON "bookings" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_status_created_idx" ON "bookings" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_end_after_start" CHECK ("bookings"."end_at" > "bookings"."start_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_valid" CHECK ("bookings"."status" in ('hold', 'confirmed', 'cancelled'));--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- If this fails, two live bookings for one rep already overlap; cancel one
-- (UPDATE bookings SET status = 'cancelled' WHERE id = ...) and re-run.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
  "user_id" WITH =,
  tstzrange("start_at", "end_at") WITH &&
) WHERE ("status" IN ('hold', 'confirmed'));
