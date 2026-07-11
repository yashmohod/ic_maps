CREATE TABLE IF NOT EXISTS "my_maps" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "is_public_view" boolean DEFAULT false NOT NULL,
  "owner_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_maps_collaborator" (
  "my_maps_id" integer NOT NULL,
  "collaborator_id" text NOT NULL,
  "role" text DEFAULT 'viewer' NOT NULL,
  CONSTRAINT "my_maps_collaborator_my_maps_id_collaborator_id_pk" PRIMARY KEY("my_maps_id","collaborator_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_maps_node" (
  "id" serial PRIMARY KEY NOT NULL,
  "my_maps_id" integer NOT NULL,
  "name" text DEFAULT '',
  "lat" double precision DEFAULT 0 NOT NULL,
  "lng" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_map_polygon" (
  "id" serial PRIMARY KEY NOT NULL,
  "my_maps_id" integer NOT NULL,
  "name" text DEFAULT '',
  "polygon" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_map_edge" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text DEFAULT '',
  "node_a_id" integer NOT NULL,
  "node_b_id" integer NOT NULL,
  "bi_directional" boolean DEFAULT true NOT NULL,
  "direction" boolean DEFAULT true NOT NULL,
  "distance" double precision NOT NULL,
  "incline" double precision DEFAULT 0 NOT NULL,
  CONSTRAINT "my_map_edge_pair_unique" UNIQUE("node_a_id","node_b_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_maps" ADD CONSTRAINT "my_maps_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_maps_collaborator" ADD CONSTRAINT "my_maps_collaborator_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_maps_collaborator" ADD CONSTRAINT "my_maps_collaborator_collaborator_id_user_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_maps_node" ADD CONSTRAINT "my_maps_node_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_polygon" ADD CONSTRAINT "my_map_polygon_my_maps_id_my_maps_id_fk" FOREIGN KEY ("my_maps_id") REFERENCES "public"."my_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_edge" ADD CONSTRAINT "my_map_edge_node_a_id_my_maps_node_id_fk" FOREIGN KEY ("node_a_id") REFERENCES "public"."my_maps_node"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "my_map_edge" ADD CONSTRAINT "my_map_edge_node_b_id_my_maps_node_id_fk" FOREIGN KEY ("node_b_id") REFERENCES "public"."my_maps_node"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_my_map_edge_a" ON "my_map_edge" USING btree ("node_a_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_my_map_edge_b" ON "my_map_edge" USING btree ("node_b_id");
