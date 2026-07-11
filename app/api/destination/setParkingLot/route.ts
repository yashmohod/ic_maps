import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/destination/setParkingLot";

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { id, isParkingLot } = body as { id: unknown; isParkingLot: boolean };
    console.log(`[API ${ROUTE} POST] called`, { id, isParkingLot });
    const nid = parseId(id);
    if (!nid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const result = isParkingLot
      ? await db.execute(sql`
          UPDATE destination
          SET is_parking_lot = true,
              open_time = ${"00:00:00"},
              close_time = ${"23:59:59"}
          WHERE id = ${nid};
        `)
      : await db.execute(sql`
          UPDATE destination
          SET is_parking_lot = false
          WHERE id = ${nid};
        `);

    if (result.rowCount === 0) return NextResponse.json({ error: "DB did not update" }, { status: 400 });

    return NextResponse.json({}, { status: 200 });
  } catch (e: any) {
    console.error(`[API ${ROUTE} POST] error`, e);
    return NextResponse.json({ error: "Could not set parking lot status.", ...(process.env.NODE_ENV !== "production" ? { detail: String(e?.message ?? e) } : {}) }, { status: 500 });
  }
}
