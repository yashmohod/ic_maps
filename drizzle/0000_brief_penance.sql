CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination" (
	"id" serial PRIMARY KEY NOT NULL,
	"lat" double precision DEFAULT 0 NOT NULL,
	"lng" double precision DEFAULT 0 NOT NULL,
	"name" varchar(256) NOT NULL,
	"polygon" text DEFAULT '',
	"is_parking_lot" boolean DEFAULT false NOT NULL,
	"open_time" time(6) with time zone DEFAULT '00:00:00' NOT NULL,
	"close_time" time(6) with time zone DEFAULT '23:59:59' NOT NULL,
	CONSTRAINT "destination_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "destination_node" (
	"destination_id" integer NOT NULL,
	"node_outside_id" integer NOT NULL,
	CONSTRAINT "destination_node_destination_id_node_outside_id_pk" PRIMARY KEY("destination_id","node_outside_id")
);
--> statement-breakpoint
CREATE TABLE "edge_inside" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_a_id" integer NOT NULL,
	"node_b_id" integer NOT NULL,
	"bi_directional" boolean DEFAULT true NOT NULL,
	"direction" boolean DEFAULT true NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"destination_id" integer NOT NULL,
	CONSTRAINT "edge_inside_pair_unique" UNIQUE("node_a_id","node_b_id")
);
--> statement-breakpoint
CREATE TABLE "edge_outside" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_a_id" integer NOT NULL,
	"node_b_id" integer NOT NULL,
	"bi_directional" boolean DEFAULT true NOT NULL,
	"direction" boolean DEFAULT true NOT NULL,
	"distance" double precision NOT NULL,
	"incline" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "edge_outside_pair_unique" UNIQUE("node_a_id","node_b_id")
);
--> statement-breakpoint
CREATE TABLE "nav_mode" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"through_building" boolean DEFAULT false NOT NULL,
	CONSTRAINT "nav_mode_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "node_inside" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_outside_id" integer,
	"parent_node_inside_id" integer,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"is_entry" boolean DEFAULT false NOT NULL,
	"is_exit" boolean DEFAULT false NOT NULL,
	"is_elevator" boolean DEFAULT false NOT NULL,
	"is_stairs" boolean DEFAULT false NOT NULL,
	"is_ramp" boolean DEFAULT false NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"incline" double precision DEFAULT 0,
	"width" double precision,
	"height" double precision,
	"destination_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_outside" (
	"id" serial PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"is_pedestrian" boolean DEFAULT false NOT NULL,
	"is_vehicular" boolean DEFAULT false NOT NULL,
	"is_elevator" boolean DEFAULT false NOT NULL,
	"is_stairs" boolean DEFAULT false NOT NULL,
	"is_blue_light" boolean DEFAULT false NOT NULL,
	"location" geometry(point) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"user_id" text NOT NULL,
	"description" text,
	CONSTRAINT "route_user_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "route_destination" (
	"order" integer NOT NULL,
	"destination_id" integer NOT NULL,
	"route_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_route_manager" boolean DEFAULT false NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_node" ADD CONSTRAINT "destination_node_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_node" ADD CONSTRAINT "destination_node_node_outside_id_node_outside_id_fk" FOREIGN KEY ("node_outside_id") REFERENCES "public"."node_outside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_inside" ADD CONSTRAINT "edge_inside_node_a_id_node_inside_id_fk" FOREIGN KEY ("node_a_id") REFERENCES "public"."node_inside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_inside" ADD CONSTRAINT "edge_inside_node_b_id_node_inside_id_fk" FOREIGN KEY ("node_b_id") REFERENCES "public"."node_inside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_inside" ADD CONSTRAINT "edge_inside_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_outside" ADD CONSTRAINT "edge_outside_node_a_id_node_outside_id_fk" FOREIGN KEY ("node_a_id") REFERENCES "public"."node_outside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_outside" ADD CONSTRAINT "edge_outside_node_b_id_node_outside_id_fk" FOREIGN KEY ("node_b_id") REFERENCES "public"."node_outside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_inside" ADD CONSTRAINT "node_inside_node_outside_id_node_outside_id_fk" FOREIGN KEY ("node_outside_id") REFERENCES "public"."node_outside"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_inside" ADD CONSTRAINT "node_inside_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_inside" ADD CONSTRAINT "node_inside_parent_fk" FOREIGN KEY ("parent_node_inside_id") REFERENCES "public"."node_inside"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_destination" ADD CONSTRAINT "route_destination_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_destination" ADD CONSTRAINT "route_destination_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "destination_node_destination_id_idx" ON "destination_node" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "destination_node_node_outside_id_idx" ON "destination_node" USING btree ("node_outside_id");--> statement-breakpoint
CREATE INDEX "idx_edge_inside_a" ON "edge_inside" USING btree ("node_a_id");--> statement-breakpoint
CREATE INDEX "idx_edge_inside_b" ON "edge_inside" USING btree ("node_b_id");--> statement-breakpoint
CREATE INDEX "edge_inside_destination_id_idx" ON "edge_inside" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "idx_edge_outside_a" ON "edge_outside" USING btree ("node_a_id");--> statement-breakpoint
CREATE INDEX "idx_edge_outside_b" ON "edge_outside" USING btree ("node_b_id");--> statement-breakpoint
CREATE INDEX "node_inside_destination_id_idx" ON "node_inside" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "node_inside_parent_idx" ON "node_inside" USING btree ("parent_node_inside_id");--> statement-breakpoint
CREATE INDEX "node_location_gist" ON "node_outside" USING gist ("location");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");