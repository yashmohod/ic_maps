import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { jsonError, parseBoolean, parseId } from "@/lib/utils";

const navModeColumnMap = {
  isPedestrian: "is_pedestrian",
  isVehicular: "is_vehicular",
  isElevator: "is_elevator",
  isStairs: "is_stairs",
  isBlueLight: "is_blue_light",
  isBluelight: "is_blue_light",
  is_blue_light: "is_blue_light",
} as const;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const id = parseId(body.id);
    if (!id) return jsonError("Invalid id", 400);

    const value = parseBoolean(body.value);
    if (value == null) return jsonError("Invalid value (must be boolean)", 400);



    const navModeRaw = String(body.navMode ?? "").trim() as keyof typeof navModeColumnMap;
    const column = navModeColumnMap[navModeRaw];
    if (!column) return jsonError("Unsupported navMode", 400);

    const result = await db.execute(sql`
      UPDATE node_outside
      SET ${sql.identifier(column)} = ${value}
      WHERE id = ${id}
      RETURNING id;
    `);

    if (result.rows.length === 0) {
      return jsonError("Feature not found", 404);
    }

    return NextResponse.json({ id, navMode: navModeRaw, value }, { status: 200 });
  } catch (err: any) {
    return jsonError("Update failed", 500, err?.message ?? String(err));
  }
}
