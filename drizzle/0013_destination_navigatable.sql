-- Appear in main-map navigate dropdown when true. Default false for new rows;
-- backfill existing destinations to true so current campus list stays navigable.
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "navigatable_destination" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "destination" SET "navigatable_destination" = true;
