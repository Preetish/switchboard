ALTER TABLE "bookings" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idempotency_uq" ON "bookings" USING btree ("idempotency_key");