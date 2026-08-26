-- Node marker size (px diameter) + freeform arrow annotations (not path edges).
ALTER TABLE "my_maps_node" ADD COLUMN IF NOT EXISTS "size" integer NOT NULL DEFAULT 14;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_map_arrow" (
	"id" serial PRIMARY KEY NOT NULL,
	"my_maps_id" integer NOT NULL,
	"lat" double precision DEFAULT 0 NOT NULL,
	"lng" double precision DEFAULT 0 NOT NULL,
	"bearing" double precision DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#35D5A4' NOT NULL,
	"size" integer DEFAULT 28 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_arrow" ADD CONSTRAINT "my_map_arrow_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
