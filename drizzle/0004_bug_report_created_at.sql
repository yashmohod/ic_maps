ALTER TABLE "bug_report" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();
