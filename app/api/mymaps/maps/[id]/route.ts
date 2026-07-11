import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";

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
import { getMapAccess } from "@/lib/mymaps-access";
import { jsonError, parseId } from "@/lib/utils";

const ROUTE = "/api/mymaps/maps/[id]";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);

    const session = await getSession();
    const userId = session?.user?.id ?? null;

    const access = await getMapAccess(mapId, userId);
    if (!access || !access.canRead) {
      return jsonError("Map not found", 404);
    }

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
            .where(inArray(myMapsEdge.node_a_id, nodeIds));

    const [polygons, lines, points, texts] = await Promise.all([
      db
        .select()
        .from(myMapsPolygon)
        .where(eq(myMapsPolygon.my_maps_id, mapId)),
      db.select().from(myMapsLine).where(eq(myMapsLine.my_maps_id, mapId)),
      db.select().from(myMapsPoint).where(eq(myMapsPoint.my_maps_id, mapId)),
      db.select().from(myMapsText).where(eq(myMapsText.my_maps_id, mapId)),
    ]);

    return NextResponse.json(
      {
        map: access.map,
        access: {
          role: access.role,
          isOwner: access.isOwner,
          canEdit: access.canEdit,
          canManageSharing: access.canManageSharing,
        },
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
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch map", 500, message);
  }
}
