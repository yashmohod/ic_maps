import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsLine } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { jsonError, parseId, parsePolygon } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };
const ROUTE = "/api/mymaps/maps/[id]/lines";

const postSchema = z.object({
  name: z.string().max(256).optional().default(""),
  geometry: z.unknown(),
});

const putSchema = z.object({
  lineId: z.coerce.number().int().positive(),
  name: z.string().max(256).optional(),
  geometry: z.unknown().optional(),
});

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

function parseLineGeometry(input: unknown): string | null {
  const parsed = parsePolygon(input);
  if (!parsed) return null;
  const type = parsed.polyObj.type;
  const geomType =
    type === "Feature"
      ? (parsed.polyObj.geometry as { type?: string } | undefined)?.type
      : type;
  if (geomType !== "LineString" && type !== "Feature") {
    // allow Feature wrapping LineString
  }
  if (type === "Feature") {
    const g = parsed.polyObj.geometry as { type?: string } | undefined;
    if (g?.type !== "LineString") return null;
  } else if (type === "LineString") {
    return JSON.stringify({
      type: "Feature",
      properties: parsed.polyObj.properties ?? {},
      geometry: parsed.polyObj,
    });
  } else {
    return null;
  }
  return parsed.polyStr;
}

export async function GET(_req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access || !access.canRead) return jsonError("Map not found", 404);
    const lines = await db
      .select()
      .from(myMapsLine)
      .where(eq(myMapsLine.my_maps_id, mapId));
    return NextResponse.json({ lines }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch lines", 500, getDetail(err));
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

    const geomStr = parseLineGeometry(parsed.data.geometry);
    if (!geomStr) return jsonError("Invalid LineString geometry", 400);

    const name = parsed.data.name ?? "";
    const obj = JSON.parse(geomStr) as {
      properties?: Record<string, unknown>;
    };
    obj.properties = { ...(obj.properties ?? {}), name, myMapsId: mapId };

    const [inserted] = await db
      .insert(myMapsLine)
      .values({
        my_maps_id: mapId,
        name,
        geometry: JSON.stringify(obj),
      })
      .returning();

    if (!inserted) return jsonError("Insert failed", 500);
    obj.properties = { ...obj.properties, lineId: inserted.id };
    const [updated] = await db
      .update(myMapsLine)
      .set({ geometry: JSON.stringify(obj) })
      .where(eq(myMapsLine.id, inserted.id))
      .returning();

    return NextResponse.json({ line: updated }, { status: 201 });
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

    const { lineId, name, geometry } = parsed.data;
    const [existing] = await db
      .select()
      .from(myMapsLine)
      .where(and(eq(myMapsLine.id, lineId), eq(myMapsLine.my_maps_id, mapId)))
      .limit(1);
    if (!existing) return jsonError("Line not found", 404);

    const updates: { name?: string; geometry?: string } = {};
    if (name !== undefined) updates.name = name;
    if (geometry !== undefined) {
      const geomStr = parseLineGeometry(geometry);
      if (!geomStr) return jsonError("Invalid LineString geometry", 400);
      const obj = JSON.parse(geomStr) as {
        properties?: Record<string, unknown>;
      };
      obj.properties = {
        ...(obj.properties ?? {}),
        name: name ?? existing.name,
        myMapsId: mapId,
        lineId,
      };
      updates.geometry = JSON.stringify(obj);
    }

    const [updated] = await db
      .update(myMapsLine)
      .set(updates)
      .where(eq(myMapsLine.id, lineId))
      .returning();

    return NextResponse.json({ line: updated }, { status: 200 });
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
    let lineId = parseId(searchParams.get("lineId"));
    if (!lineId) {
      const body = await req.json().catch(() => null);
      lineId = parseId((body as { lineId?: unknown } | null)?.lineId);
    }
    if (!lineId) return jsonError("Missing or invalid lineId", 400);

    const result = await db
      .delete(myMapsLine)
      .where(and(eq(myMapsLine.id, lineId), eq(myMapsLine.my_maps_id, mapId)))
      .returning({ id: myMapsLine.id });
    if (result.length === 0) return jsonError("Line not found", 404);
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Delete failed", 500, getDetail(err));
  }
}
