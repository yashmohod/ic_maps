import { NextResponse } from "next/server";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { destId, lat, lng, navMode } = body as { destId: number, lat: number; lng: number, navMode: number };



  } catch (err: any) {
    jsonError("Could not find a route!", 500, err?.message ?? err);
  }

}
