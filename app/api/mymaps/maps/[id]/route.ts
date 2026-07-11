import { NextResponse } from "next/server";
import { eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import {
  myMapsEdge,
  myMapsLine,
  myMapsNode,
  myMapsPoint,
  myMapsPolygon,
  myMapsText,
} from "@/db/schema";
import { getSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapReadable,
  toAccessPayload,
  toPublicMap,
} from "@/lib/mymaps-http";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/mymaps/maps/[id]";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;

    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;
    const { access } = gate;

    const nodes = await db
      .select()
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

    const [polygons, lines, points, texts] = await Promise.all([
      db
        .select()
        .from(myMapsPolygon)
        .where(eq(myMapsPolygon.my_maps_id, mapId)),
      db.select().from(myMapsLine).where(eq(myMapsLine.my_maps_id, mapId)),
      db.select().from(myMapsPoint).where(eq(myMapsPoint.my_maps_id, mapId)),
      db.select().from(myMapsText).where(eq(myMapsText.my_maps_id, mapId)),
    ]);

    // Guests / public viewers do not need owner_id.
    const mapPayload =
      access.isOwner || access.role ? access.map : toPublicMap(access.map);

    return NextResponse.json(
      {
        map: mapPayload,
        access: toAccessPayload(access),
        nodes,
        edges,
        polygons,
        lines,
        points,
        texts,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch map", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
