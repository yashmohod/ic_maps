import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";

// ✅ Include `detail` only in development (recommended).
// If you truly want the opposite, flip this to: process.env.NODE_ENV === "production"
const includeDetail = process.env.NODE_ENV !== "production";

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(includeDetail && detail != null ? { detail: String(detail) } : {}),
    },
    { status },
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidLatLng(lat: unknown, lng: unknown) {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function parseId(id: unknown): number | null {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isNonEmptyString(v: unknown, maxLen = 256): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

/**
 * Validates polygon payload.
 * Accepts:
 * - stringified JSON (what you're sending now)
 * - or an object (more ergonomic for future)
 *
 * Returns a canonical stringified GeoJSON + parsed object.
 */
function parsePolygon(polygon: unknown): { polyObj: any; polyStr: string } | null {
  try {
    const obj =
      typeof polygon === "string"
        ? JSON.parse(polygon)
        : typeof polygon === "object" && polygon != null
          ? polygon
          : null;

    if (!obj || typeof obj !== "object") return null;

    // Light validation (enough to avoid obvious garbage):
    // You can tighten this later (Feature/Polygon only, etc).
    const type = (obj as any).type;
    if (typeof type !== "string") return null;

    // Ensure properties exists (we overwrite/merge below anyway)
    if (!(obj as any).properties || typeof (obj as any).properties !== "object") {
      (obj as any).properties = {};
    }

    return { polyObj: obj, polyStr: JSON.stringify(obj) };
  } catch {
    return null;
  }
}

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

    if (!isNonEmptyString(name, 256)) {
      return jsonError("Invalid name", 400, "name must be a non-empty string (<=256 chars)");
    }
    if (!isValidLatLng(lat, lng)) {
      return jsonError("Invalid lat/lng", 400);
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return jsonError("Invalid polygon", 400, "polygon must be valid JSON (string or object)");
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
    // Unexpected/DB errors -> 500
    return jsonError("Destination insert failed", 500, err?.message ?? err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id, name, lat, lng, polygon } = body as {
      id: unknown;
      name: unknown;
      lat: unknown;
      lng: unknown;
      polygon: unknown;
    };

    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    if (!isNonEmptyString(name, 256)) {
      return jsonError("Invalid name", 400, "name must be a non-empty string (<=256 chars)");
    }
    if (!isValidLatLng(lat, lng)) {
      return jsonError("Invalid lat/lng", 400);
    }

    const parsed = parsePolygon(polygon);
    if (!parsed) {
      return jsonError("Invalid polygon", 400, "polygon must be valid JSON (string or object)");
    }

    // Keep polygon properties consistent
    const polyObj = parsed.polyObj;
    polyObj.properties = {
      ...(polyObj.properties ?? {}),
      destId: nid,
      name,
    };
    const polyWithProps = JSON.stringify(polyObj);

    const result = await db.execute(sql`
      UPDATE destination
      SET name = ${name},
          lat = ${lat as number},
          lng = ${lng as number},
          polygon = ${polyWithProps}
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return jsonError("Destination not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    return jsonError("Destination update failed", 500, err?.message ?? err);
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
      DELETE FROM destination
      WHERE id = ${nid}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return jsonError("Destination not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    return jsonError("Destination delete failed", 500, err?.message ?? err);
  }
}

export async function GET(_req: Request) {
  try {
    const result = await db.execute(sql`
      SELECT * FROM destination;
    `);

    return NextResponse.json({ destinations: result.rows }, { status: 200 });
  } catch (err: any) {
    return jsonError("Could not fetch destinations", 500, err?.message ?? err);
  }
}