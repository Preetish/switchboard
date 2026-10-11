ALTER TABLE "bookings" DROP CONSTRAINT "bookings_submission_id_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;