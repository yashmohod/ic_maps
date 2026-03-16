import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db/index";
import { auth } from "@/lib/auth";
import { jsonError, parseId } from "@/lib/utils";

const ROUTE = "/api/destination/setParkingLot";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const { id, isParkingLot } = body as { id: unknown; isParkingLot: boolean };
    console.log(`[API ${ROUTE} POST] called`, { id, isParkingLot });
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
    console.error(`[API ${ROUTE} POST] error`, e);
    return jsonError("Could not set parking lot status.", 500, e?.message ?? e);
  }
}
