CREATE TABLE "accessibility_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"photo_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
ALTER TABLE "accessibility_report" ADD CONSTRAINT "accessibility_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
