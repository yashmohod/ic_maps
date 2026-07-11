import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraph } from "@/lib/navigation";
import { calcDistance } from "@/lib/geo";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/map/edge";

const edgePostSchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  biDirectionalEdges: z.boolean().optional().default(false),
});

const edgeDeleteSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = edgePostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { from: fromId, to: toId, biDirectionalEdges } = parsed.data;
    console.log(`[API ${ROUTE} POST] called`, { from: fromId, to: toId, biDirectionalEdges });

    const a = Math.min(fromId, toId);
    const b = Math.max(fromId, toId);

    // direction only matters if not bidirectional
    const direction = biDirectionalEdges ? true : fromId === a;

    // distance
    const [resA, resB] = await Promise.all([
      db.execute(sql<{ lat: number; lng: number }>`
        SELECT lat, lng FROM node_outside WHERE id = ${a}
      `),
      db.execute(sql<{ lat: number; lng: number }>`
        SELECT lat, lng FROM node_outside WHERE id = ${b}
      `),
    ]);
    const nodeA = resA.rows[0] as { lat: number; lng: number } | undefined;
    const nodeB = resB.rows[0] as { lat: number; lng: number } | undefined;

    const distance = calcDistance(
      nodeA?.lat ?? 0,
      nodeA?.lng ?? 0,
      nodeB?.lat ?? 0,
      nodeB?.lng ?? 0,
    );

    const result = await db.execute(sql`
      INSERT INTO edge_outside (node_a_id, node_b_id, bi_directional, direction, distance)
      VALUES (${a}, ${b}, ${biDirectionalEdges}, ${direction}, ${distance})
      RETURNING id;
    `);

    const inserted = result.rows[0];
    if (!inserted?.id) {
      return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String("Insert did not return an id") } : {}) }, { status: 500 });
    }
    const ff = direction ? a : b;
    const tt = direction ? b : a;
    await reloadGraph().catch(console.error);
    return NextResponse.json({ id: inserted.id, a:ff, b:tt }, { status: 201 });
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

    const parsed = edgeDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id } = parsed.data;
    console.log(`[API ${ROUTE} DELETE] called`, { id });

    const result = await db.execute(sql`
      DELETE FROM edge_outside
      WHERE id = ${id}
    `);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    await reloadGraph().catch(console.error);
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Optional: allow filtering by id (?id=123). If absent, return all.
    const idParam = searchParams.get("id");
    console.log(`[API ${ROUTE} GET] called`, { idParam });

    if (idParam != null) {
      const nid = parseId(idParam);
      if (!nid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

      const result = await db.execute(sql<{
        id: number;
        node_a_id: number;
        node_b_id: number;
        bi_directional: boolean;
        direction: boolean;
        distance: number;
        incline: number;
      }>`
        SELECT
          id,
          node_a_id,
          node_b_id,
          bi_directional,
          direction,
          distance,
          incline
        FROM edge_outside
        WHERE id = ${nid};
      `);

      if (result.rows.length === 0) return NextResponse.json({ error: "Edge not found" }, { status: 404 });
      const row = result.rows[0];
      return NextResponse.json({
        row: {
          id: row.id,
          nodeAId: row.node_a_id,
          nodeBId: row.node_b_id,
          biDirectional: row.bi_directional,
          direction: row.direction,
          distance: row.distance,
          incline: row.incline,
        },
      }, { status: 200 });
    }

    const result = await db.execute(sql<{
      id: number;
      node_a_id: number;
      node_b_id: number;
      bi_directional: boolean;
      direction: boolean;
      distance: number;
      incline: number;
    }>`
      SELECT
        id,
        node_a_id,
        node_b_id,
        bi_directional,
        direction,
        distance,
        incline
      FROM edge_outside;
    `);

    const rows = result.rows.map((curedge) => {
      return {
        id: curedge.id,
        from: curedge.direction ? curedge.node_a_id : curedge.node_b_id,
        to: curedge.direction ? curedge.node_b_id : curedge.node_a_id,
        biDirectional: curedge.bi_directional,
        incline: curedge.incline,
      };
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Could not fetch nodes", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}
