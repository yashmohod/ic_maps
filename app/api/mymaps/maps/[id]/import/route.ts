import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import {
  myMapsEdge,
  myMapsLine,
  myMapsNode,
  myMapsPoint,
  myMapsPolygon,
  myMapsText,
} from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { calcDistance } from "@/lib/geo";
import {
  getErrorDetail,
  requireMapEditable,
  toAccessPayload,
} from "@/lib/mymaps-http";
import {
  myMapsImportBodySchema,
  remapEdgeEndpoints,
  toStoredLineGeometry,
} from "@/lib/mymaps-transfer";
import { isValidLatLng, parseId, parsePolygon } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const ROUTE = "/api/mymaps/maps/[id]/import";

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId((await params).id);
    if (!mapId) {
      return NextResponse.json(
        { error: "Missing or invalid id" },
        { status: 400 },
      );
    }

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;
    const { access } = gate;

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = myMapsImportBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { mode, payload } = parsed.data;

    for (const n of payload.nodes) {
      if (!isValidLatLng(n.lat, n.lng)) {
        return NextResponse.json(
          { error: `Invalid lat/lng for node ${n.id}` },
          { status: 400 },
        );
      }
    }
    for (const p of payload.points) {
      if (!isValidLatLng(p.lat, p.lng)) {
        return NextResponse.json(
          { error: "Invalid lat/lng for point" },
          { status: 400 },
        );
      }
    }
    for (const t of payload.texts) {
      if (!isValidLatLng(t.lat, t.lng)) {
        return NextResponse.json(
          { error: "Invalid lat/lng for text" },
          { status: 400 },
        );
      }
    }

    const preparedPolygons: { name: string; polygon: string }[] = [];
    for (const p of payload.polygons) {
      const poly = parsePolygon(p.polygon);
      if (!poly) {
        return NextResponse.json(
          { error: "Invalid polygon in import" },
          { status: 400 },
        );
      }
      const props = (poly.polyObj.properties ?? {}) as Record<string, unknown>;
      props.name = p.name ?? "";
      props.myMapsId = mapId;
      poly.polyObj.properties = props;
      preparedPolygons.push({
        name: p.name ?? "",
        polygon: JSON.stringify(poly.polyObj),
      });
    }

    const preparedLines: { name: string; geometry: string }[] = [];
    for (const l of payload.lines) {
      const geom = toStoredLineGeometry(l.geometry);
      if (!geom) {
        return NextResponse.json(
          { error: "Invalid line geometry in import" },
          { status: 400 },
        );
      }
      preparedLines.push({ name: l.name ?? "", geometry: geom });
    }

    await db.transaction(async (tx) => {
      if (mode === "replace") {
        const existingNodes = await tx
          .select({ id: myMapsNode.id })
          .from(myMapsNode)
          .where(eq(myMapsNode.my_maps_id, mapId));
        const nodeIds = existingNodes.map((n) => n.id);
        if (nodeIds.length > 0) {
          await tx
            .delete(myMapsEdge)
            .where(
              or(
                inArray(myMapsEdge.node_a_id, nodeIds),
                inArray(myMapsEdge.node_b_id, nodeIds),
              ),
            );
        }
        await tx.delete(myMapsNode).where(eq(myMapsNode.my_maps_id, mapId));
        await tx
          .delete(myMapsPolygon)
          .where(eq(myMapsPolygon.my_maps_id, mapId));
        await tx.delete(myMapsLine).where(eq(myMapsLine.my_maps_id, mapId));
        await tx.delete(myMapsPoint).where(eq(myMapsPoint.my_maps_id, mapId));
        await tx.delete(myMapsText).where(eq(myMapsText.my_maps_id, mapId));
      }

      const idMap = new Map<number, number>();
      const nodeCoords = new Map<number, { lat: number; lng: number }>();

      for (const n of payload.nodes) {
        const [inserted] = await tx
          .insert(myMapsNode)
          .values({
            my_maps_id: mapId,
            lat: n.lat,
            lng: n.lng,
            name: n.name ?? "",
          })
          .returning();
        if (!inserted) continue;
        idMap.set(n.id, inserted.id);
        nodeCoords.set(inserted.id, { lat: inserted.lat, lng: inserted.lng });
      }

      const remapped = remapEdgeEndpoints(payload.edges, idMap);
      const seenPairs = new Set<string>();

      for (const e of remapped) {
        const a = Math.min(e.from, e.to);
        const b = Math.max(e.from, e.to);
        const pairKey = `${a}:${b}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        if (mode === "merge") {
          const [existing] = await tx
            .select({ id: myMapsEdge.id })
            .from(myMapsEdge)
            .where(
              and(eq(myMapsEdge.node_a_id, a), eq(myMapsEdge.node_b_id, b)),
            )
            .limit(1);
          if (existing) continue;
        }

        const nodeA = nodeCoords.get(a);
        const nodeB = nodeCoords.get(b);
        if (!nodeA || !nodeB) continue;

        const direction = e.biDirectional ? true : e.from === a;
        const distance = calcDistance(
          nodeA.lat,
          nodeA.lng,
          nodeB.lat,
          nodeB.lng,
        );

        await tx.insert(myMapsEdge).values({
          node_a_id: a,
          node_b_id: b,
          bi_directional: e.biDirectional,
          direction,
          distance,
          incline: e.incline,
          name: "",
        });
      }

      for (const p of preparedPolygons) {
        const [inserted] = await tx
          .insert(myMapsPolygon)
          .values({
            my_maps_id: mapId,
            name: p.name,
            polygon: p.polygon,
          })
          .returning();
        if (!inserted) continue;
        try {
          const obj = JSON.parse(p.polygon) as Record<string, unknown>;
          const props = (obj.properties ?? {}) as Record<string, unknown>;
          props.polygonId = inserted.id;
          obj.properties = props;
          await tx
            .update(myMapsPolygon)
            .set({ polygon: JSON.stringify(obj) })
            .where(eq(myMapsPolygon.id, inserted.id));
        } catch {
          /* keep raw polygon */
        }
      }

      for (const l of preparedLines) {
        await tx.insert(myMapsLine).values({
          my_maps_id: mapId,
          name: l.name,
          geometry: l.geometry,
        });
      }

      for (const p of payload.points) {
        await tx.insert(myMapsPoint).values({
          my_maps_id: mapId,
          lat: p.lat,
          lng: p.lng,
          name: p.name ?? "",
        });
      }

      for (const t of payload.texts) {
        await tx.insert(myMapsText).values({
          my_maps_id: mapId,
          text: t.text,
          lat: t.lat,
          lng: t.lng,
          font_size: t.font_size ?? 14,
        });
      }
    });

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

    return NextResponse.json(
      {
        ok: true,
        map: access.map,
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
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json(
      {
        error: "Import failed",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(getErrorDetail(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}
