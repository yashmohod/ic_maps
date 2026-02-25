import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { jsonError, parseId } from "@/lib/utils";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const { id, isParkingLot } = body as { id: unknown; isParkingLot: boolean };
    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

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

    if (result.rowCount === 0) return jsonError("DB did not update", 400);

    return NextResponse.json({}, { status: 200 });
  } catch (e: any) {
    return jsonError("Could not set parking lot status.", 500, e?.message ?? e);
  }
}
