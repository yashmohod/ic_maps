import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { jsonError, isFiniteNumber, parseId } from "@/lib/utils";

/**
 * POST /api/map/incline
 * Body: { id: number, incline: number }
 * Updates the incline (meters) for an edge_outside by id.
 */
const ROUTE = "/api/map/incline";
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id, incline } = body as { id: unknown; incline: unknown };
    console.log(`[API ${ROUTE} POST] called`, { id, incline });

    const edgeId = parseId(id);
    if (!edgeId) return jsonError("Invalid id", 400);

    if (!isFiniteNumber(incline)) {
      return jsonError("Invalid incline: must be a number", 400);
    }

    const result = await db.execute(sql`
      UPDATE edge_outside
      SET incline = ${incline as number}
      WHERE id = ${edgeId}
      RETURNING id, incline;
    `);

    if (result.rows.length === 0) {
      return jsonError("Edge not found", 404);
    }

    const row = result.rows[0] as { id: number; incline: number };
    return NextResponse.json(
      { id: row.id, incline: row.incline },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Update failed", 500, message);
  }
}
