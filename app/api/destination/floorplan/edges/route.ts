import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraph } from "@/lib/navigation";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/destination/floorplan/edges";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationId = searchParams.get("destinationId");
    console.log(`[API ${ROUTE} GET] called`, { destinationId });
    const did = parseId(destinationId);
    if (!did) return NextResponse.json({ error: "Invalid destinationId" }, { status: 400 });

    const result = await db.execute(sql`
      SELECT id, node_a_id AS "nodeAId", node_b_id AS "nodeBId",
             direction, bi_directional AS "biDirectional",
             source_handle AS "sourceHandle", target_handle AS "targetHandle"
      FROM edge_inside
      WHERE destination_id = ${did}
      ORDER BY id
    `);

    const edges = result.rows.map((row) => ({
      id: row.id,
      nodeAId: row.nodeAId,
      nodeBId: row.nodeBId,
      direction: Boolean(row.direction),
      biDirectional: Boolean(row.biDirectional),
      sourceHandle: row.sourceHandle ?? null,
      targetHandle: row.targetHandle ?? null,
    }));

    return NextResponse.json({ edges }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Could not fetch edges", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const VALID_HANDLES = new Set(["top", "right", "bottom", "left"]);
    const { destinationId, from, to, biDirectional, sourceHandle, targetHandle } = body as Record<
      string,
      unknown
    >;

    console.log(`[API ${ROUTE} POST] called`, {
      destinationId,
      from,
      to,
      biDirectional,
      sourceHandle,
      targetHandle,
    });

    const did = parseId(destinationId);
    if (!did) return NextResponse.json({ error: "Invalid destinationId" }, { status: 400 });
    const fromId = parseId(from);
    const toId = parseId(to);
    if (!fromId || !toId) return NextResponse.json({ error: "Invalid from or to" }, { status: 400 });
    if (fromId === toId) return NextResponse.json({ error: "from and to must differ" }, { status: 400 });

    const srcHandle =
      sourceHandle != null && typeof sourceHandle === "string" && VALID_HANDLES.has(sourceHandle)
        ? sourceHandle
        : null;
    const tgtHandle =
      targetHandle != null && typeof targetHandle === "string" && VALID_HANDLES.has(targetHandle)
        ? targetHandle
        : null;

    const a = Math.min(fromId, toId);
    const b = Math.max(fromId, toId);
    // Store actual connection direction so source/target and handles stay consistent on reload.
    const direction = fromId === a;

    const result = await db.execute(sql`
      INSERT INTO edge_inside (destination_id, node_a_id, node_b_id, bi_directional, direction, source_handle, target_handle)
      VALUES (${did}, ${a}, ${b}, ${biDirectional !== false}, ${direction}, ${srcHandle}, ${tgtHandle})
      ON CONFLICT (node_a_id, node_b_id) DO UPDATE SET
        source_handle = EXCLUDED.source_handle,
        target_handle = EXCLUDED.target_handle
      RETURNING id
    `);

    const row = result.rows[0];
    if (!row?.id) return NextResponse.json({ error: "Insert/update edge failed" }, { status: 500 });

    await reloadGraph().catch(console.error);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id } = body as { id: unknown };
    console.log(`[API ${ROUTE} DELETE] called`, { id });
    const eid = parseId(id);
    if (!eid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const result = await db.execute(sql`DELETE FROM edge_inside WHERE id = ${eid} RETURNING id`);

    if (result.rows.length === 0) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

    await reloadGraph().catch(console.error);
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}
