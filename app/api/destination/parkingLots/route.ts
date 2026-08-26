import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { destination, destination_parking_lot } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guards";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/destination/parkingLots";

/** Replace recommended parking lots for a building. */
export async function PUT(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { buildingId, parkingLotIds } = body as {
      buildingId: unknown;
      parkingLotIds: unknown;
    };

    const bid = parseId(buildingId);
    if (!bid) {
      return NextResponse.json({ error: "Invalid buildingId" }, { status: 400 });
    }

    if (!Array.isArray(parkingLotIds)) {
      return NextResponse.json(
        { error: "parkingLotIds must be an array" },
        { status: 400 },
      );
    }

    const lotIds = [
      ...new Set(
        parkingLotIds
          .map((id) => parseId(id))
          .filter((id): id is number => id != null),
      ),
    ];

    const building = await db
      .select({
        id: destination.id,
        is_parking_lot: destination.is_parking_lot,
      })
      .from(destination)
      .where(eq(destination.id, bid))
      .limit(1)
      .then((rows) => rows[0]);

    if (!building) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 });
    }
    if (building.is_parking_lot) {
      return NextResponse.json(
        { error: "Cannot attach parking lots to a parking lot destination" },
        { status: 400 },
      );
    }

    if (lotIds.length > 0) {
      const lots = await db
        .select({
          id: destination.id,
          is_parking_lot: destination.is_parking_lot,
        })
        .from(destination)
        .where(inArray(destination.id, lotIds));

      if (lots.length !== lotIds.length) {
        return NextResponse.json(
          { error: "One or more parkingLotIds not found" },
          { status: 400 },
        );
      }
      if (lots.some((l) => !l.is_parking_lot)) {
        return NextResponse.json(
          { error: "All parkingLotIds must reference parking lot destinations" },
          { status: 400 },
        );
      }
    }

    await db
      .delete(destination_parking_lot)
      .where(eq(destination_parking_lot.building_id, bid));

    if (lotIds.length > 0) {
      await db.insert(destination_parking_lot).values(
        lotIds.map((parking_lot_id) => ({
          building_id: bid,
          parking_lot_id,
        })),
      );
    }

    console.log(`[API ${ROUTE} PUT]`, { buildingId: bid, parkingLotIds: lotIds });
    return NextResponse.json({ parkingLotIds: lotIds }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Could not update recommended parking lots",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}

/** List recommended parking lot ids for one building (or all buildings). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const buildingRaw = url.searchParams.get("buildingId");

    if (buildingRaw != null) {
      const bid = parseId(buildingRaw);
      if (!bid) {
        return NextResponse.json({ error: "Invalid buildingId" }, { status: 400 });
      }
      const rows = await db
        .select({ parking_lot_id: destination_parking_lot.parking_lot_id })
        .from(destination_parking_lot)
        .where(eq(destination_parking_lot.building_id, bid));
      return NextResponse.json({
        buildingId: bid,
        parkingLotIds: rows.map((r) => r.parking_lot_id),
      });
    }

    const rows = await db
      .select({
        building_id: destination_parking_lot.building_id,
        parking_lot_id: destination_parking_lot.parking_lot_id,
      })
      .from(destination_parking_lot);

    const byBuilding = new Map<number, number[]>();
    for (const row of rows) {
      const list = byBuilding.get(row.building_id) ?? [];
      list.push(row.parking_lot_id);
      byBuilding.set(row.building_id, list);
    }

    return NextResponse.json({
      byBuilding: Object.fromEntries(byBuilding),
    });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json(
      { error: "Could not fetch recommended parking lots" },
      { status: 500 },
    );
  }
}
