import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";

const includeDetail = process.env.NODE_ENV !== "production";

const navModeColumnMap = {
  isPedestrian: "is_pedestrian",
  isVehicular: "is_vehicular",
  isElevator: "is_elevator",
  isStairs: "is_stairs",
  isBlueLight: "is_blue_light",
  // Backward compatible aliases.
  isBluelight: "is_blue_light",
  is_blue_light: "is_blue_light",
} as const;

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(includeDetail && detail != null ? { detail: String(detail) } : {}),
    },
    { status },
  );
}

function parseId(id: unknown): number | null {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return Boolean(v);
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

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
