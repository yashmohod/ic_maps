import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsPolygon } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { jsonError, parseId, parsePolygon } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const ROUTE = "/api/mymaps/maps/[id]/polygons";

const postSchema = z.object({
  name: z.string().trim().min(1).max(256).optional().default(""),
  polygon: z.unknown(),
});

const putSchema = z.object({
  polygonId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(256).optional(),
  polygon: z.unknown().optional(),
});

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

export async function GET(_req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access || !access.canRead) return jsonError("Map not found", 404);

    const polygons = await db
      .select()
      .from(myMapsPolygon)
      .where(eq(myMapsPolygon.my_maps_id, mapId));

    return NextResponse.json({ polygons }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch polygons", 500, getDetail(err));
  }
}

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const poly = parsePolygon(parsed.data.polygon);
    if (!poly) {
      return jsonError(
        "Invalid polygon",
        400,
        "polygon must be valid JSON (string or object)",
      );
    }

    const name = parsed.data.name ?? "";
    const props = (poly.polyObj.properties ?? {}) as Record<string, unknown>;
    props.name = name;
    props.myMapsId = mapId;
    poly.polyObj.properties = props;
    const polyStr = JSON.stringify(poly.polyObj);

    const [inserted] = await db
      .insert(myMapsPolygon)
      .values({
        my_maps_id: mapId,
        name,
        polygon: polyStr,
      })
      .returning();

    // Patch id into properties after insert
    if (inserted) {
      props.polygonId = inserted.id;
      const withId = JSON.stringify(poly.polyObj);
      const [updated] = await db
        .update(myMapsPolygon)
        .set({ polygon: withId })
        .where(eq(myMapsPolygon.id, inserted.id))
        .returning();
      return NextResponse.json({ polygon: updated }, { status: 201 });
    }

    return jsonError("Insert failed", 500);
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return jsonError("Insert failed", 500, getDetail(err));
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { polygonId, name, polygon } = parsed.data;

    const [existing] = await db
      .select()
      .from(myMapsPolygon)
      .where(
        and(
          eq(myMapsPolygon.id, polygonId),
          eq(myMapsPolygon.my_maps_id, mapId),
        ),
      )
      .limit(1);

    if (!existing) return jsonError("Polygon not found", 404);

    const updates: { name?: string; polygon?: string } = {};
    if (name !== undefined) updates.name = name;

    if (polygon !== undefined) {
      const poly = parsePolygon(polygon);
      if (!poly) {
        return jsonError(
          "Invalid polygon",
          400,
          "polygon must be valid JSON (string or object)",
        );
      }
      const props = (poly.polyObj.properties ?? {}) as Record<string, unknown>;
      props.name = name ?? existing.name;
      props.myMapsId = mapId;
      props.polygonId = polygonId;
      poly.polyObj.properties = props;
      updates.polygon = JSON.stringify(poly.polyObj);
    } else if (name !== undefined && existing.polygon) {
      const poly = parsePolygon(existing.polygon);
      if (poly) {
        const props = (poly.polyObj.properties ?? {}) as Record<
          string,
          unknown
        >;
        props.name = name;
        props.polygonId = polygonId;
        props.myMapsId = mapId;
        poly.polyObj.properties = props;
        updates.polygon = JSON.stringify(poly.polyObj);
      }
    }

    const [updated] = await db
      .update(myMapsPolygon)
      .set(updates)
      .where(eq(myMapsPolygon.id, polygonId))
      .returning();

    return NextResponse.json({ polygon: updated }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return jsonError("Update failed", 500, getDetail(err));
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const { searchParams } = new URL(req.url);
    let polygonId = parseId(searchParams.get("polygonId"));
    if (!polygonId) {
      const body = await req.json().catch(() => null);
      polygonId = parseId((body as { polygonId?: unknown } | null)?.polygonId);
    }
    if (!polygonId) return jsonError("Missing or invalid polygonId", 400);

    const result = await db
      .delete(myMapsPolygon)
      .where(
        and(
          eq(myMapsPolygon.id, polygonId),
          eq(myMapsPolygon.my_maps_id, mapId),
        ),
      )
      .returning({ id: myMapsPolygon.id });

    if (result.length === 0) return jsonError("Polygon not found", 404);

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Delete failed", 500, getDetail(err));
  }
}
