import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsEdge, myMapsNode } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { calcDistance, isValidLatLng, jsonError, parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const ROUTE = "/api/mymaps/maps/[id]/nodes";

const postSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().max(256).optional().default(""),
});

const putSchema = z.object({
  nodeId: z.coerce.number().int().positive(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  name: z.string().max(256).optional(),
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

    const nodes = await db
      .select()
      .from(myMapsNode)
      .where(eq(myMapsNode.my_maps_id, mapId));

    return NextResponse.json({ nodes }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch nodes", 500, getDetail(err));
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

    const { lat, lng, name } = parsed.data;
    if (!isValidLatLng(lat, lng)) return jsonError("Invalid lat/lng", 400);

    const [inserted] = await db
      .insert(myMapsNode)
      .values({ my_maps_id: mapId, lat, lng, name: name ?? "" })
      .returning();

    return NextResponse.json({ node: inserted }, { status: 201 });
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

    const { nodeId, lat, lng, name } = parsed.data;

    const [existing] = await db
      .select()
      .from(myMapsNode)
      .where(and(eq(myMapsNode.id, nodeId), eq(myMapsNode.my_maps_id, mapId)))
      .limit(1);

    if (!existing) return jsonError("Node not found", 404);

    const nextLat = lat ?? existing.lat;
    const nextLng = lng ?? existing.lng;
    if (!isValidLatLng(nextLat, nextLng)) {
      return jsonError("Invalid lat/lng", 400);
    }

    const updates: { lat?: number; lng?: number; name?: string } = {
      lat: nextLat,
      lng: nextLng,
    };
    if (name !== undefined) updates.name = name;

    const [updated] = await db
      .update(myMapsNode)
      .set(updates)
      .where(eq(myMapsNode.id, nodeId))
      .returning();

    const connected = await db
      .select()
      .from(myMapsEdge)
      .where(
        or(eq(myMapsEdge.node_a_id, nodeId), eq(myMapsEdge.node_b_id, nodeId)),
      );

    for (const edge of connected) {
      const [a] = await db
        .select()
        .from(myMapsNode)
        .where(eq(myMapsNode.id, edge.node_a_id))
        .limit(1);
      const [b] = await db
        .select()
        .from(myMapsNode)
        .where(eq(myMapsNode.id, edge.node_b_id))
        .limit(1);
      if (!a || !b) continue;
      await db
        .update(myMapsEdge)
        .set({ distance: calcDistance(a.lat, a.lng, b.lat, b.lng) })
        .where(eq(myMapsEdge.id, edge.id));
    }

    return NextResponse.json({ node: updated }, { status: 200 });
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
    let nodeId = parseId(searchParams.get("nodeId"));
    if (!nodeId) {
      const body = await req.json().catch(() => null);
      nodeId = parseId((body as { nodeId?: unknown } | null)?.nodeId);
    }
    if (!nodeId) return jsonError("Missing or invalid nodeId", 400);

    const result = await db
      .delete(myMapsNode)
      .where(and(eq(myMapsNode.id, nodeId), eq(myMapsNode.my_maps_id, mapId)))
      .returning({ id: myMapsNode.id });

    if (result.length === 0) return jsonError("Node not found", 404);

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Delete failed", 500, getDetail(err));
  }
}
