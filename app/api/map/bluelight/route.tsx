import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { params } = new URL(req.url);
  const nodeId: number = Number(params.get("nodeId"));
  const isBlueLight: boolean = Boolean(params.get("isBlueLight"));

  await db.execute(sql<Node>`UPDATE node SET blue_light=${isBlueLight} WHERE id=${nodeId} `);


  return NextResponse.json({}, { status: 200 });
}

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND}/map/bluelight${qs}`);

  // safest passthrough (doesn't explode on non-json errors)
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
