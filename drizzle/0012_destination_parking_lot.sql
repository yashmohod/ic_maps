CREATE TABLE IF NOT EXISTS "destination_parking_lot" (
	"building_id" integer NOT NULL,
	"parking_lot_id" integer NOT NULL,
	CONSTRAINT "destination_parking_lot_building_id_parking_lot_id_pk" PRIMARY KEY("building_id","parking_lot_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "destination_parking_lot" ADD CONSTRAINT "destination_parking_lot_building_id_destination_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "destination_parking_lot" ADD CONSTRAINT "destination_parking_lot_parking_lot_id_destination_id_fk" FOREIGN KEY ("parking_lot_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
