import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraphOr503 } from "@/lib/reload-graph-response";
import { mapDestinationRow } from "@/lib/destination-list";
import { isNonEmptyString, isValidLatLng, parseId, parsePolygon } from "@/lib/utils";

const ROUTE = "/api/destination";

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { name, lat, lng, polygon } = body as {
      name: unknown;
      lat: unknown;
      lng: unknown;
      polygon: unknown;
    };

    console.log(`[API ${ROUTE} POST] called`, { name, lat, lng });

    if (!isNonEmptyString(name, 256)) {
      return NextResponse.json({ error: "Invalid name", ...(process.env.NODE_ENV !== "production" ? { detail: String("name must be a non-empty string (<=256 chars)") } : {}) }, { status: 400 });
    }
    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid polygon", ...(process.env.NODE_ENV !== "production" ? { detail: String("polygon must be valid JSON (string or object)") } : {}) }, { status: 400 });
    }

    // Insert first (polygon will be updated with destId/name in properties)
    const result = await db.execute(sql`
      INSERT INTO destination (name, lat, lng, polygon)
      VALUES (${name}, ${lat as number}, ${lng as number}, ${parsed.polyStr})
      RETURNING id;
    `);

    const inserted = result.rows[0];
    if (!inserted?.id) {
      return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String("Insert did not return an id") } : {}) }, { status: 500 });
    }

    // Patch polygon properties with destId + name
    const polyObj = parsed.polyObj;
    polyObj.properties = {
      ...(polyObj.properties ?? {}),
      destId: inserted.id,
      name,
    };
    const polyWithProps = JSON.stringify(polyObj);

    await db.execute(sql`
      UPDATE destination
      SET polygon = ${polyWithProps}
      WHERE id = ${inserted.id};
    `);

    return NextResponse.json({ id: inserted.id }, { status: 201 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} POST] error`, err);
    // Unexpected/DB errors -> 500
    return NextResponse.json({ error: "Destination insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(err?.message ?? err) } : {}) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id, name, lat, lng, polygon, openTime, closeTime } = body as {
      id: unknown;
      name: unknown;
      lat: unknown;
      lng: unknown;
      polygon: unknown;
      openTime: unknown;
      closeTime: unknown;
    };

    console.log(`[API ${ROUTE} PUT] called`, { id, name, lat, lng, openTime, closeTime });

    const nid = parseId(id);
    if (!nid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    if (!isNonEmptyString(name, 256)) {
      return NextResponse.json({ error: "Invalid name", ...(process.env.NODE_ENV !== "production" ? { detail: String("name must be a non-empty string (<=256 chars)") } : {}) }, { status: 400 });
    }
    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid polygon", ...(process.env.NODE_ENV !== "production" ? { detail: String("polygon must be valid JSON (string or object)") } : {}) }, { status: 400 });
    }

    // Keep polygon properties consistent
    const polyObj = parsed.polyObj;
    polyObj.properties = {
      ...(polyObj.properties ?? {}),
      destId: nid,
      name,
    };
    const polyWithProps = JSON.stringify(polyObj);

    const openTimeStr =
      openTime != null &&
      typeof openTime === "string" &&
      /^\d{1,2}:\d{2}(:\d{2})?$/.test(openTime)
        ? openTime.length === 5
          ? `${openTime}:00`
          : openTime
        : "00:00:00";
    const closeTimeStr =
      closeTime != null &&
      typeof closeTime === "string" &&
      /^\d{1,2}:\d{2}(:\d{2})?$/.test(closeTime)
        ? closeTime.length === 5
          ? `${closeTime}:00`
          : closeTime
        : "23:59:59";

    const result = await db.execute(sql`
      UPDATE destination
      SET name = ${name},
          lat = ${lat as number},
          lng = ${lng as number},
          polygon = ${polyWithProps},
          open_time = ${openTimeStr},
          close_time = ${closeTimeStr}
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return NextResponse.json({ error: "Destination update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(err?.message ?? err) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id } = body as { id: unknown };
    console.log(`[API ${ROUTE} DELETE] called`, { id });
    const nid = parseId(id);
    if (!nid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const result = await db.execute(sql`
      DELETE FROM destination
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    const __reloadErr = await reloadGraphOr503();
    if (__reloadErr) return __reloadErr;
    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Destination delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(err?.message ?? err) } : {}) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const idRaw = url.searchParams.get("id");
    const includePolygon =
      url.searchParams.get("include") === "polygon" || idRaw != null;
    const navigatableOnly =
      url.searchParams.get("navigatableOnly") === "1" ||
      url.searchParams.get("navigatableOnly") === "true";

    console.log(`[API ${ROUTE} GET] called`, {
      id: idRaw,
      includePolygon,
      navigatableOnly,
    });

    const navigatableFilter = navigatableOnly
      ? sql` AND navigatable_destination = true`
      : sql``;

    let result;
    if (idRaw != null) {
      const nid = parseId(idRaw);
      if (!nid) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      result = await db.execute(sql`
        SELECT id, name, lat, lng, polygon, is_parking_lot, navigatable_destination, open_time, close_time
        FROM destination
        WHERE id = ${nid};
      `);
    } else if (includePolygon) {
      result = await db.execute(sql`
        SELECT id, name, lat, lng, polygon, is_parking_lot, navigatable_destination, open_time, close_time
        FROM destination
        WHERE true ${navigatableFilter};
      `);
    } else {
      result = await db.execute(sql`
        SELECT id, name, lat, lng, is_parking_lot, navigatable_destination, open_time, close_time
        FROM destination
        WHERE true ${navigatableFilter};
      `);
    }

    const rows = result.rows as Array<Record<string, unknown>>;
    const destinations = rows.map((row) =>
      mapDestinationRow(row, includePolygon),
    );

    const buildingIds = destinations
      .filter((d) => !d.isParkingLot)
      .map((d) => d.id);
    if (buildingIds.length > 0) {
      const linkRows = await db.execute(sql`
        SELECT building_id, parking_lot_id
        FROM destination_parking_lot
        WHERE building_id IN (${sql.join(
          buildingIds.map((id) => sql`${id}`),
          sql`, `,
        )});
      `);
      const byBuilding = new Map<number, number[]>();
      for (const row of linkRows.rows as Array<{
        building_id: number;
        parking_lot_id: number;
      }>) {
        const bid = Number(row.building_id);
        const list = byBuilding.get(bid) ?? [];
        list.push(Number(row.parking_lot_id));
        byBuilding.set(bid, list);
      }
      for (const dest of destinations) {
        dest.parkingLotIds = dest.isParkingLot
          ? []
          : (byBuilding.get(dest.id) ?? []);
      }
    } else {
      for (const dest of destinations) {
        dest.parkingLotIds = [];
      }
    }

    return NextResponse.json({ destinations }, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch destinations", ...(process.env.NODE_ENV !== "production" ? { detail: String(err?.message ?? err) } : {}) }, { status: 500 });
  }
}
