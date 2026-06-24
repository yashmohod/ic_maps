ALTER TABLE "node_outside" ADD COLUMN IF NOT EXISTS "is_dead" boolean NOT NULL DEFAULT false;
ALTER TABLE "node_inside" ADD COLUMN IF NOT EXISTS "is_dead" boolean NOT NULL DEFAULT false;
