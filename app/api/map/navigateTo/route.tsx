import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/utils";
import { closestNode, navigate } from "@/lib/navigation";

const navigateToSchema = z.object({
  destId: z.coerce.number().int().positive(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  navConditions: z.object({
    is_pedestrian: z.boolean().optional().default(true),
    is_vehicular: z.boolean().optional().default(false),
    is_through_building: z.boolean().optional().default(false),
    is_avoid_stairs: z.boolean().optional().default(false),
    is_incline_limit: z.boolean().optional().default(false),
    max_incline: z.number().optional().default(0),
  }).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = navigateToSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { destId, lat, lng, navConditions } = parsed.data;

    console.log(`[API /api/map/navigateTo POST] called`, { destId, lat, lng, navConditions });

    const startNodeId: number = await closestNode(lat, lng, navConditions);
    // console.log(startNodeId, destId, navConditions)
    const path: number[] | null = await navigate(startNodeId, destId, navConditions)

    return NextResponse.json({ path }, { status: 200 })
  } catch (err: unknown) {
    console.error("[API /api/map/navigateTo POST] error", err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not find a route!", 500, message);
  }

}
