import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { calcDistance } from "@/lib/utils";
import { jsonError, parseId } from "@/lib/utils";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { from, to, biDirectionalEdges } = body as {
      from: unknown;
      to: unknown;
      biDirectionalEdges: unknown;
    };
    console.log(from, to, biDirectionalEdges);
    const fromId = Number(from);
    const toId = Number(to);

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
      return jsonError("Insert failed", 500, "Insert did not return an id");
    }
    const ff = direction ? a : b;
    const tt = direction ? b : a;
    return NextResponse.json({ id: inserted.id, a:ff, b:tt }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Insert failed", 500, message);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id } = body as { id: unknown };

    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    const result = await db.execute(sql`
      DELETE FROM edge_outside
      WHERE id = ${nid}
    `);

    if (result.rowCount === 0) {
      return jsonError("Edge not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Delete failed", 500, message);
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Optional: allow filtering by id (?id=123). If absent, return all.
    const idParam = searchParams.get("id");

    if (idParam != null) {
      const nid = parseId(idParam);
      if (!nid) return jsonError("Invalid id", 400);

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

      if (result.rows.length === 0) return jsonError("Edge not found", 404);
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
        key: curedge.id,
        from: curedge.direction ? curedge.node_a_id : curedge.node_b_id,
        to: curedge.direction ? curedge.node_b_id : curedge.node_a_id,
        biDirectional: curedge.bi_directional,
        incline: curedge.incline,
      };
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch nodes", 500, message);
  }
}
