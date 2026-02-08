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
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"name" varchar(256) NOT NULL,
	"polygon" text,
	CONSTRAINT "destination_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "destination_node" (
	"destination_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	CONSTRAINT "destination_node_destination_id_node_id_pk" PRIMARY KEY("destination_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "edge" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_a_id" integer NOT NULL,
	"node_b_id" integer NOT NULL,
	"bi_directional" boolean DEFAULT true NOT NULL,
	"direction" boolean DEFAULT true NOT NULL,
	"distance" double precision NOT NULL,
	CONSTRAINT "edge_pair_unique" UNIQUE("node_a_id","node_b_id")
);
--> statement-breakpoint
CREATE TABLE "edge_nav_mode" (
	"edge_id" integer NOT NULL,
	"nav_mode_id" integer NOT NULL,
	CONSTRAINT "edge_nav_mode_edge_id_nav_mode_id_pk" PRIMARY KEY("edge_id","nav_mode_id")
);
--> statement-breakpoint
CREATE TABLE "nav_mode" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"through_building" boolean DEFAULT false NOT NULL,
	CONSTRAINT "nav_mode_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "node" (
	"id" serial PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"node_type" integer NOT NULL,
	"location" geometry(point) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_type" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	CONSTRAINT "node_type_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "route" (
	"id" serial PRIMARY KEY NOT NULL,
	"destination_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"user_id" text NOT NULL,
	"description" text,
	CONSTRAINT "route_user_name_unique" UNIQUE("user_id","name")
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
ALTER TABLE "destination_node" ADD CONSTRAINT "destination_node_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_node_a_id_node_id_fk" FOREIGN KEY ("node_a_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge" ADD CONSTRAINT "edge_node_b_id_node_id_fk" FOREIGN KEY ("node_b_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_nav_mode" ADD CONSTRAINT "edge_nav_mode_edge_id_edge_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_nav_mode" ADD CONSTRAINT "edge_nav_mode_nav_mode_id_nav_mode_id_fk" FOREIGN KEY ("nav_mode_id") REFERENCES "public"."nav_mode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_node_type_node_type_id_fk" FOREIGN KEY ("node_type") REFERENCES "public"."node_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_destination_node_dest" ON "destination_node" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "idx_destination_node_node" ON "destination_node" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_edge_a" ON "edge" USING btree ("node_a_id");--> statement-breakpoint
CREATE INDEX "idx_edge_b" ON "edge" USING btree ("node_b_id");--> statement-breakpoint
CREATE INDEX "idx_edge_nav_mode_edge" ON "edge_nav_mode" USING btree ("edge_id");--> statement-breakpoint
CREATE INDEX "idx_edge_nav_mode_mode" ON "edge_nav_mode" USING btree ("nav_mode_id");--> statement-breakpoint
CREATE INDEX "node_location_gist" ON "node" USING gist ("location");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");