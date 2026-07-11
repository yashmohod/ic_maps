CREATE TABLE IF NOT EXISTS "my_map_line" (
  "id" serial PRIMARY KEY NOT NULL,
  "my_maps_id" integer NOT NULL,
  "name" text DEFAULT '',
  "geometry" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_map_point" (
  "id" serial PRIMARY KEY NOT NULL,
  "my_maps_id" integer NOT NULL,
  "name" text DEFAULT '',
  "lat" double precision DEFAULT 0 NOT NULL,
  "lng" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_map_text" (
  "id" serial PRIMARY KEY NOT NULL,
  "my_maps_id" integer NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "lat" double precision DEFAULT 0 NOT NULL,
  "lng" double precision DEFAULT 0 NOT NULL,
  "font_size" integer DEFAULT 14 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_line" ADD CONSTRAINT "my_map_line_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_point" ADD CONSTRAINT "my_map_point_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_text" ADD CONSTRAINT "my_map_text_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
