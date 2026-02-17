import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { EdgeOutside, NodeOutside } from "@/db/schema";
import { calcDistance } from "@/lib/navigation";
import { Edge } from "@xyflow/react";

// Include `detail` only in development (recommended).
const includeDetail = process.env.NODE_ENV !== "production";

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(includeDetail && detail != null ? { detail: String(detail) } : {}),
    },
    { status },
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidLatLng(lat: unknown, lng: unknown) {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function parseId(id: unknown): number | null {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

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
      db.execute(sql`SELECT * FROM node_outside WHERE id = ${a}`),
      db.execute(sql`SELECT * FROM node_outside WHERE id = ${b}`),
    ]);
    const nodeA = (resA.rows[0] as NodeOutside | undefined) ?? null;
    const nodeB = (resB.rows[0] as NodeOutside | undefined) ?? null;

    const distance = calcDistance(
      nodeA?.lat ?? 0,
      nodeA?.lng ?? 0,
      nodeB?.lat ?? 0,
      nodeB?.lng ?? 0,
    );

    const result = await db.execute(sql`
      INSERT INTO edge_outside (node_a_id, node_b_id, bi_directional, direction, distance)
      VALUES ( ${a}, ${b}, ${biDirectionalEdges}, ${direction}, ${distance})
      RETURNING id;
    `);

    const inserted = result.rows[0];
    if (!inserted?.id) {
      return jsonError("Insert failed", 500, "Insert did not return an id");
    }

    return NextResponse.json({ id: inserted.id, a, b }, { status: 201 });
  } catch (err: any) {
    return jsonError("Insert failed", 500, err?.message ?? err);
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

    if (result.rows.length === 0) {
      return jsonError("Edge not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: any) {
    return jsonError("Delete failed", 500, err?.message ?? err);
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

      const result = await db.execute(sql`
        SELECT * FROM edge_outside WHERE id = ${nid};
      `);

      if (result.rows.length === 0) return jsonError("Edge not found", 404);
      return NextResponse.json(
        { row: result.rows[0] as EdgeOutside },
        { status: 200 },
      );
    }

    const result = await db
      .execute(
        sql`
      SELECT * FROM edge_outside;
    `,
      )
      .then((res) => {
        return res.rows as EdgeOutside[];
      });

    let rows = result.map((curedge) => {
      return {
        key: curedge.id,
        from: curedge.direction ? curedge.nodeAId : curedge.nodeBId,
        to: curedge.direction ? curedge.nodeBId : curedge.nodeAId,
        biDirectional: curedge.biDirectional,
        isPedestrian: curedge.isPedestrian,
        isVehicular: curedge.isVehicular,
        isStairs: curedge.isStairs,
        isElevator: curedge.isElevator,
        incline: curedge.incline,
      };
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: any) {
    return jsonError("Could not fetch nodes", 500, err?.message ?? err);
  }
}
