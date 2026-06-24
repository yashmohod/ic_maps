CREATE TABLE "route_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text,
	"location_type" varchar(32) NOT NULL,
	"destination_id" integer,
	"feature_type" varchar(32),
	"node_outside_id" integer,
	"node_inside_id" integer,
	"pin_lat" double precision,
	"pin_lng" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
ALTER TABLE "route_report" ADD CONSTRAINT "route_report_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "route_report" ADD CONSTRAINT "route_report_node_outside_id_node_outside_id_fk" FOREIGN KEY ("node_outside_id") REFERENCES "public"."node_outside"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "route_report" ADD CONSTRAINT "route_report_node_inside_id_node_inside_id_fk" FOREIGN KEY ("node_inside_id") REFERENCES "public"."node_inside"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "route_report" ADD CONSTRAINT "route_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
