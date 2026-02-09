import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { closestNode } from "@/lib/navigation";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const nodeId: number = Number(searchParams.get("nodeId"));
  const isBlueLight: boolean = Boolean(searchParams.get("isBlueLight"));

  const result = await db.execute(sql<Node>`UPDATE node SET blue_light=${isBlueLight} WHERE id=${nodeId} `);
  const rowCount = Number(result.rowCount) | 0;
  if (rowCount > 0) {
    return NextResponse.json({ "message": "BlueLight added!" }, { status: 200 });
  } else {
    return NextResponse.json({ "error": "BlueLight could not be added!" }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat: number = Number(searchParams.get("lat"));
  const lng: number = Number(searchParams.get("lng"));

  // find the closest node to start navigation from 
  const startingNodeId = closestNode(lng, lat);

  //navigate to the closest Blue light

  //return path


}
