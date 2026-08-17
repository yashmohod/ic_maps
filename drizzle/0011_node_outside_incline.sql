-- Move outdoor slope from edges onto nodes (indoor-style).
-- Migrate existing edge incline → max onto endpoint nodes, then drop edge incline + is_ramp.

ALTER TABLE "node_outside" ADD COLUMN IF NOT EXISTS "incline" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "node_outside" AS n
SET incline = GREATEST(
  n.incline,
  COALESCE((
    SELECT MAX(e.incline)
    FROM "edge_outside" e
    WHERE e.node_a_id = n.id OR e.node_b_id = n.id
  ), 0)
);
--> statement-breakpoint
ALTER TABLE "node_outside" DROP COLUMN IF EXISTS "is_ramp";
--> statement-breakpoint
ALTER TABLE "edge_outside" DROP COLUMN IF EXISTS "incline";
