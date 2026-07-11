import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraph } from "@/lib/navigation";
import { parseBoolean, parseId } from "@/lib/utils";

const navModeColumnMap = {
  isPedestrian: "is_pedestrian",
  isVehicular: "is_vehicular",
  isElevator: "is_elevator",
  isStairs: "is_stairs",
  isBlueLight: "is_blue_light",
  isBluelight: "is_blue_light",
  is_blue_light: "is_blue_light",
} as const;

const ROUTE = "/api/map/setFeatureStatus";

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const id = parseId(body.id);
    if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const value = parseBoolean(body.value);
    if (value == null) return NextResponse.json({ error: "Invalid value (must be boolean)" }, { status: 400 });

    const navModeRaw = String(body.navMode ?? "").trim() as keyof typeof navModeColumnMap;

    console.log(`[API ${ROUTE} POST] called`, { id, value, navMode: body.navMode });
    const column = navModeColumnMap[navModeRaw];
    if (!column) return NextResponse.json({ error: "Unsupported navMode" }, { status: 400 });

    const result = await db.execute(sql`
      UPDATE node_outside
      SET ${sql.identifier(column)} = ${value}
      WHERE id = ${id}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    await reloadGraph().catch(console.error);
    return NextResponse.json({ id, navMode: navModeRaw, value }, { status: 200 });
  } catch (err: any) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json({ error: "Update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(err?.message ?? String(err)) } : {}) }, { status: 500 });
  }
}
