ALTER TABLE "my_maps_node" ADD COLUMN IF NOT EXISTS "color" text DEFAULT '#35D5A4' NOT NULL;
--> statement-breakpoint
ALTER TABLE "my_map_edge" ADD COLUMN IF NOT EXISTS "color" text DEFAULT '#35D5A4' NOT NULL;
--> statement-breakpoint
ALTER TABLE "my_map_polygon" ADD COLUMN IF NOT EXISTS "color" text DEFAULT '#35D5A4' NOT NULL;
