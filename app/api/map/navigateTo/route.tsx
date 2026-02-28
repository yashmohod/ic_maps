import { NextResponse } from "next/server";
import { jsonError } from "@/lib/utils";
import { closestNode, navigate } from "@/lib/navigation";
import type { NavConditions } from "@/lib/navigation";



export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { destId, lat, lng, navConditions } = body as {
      destId: number,
      lat: number;
      lng: number,
      navConditions: NavConditions;
    };

    const startNodeId: number = await closestNode(lat, lng, navConditions);
    // console.log(startNodeId, destId, navConditions)
    const path: number[] | null = await navigate(startNodeId, destId, navConditions)

    console.log(path);
    return NextResponse.json({ path }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not find a route!", 500, message);
  }

}
