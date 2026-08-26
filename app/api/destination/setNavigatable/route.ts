import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth-guards";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/destination/setNavigatable";

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { id, navigatableDestination } = body as {
      id: unknown;
      navigatableDestination: unknown;
    };
    console.log(`[API ${ROUTE} POST] called`, { id, navigatableDestination });
    const nid = parseId(id);
    if (!nid) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (typeof navigatableDestination !== "boolean") {
      return NextResponse.json(
        { error: "navigatableDestination must be a boolean" },
        { status: 400 },
      );
    }

    const result = await db.execute(sql`
      UPDATE destination
      SET navigatable_destination = ${navigatableDestination}
      WHERE id = ${nid};
    `);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "DB did not update" }, { status: 400 });
    }

    return NextResponse.json({}, { status: 200 });
  } catch (e: unknown) {
    console.error(`[API ${ROUTE} POST] error`, e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "Could not set navigatable destination status.",
        ...(process.env.NODE_ENV !== "production" ? { detail } : {}),
      },
      { status: 500 },
    );
  }
}
