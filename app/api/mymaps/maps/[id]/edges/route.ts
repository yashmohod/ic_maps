import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsEdge, myMapsNode } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { calcDistance, jsonError, parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const ROUTE = "/api/mymaps/maps/[id]/edges";

const postSchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  biDirectional: z.boolean().optional().default(true),
  name: z.string().max(256).optional().default(""),
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
      .select({ id: myMapsNode.id })
      .from(myMapsNode)
      .where(eq(myMapsNode.my_maps_id, mapId));
    const nodeIds = nodes.map((n) => n.id);
    const edges =
      nodeIds.length === 0
        ? []
        : await db
            .select()
            .from(myMapsEdge)
            .where(inArray(myMapsEdge.node_a_id, nodeIds));

    return NextResponse.json({ edges }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch edges", 500, getDetail(err));
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

    const { from: fromId, to: toId, biDirectional, name } = parsed.data;
    if (fromId === toId)
      return jsonError("Cannot connect a node to itself", 400);

    const a = Math.min(fromId, toId);
    const b = Math.max(fromId, toId);
    const direction = biDirectional ? true : fromId === a;

    const [nodeA] = await db
      .select()
      .from(myMapsNode)
      .where(and(eq(myMapsNode.id, a), eq(myMapsNode.my_maps_id, mapId)))
      .limit(1);
    const [nodeB] = await db
      .select()
      .from(myMapsNode)
      .where(and(eq(myMapsNode.id, b), eq(myMapsNode.my_maps_id, mapId)))
      .limit(1);

    if (!nodeA || !nodeB) {
      return jsonError("Both nodes must belong to this map", 400);
    }

    const distance = calcDistance(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);

    const [inserted] = await db
      .insert(myMapsEdge)
      .values({
        node_a_id: a,
        node_b_id: b,
        bi_directional: biDirectional,
        direction,
        distance,
        name: name ?? "",
      })
      .returning();

    return NextResponse.json(
      {
        edge: inserted,
        from: direction ? a : b,
        to: direction ? b : a,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return jsonError("Insert failed", 500, getDetail(err));
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
    let edgeId = parseId(searchParams.get("edgeId"));
    if (!edgeId) {
      const body = await req.json().catch(() => null);
      edgeId = parseId((body as { edgeId?: unknown } | null)?.edgeId);
    }
    if (!edgeId) return jsonError("Missing or invalid edgeId", 400);

    const [edge] = await db
      .select()
      .from(myMapsEdge)
      .where(eq(myMapsEdge.id, edgeId))
      .limit(1);
    if (!edge) return jsonError("Edge not found", 404);

    const [nodeA] = await db
      .select()
      .from(myMapsNode)
      .where(
        and(
          eq(myMapsNode.id, edge.node_a_id),
          eq(myMapsNode.my_maps_id, mapId),
        ),
      )
      .limit(1);
    if (!nodeA) return jsonError("Edge not found on this map", 404);

    await db.delete(myMapsEdge).where(eq(myMapsEdge.id, edgeId));

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Delete failed", 500, getDetail(err));
  }
}
