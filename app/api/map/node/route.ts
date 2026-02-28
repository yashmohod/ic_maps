import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/index";
import { jsonError, isValidLatLng, parseId } from "@/lib/utils";

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { lat, lng } = body as { lat: unknown; lng: unknown };

    if (!isValidLatLng(lat, lng)) return jsonError("Invalid lat/lng", 400);

    const latNum = lat as number;
    const lngNum = lng as number;
    const pointWkt = `POINT(${lngNum} ${latNum})`;
    const result = await pool.query(
      `INSERT INTO node_outside (lat, lng, location)
       VALUES ($1, $2, ST_GeomFromText($3, 4326))
       RETURNING id`,
      [latNum, lngNum, pointWkt],
    );

    const inserted = result.rows[0];
    if (!inserted?.id) {
      return jsonError("Insert failed", 500, "Insert did not return an id");
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 });
  } catch (err: unknown) {
    return jsonError("Insert failed", 500, getDetail(err));
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id, lat, lng } = body as {
      id: unknown;
      lat: unknown;
      lng: unknown;
    };

    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    if (!isValidLatLng(lat, lng)) return jsonError("Invalid lat/lng", 400);
    const latNum = lat as number;
    const lngNum = lng as number;
    const pointWkt = `POINT(${lngNum} ${latNum})`;
    const result = await pool.query(
      `UPDATE node_outside SET lat = $1, lng = $2, location = ST_GeomFromText($3, 4326) WHERE id = $4`,
      [latNum, lngNum, pointWkt, nid],
    );
    if (result.rowCount === 0) {
      return jsonError("Node not found", 404);
    }

    await db.execute(sql`
  UPDATE edge_outside e
  SET distance = ST_DistanceSphere(na.location, nb.location)
  FROM node_outside na, node_outside nb
  WHERE e.node_a_id = na.id
    AND e.node_b_id = nb.id
    AND (e.node_a_id = ${nid} OR e.node_b_id = ${nid});
`);

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    return jsonError("Update failed", 500, getDetail(err));
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id } = body as { id: unknown };

    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    const result = await db.execute(sql`
      DELETE FROM node_outside
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return jsonError("Node not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Delete failed", 500, message);
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Optional: allow filtering by id (?id=123). If absent, return all.
    const idParam = searchParams.get("id");

    if (idParam != null) {
      const nid = parseId(idParam);
      if (!nid) return jsonError("Invalid id", 400);

      const result = await db.execute(sql<{
        id: number;
        lat: number;
        lng: number;
        is_blue_light: boolean;
        is_pedestrian: boolean;
        is_vehicular: boolean;
        is_elevator: boolean;
        is_stairs: boolean;
        location: unknown;
      }>`
        SELECT
          id,
          lat,
          lng,
          is_blue_light,
          is_pedestrian,
          is_vehicular,
          is_elevator,
          is_stairs,
          location
        FROM node_outside
        WHERE id = ${nid};
      `);

      if (result.rows.length === 0) return jsonError("Node not found", 404);
      const row = result.rows[0];
      return NextResponse.json(
        {
          row: {
            id: row.id,
            lat: row.lat,
            lng: row.lng,
            isBlueLight: row.is_blue_light,
            isPedestrian: row.is_pedestrian,
            isVehicular: row.is_vehicular,
            isElevator: row.is_elevator,
            isStairs: row.is_stairs,
            location: row.location,
          },
        },
        { status: 200 },
      );
    }

    const result = await db.execute(sql<{
      id: number;
      lat: number;
      lng: number;
      is_blue_light: boolean;
      is_pedestrian: boolean;
      is_vehicular: boolean;
      is_elevator: boolean;
      is_stairs: boolean;
      location: unknown;
    }>`
      SELECT
        id,
        lat,
        lng,
        is_blue_light,
        is_pedestrian,
        is_vehicular,
        is_elevator,
        is_stairs,
        location
      FROM node_outside;
    `);

    const rows = result.rows.map((row) => ({
      id: row.id,
      lat: row.lat,
      lng: row.lng,
      isBlueLight: row.is_blue_light,
      isPedestrian: row.is_pedestrian,
      isVehicular: row.is_vehicular,
      isElevator: row.is_elevator,
      isStairs: row.is_stairs,
      location: row.location,
    }));

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch nodes", 500, message);
  }
}
