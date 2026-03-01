import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import {
  jsonError,
  isNonEmptyString,
  isValidLatLng,
  parseId,
  parsePolygon,
} from "@/lib/utils";

const ROUTE = "/api/destination";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { name, lat, lng, polygon } = body as {
      name: unknown;
      lat: unknown;
      lng: unknown;
      polygon: unknown;
    };

    console.log(`[API ${ROUTE} POST] called`, { name, lat, lng });

    if (!isNonEmptyString(name, 256)) {
      return jsonError(
        "Invalid name",
        400,
        "name must be a non-empty string (<=256 chars)",
      );
    }
    if (!isValidLatLng(lat, lng)) {
      return jsonError("Invalid lat/lng", 400);
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return jsonError(
        "Invalid polygon",
        400,
        "polygon must be valid JSON (string or object)",
      );
    }

    // Insert first (polygon will be updated with destId/name in properties)
    const result = await db.execute(sql`
      INSERT INTO destination (name, lat, lng, polygon)
      VALUES (${name}, ${lat as number}, ${lng as number}, ${parsed.polyStr})
      RETURNING id;
    `);

    const inserted = result.rows[0];
    if (!inserted?.id) {
      return jsonError("Insert failed", 500, "Insert did not return an id");
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
    return jsonError("Destination insert failed", 500, err?.message ?? err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

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
    if (!nid) return jsonError("Invalid id", 400);

    if (!isNonEmptyString(name, 256)) {
      return jsonError(
        "Invalid name",
        400,
        "name must be a non-empty string (<=256 chars)",
      );
    }
    if (!isValidLatLng(lat, lng)) {
      return jsonError("Invalid lat/lng", 400);
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return jsonError(
        "Invalid polygon",
        400,
        "polygon must be valid JSON (string or object)",
      );
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
      return jsonError("Destination not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return jsonError("Destination update failed", 500, err?.message ?? err);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id } = body as { id: unknown };
    console.log(`[API ${ROUTE} DELETE] called`, { id });
    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    const result = await db.execute(sql`
      DELETE FROM destination
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return jsonError("Destination not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Destination delete failed", 500, err?.message ?? err);
  }
}

export async function GET(_req: Request) {
  try {
    console.log(`[API ${ROUTE} GET] called`);
    const result = await db.execute(sql`
      SELECT * FROM destination;
    `);

    const rows = result.rows as Array<Record<string, unknown>>;
    const destinations = rows.map((row) => {
      const { is_parking_lot, open_time, close_time, ...rest } = row;
      const openStr =
        open_time != null ? String(open_time).slice(0, 8) : "00:00:00";
      const closeStr =
        close_time != null ? String(close_time).slice(0, 8) : "23:59:59";
      return {
        ...rest,
        isParkingLot: is_parking_lot,
        openTime: openStr,
        closeTime: closeStr,
      };
    });

    return NextResponse.json({ destinations }, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch destinations", 500, err?.message ?? err);
  }
}
