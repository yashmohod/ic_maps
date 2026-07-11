import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraph } from "@/lib/navigation";
import { isFiniteNumber, parseId } from "@/lib/utils";

/**
 * POST /api/map/incline
 * Body: { id: number, incline: number }
 * Updates the incline (meters) for an edge_outside by id.
 */
const ROUTE = "/api/map/incline";
export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id, incline } = body as { id: unknown; incline: unknown };
    console.log(`[API ${ROUTE} POST] called`, { id, incline });

    const edgeId = parseId(id);
    if (!edgeId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    if (!isFiniteNumber(incline)) {
      return NextResponse.json({ error: "Invalid incline: must be a number" }, { status: 400 });
    }

    const result = await db.execute(sql`
      UPDATE edge_outside
      SET incline = ${incline as number}
      WHERE id = ${edgeId}
      RETURNING id, incline;
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    const row = result.rows[0] as { id: number; incline: number };
    await reloadGraph().catch(console.error);
    return NextResponse.json(
      { id: row.id, incline: row.incline },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}
