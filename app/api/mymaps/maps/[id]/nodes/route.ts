import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsEdge, myMapsNode } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { isValidLatLng, parseId } from "@/lib/utils";
import { calcDistance } from "@/lib/geo";

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

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

    const nodes = await db
      .select()
      .from(myMapsNode)
      .where(eq(myMapsNode.my_maps_id, mapId));

    return NextResponse.json({ nodes }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch nodes", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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

    const { lat, lng, name } = parsed.data;
    if (!isValidLatLng(lat, lng)) return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

    const [inserted] = await db
      .insert(myMapsNode)
      .values({ my_maps_id: mapId, lat, lng, name: name ?? "" })
      .returning();

    return NextResponse.json({ node: inserted }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { nodeId, lat, lng, name } = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(myMapsNode)
        .where(and(eq(myMapsNode.id, nodeId), eq(myMapsNode.my_maps_id, mapId)))
        .limit(1);

      if (!existing) return null;

      const nextLat = lat ?? existing.lat;
      const nextLng = lng ?? existing.lng;
      if (!isValidLatLng(nextLat, nextLng)) {
        throw new Error("INVALID_LAT_LNG");
      }

      const updates: { lat: number; lng: number; name?: string } = {
        lat: nextLat,
        lng: nextLng,
      };
      if (name !== undefined) updates.name = name;

      const [row] = await tx
        .update(myMapsNode)
        .set(updates)
        .where(eq(myMapsNode.id, nodeId))
        .returning();

      const connected = await tx
        .select()
        .from(myMapsEdge)
        .where(
          or(
            eq(myMapsEdge.node_a_id, nodeId),
            eq(myMapsEdge.node_b_id, nodeId),
          ),
        );

      if (connected.length > 0) {
        const endpointIds = [
          ...new Set(connected.flatMap((e) => [e.node_a_id, e.node_b_id])),
        ];
        const endpoints = await tx
          .select()
          .from(myMapsNode)
          .where(inArray(myMapsNode.id, endpointIds));
        const byId = new Map(endpoints.map((n) => [n.id, n]));

        for (const edge of connected) {
          const a = byId.get(edge.node_a_id);
          const b = byId.get(edge.node_b_id);
          if (!a || !b) continue;
          await tx
            .update(myMapsEdge)
            .set({ distance: calcDistance(a.lat, a.lng, b.lat, b.lng) })
            .where(eq(myMapsEdge.id, edge.id));
        }
      }

      return row;
    });

    if (!updated) return NextResponse.json({ error: "Node not found" }, { status: 404 });
    return NextResponse.json({ node: updated }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "INVALID_LAT_LNG") {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }
    console.error(`[API ${ROUTE} PUT] error`, err);
    return NextResponse.json({ error: "Update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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
    let nodeId = parseId(searchParams.get("nodeId"));
    if (!nodeId) {
      const body = await req.json().catch(() => null);
      nodeId = parseId((body as { nodeId?: unknown } | null)?.nodeId);
    }
    if (!nodeId) return NextResponse.json({ error: "Missing or invalid nodeId" }, { status: 400 });

    const result = await db
      .delete(myMapsNode)
      .where(and(eq(myMapsNode.id, nodeId), eq(myMapsNode.my_maps_id, mapId)))
      .returning({ id: myMapsNode.id });

    if (result.length === 0) return NextResponse.json({ error: "Node not found" }, { status: 404 });

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
