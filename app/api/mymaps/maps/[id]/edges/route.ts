import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsEdge, myMapsNode } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  isUniqueViolation,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { parseId } from "@/lib/utils";
import { calcDistance } from "@/lib/geo";

type Params = { params: Promise<{ id: string }> };

const ROUTE = "/api/mymaps/maps/[id]/edges";

const postSchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  biDirectional: z.boolean().optional().default(true),
  name: z.string().max(256).optional().default(""),
});

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

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
            .where(
              or(
                inArray(myMapsEdge.node_a_id, nodeIds),
                inArray(myMapsEdge.node_b_id, nodeIds),
              ),
            );

    return NextResponse.json({ edges }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch edges", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { from: fromId, to: toId, biDirectional, name } = parsed.data;
    if (fromId === toId)
      return NextResponse.json({ error: "Cannot connect a node to itself" }, { status: 400 });

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
      return NextResponse.json({ error: "Both nodes must belong to this map" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(myMapsEdge)
      .where(and(eq(myMapsEdge.node_a_id, a), eq(myMapsEdge.node_b_id, b)))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        {
          edge: existing,
          from: existing.direction ? a : b,
          to: existing.direction ? b : a,
          existing: true,
        },
        { status: 200 },
      );
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
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Edge already exists between these nodes" }, { status: 409 });
    }
    return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const { searchParams } = new URL(req.url);
    let edgeId = parseId(searchParams.get("edgeId"));
    if (!edgeId) {
      const body = await req.json().catch(() => null);
      edgeId = parseId((body as { edgeId?: unknown } | null)?.edgeId);
    }
    if (!edgeId) return NextResponse.json({ error: "Missing or invalid edgeId" }, { status: 400 });

    const [edge] = await db
      .select()
      .from(myMapsEdge)
      .where(eq(myMapsEdge.id, edgeId))
      .limit(1);
    if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

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
    if (!nodeA) return NextResponse.json({ error: "Edge not found on this map" }, { status: 404 });

    await db.delete(myMapsEdge).where(eq(myMapsEdge.id, edgeId));

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
