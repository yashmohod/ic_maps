CREATE TABLE IF NOT EXISTS "campus_entrance" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"node_outside_id" integer NOT NULL,
	CONSTRAINT "campus_entrance_node_outside_id_unique" UNIQUE("node_outside_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campus_entrance" ADD CONSTRAINT "campus_entrance_node_outside_id_node_outside_id_fk" FOREIGN KEY ("node_outside_id") REFERENCES "public"."node_outside"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_campus_entrance" (
	"route_id" integer NOT NULL,
	"campus_entrance_id" integer NOT NULL,
	CONSTRAINT "route_campus_entrance_route_id_campus_entrance_id_pk" PRIMARY KEY("route_id","campus_entrance_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_campus_entrance" ADD CONSTRAINT "route_campus_entrance_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_campus_entrance" ADD CONSTRAINT "route_campus_entrance_campus_entrance_id_campus_entrance_id_fk" FOREIGN KEY ("campus_entrance_id") REFERENCES "public"."campus_entrance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
