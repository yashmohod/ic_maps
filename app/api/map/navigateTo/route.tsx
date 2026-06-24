import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/utils";
import {
  closestNode,
  navigate,
  navigateMulti,
  navigateMultiWithPedestrianFinalLeg,
  getGraph,
  pathToRouteGeometry,
  endNodeFromPath,
  computePathMetrics,
  computeRouteMetrics,
} from "@/lib/navigation";
import {
  buildRouteDirections,
  buildMultiLegDirections,
  loadDestinationNames,
} from "@/lib/navigation-instructions";

const navConditionsSchema = z.object({
  is_pedestrian: z.boolean().optional().default(true),
  is_vehicular: z.boolean().optional().default(false),
  is_through_building: z.boolean().optional().default(false),
  is_avoid_stairs: z.boolean().optional().default(false),
  is_incline_limit: z.boolean().optional().default(false),
  max_incline: z.number().optional().default(0),
});

const navigateToSchema = z
  .object({
    destId: z.coerce.number().int().positive().optional(),
    viaDestIds: z.array(z.coerce.number().int().positive()).optional(),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    navConditions: navConditionsSchema.optional(),
  })
  .refine((data) => data.destId != null || (data.viaDestIds?.length ?? 0) > 0, {
    message: "destId or viaDestIds is required",
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

    const {
      destId,
      viaDestIds,
      lat,
      lng,
      navConditions: rawConditions,
    } = parsed.data;
    const navConditions = {
      is_pedestrian: rawConditions?.is_pedestrian ?? true,
      is_vehicular: rawConditions?.is_vehicular ?? false,
      is_through_building: rawConditions?.is_through_building ?? false,
      is_avoid_stairs: rawConditions?.is_avoid_stairs ?? false,
      is_incline_limit: rawConditions?.is_incline_limit ?? false,
      max_incline: rawConditions?.max_incline ?? 0,
    };

    const destIds =
      viaDestIds && viaDestIds.length > 0
        ? viaDestIds
        : destId != null
          ? [destId]
          : [];

    console.log(`[API /api/map/navigateTo POST] called`, {
      destId,
      viaDestIds,
      lat,
      lng,
      navConditions,
    });

    const startNodeId = await closestNode(lat, lng, navConditions);
    if (startNodeId < 0) {
      return jsonError("No nearby routing node found", 404);
    }

    const path =
      destIds.length === 1
        ? await navigate(startNodeId, destIds[0]!, navConditions)
        : destIds.length > 1 && navConditions.is_vehicular
          ? await navigateMultiWithPedestrianFinalLeg(
              startNodeId,
              destIds,
              navConditions,
            )
          : await navigateMulti(startNodeId, destIds, navConditions);

    if (path === null) {
      return jsonError("No route found", 404);
    }

    const graph = await getGraph();
    const geometry = pathToRouteGeometry(graph, path, startNodeId);
    const lastNodeId = endNodeFromPath(graph, startNodeId, path);
    const startNode = graph.nodesOutside.get(startNodeId);

    if (!startNode) {
      return jsonError("Start node not found in graph", 500);
    }

    const metrics =
      destIds.length === 1
        ? (() => {
            const pathMetrics = computePathMetrics(
              graph,
              startNodeId,
              path,
              navConditions,
            );
            return {
              distanceMeters: pathMetrics.distanceMeters,
              durationSeconds: pathMetrics.durationSeconds,
              legs: [
                {
                  destinationId: destIds[0]!,
                  distanceMeters: pathMetrics.distanceMeters,
                  durationSeconds: pathMetrics.durationSeconds,
                },
              ],
            };
          })()
        : await computeRouteMetrics(startNodeId, destIds, navConditions);

    if (!metrics) {
      return jsonError("Could not compute route metrics", 500);
    }

    const destinationNames = await loadDestinationNames(destIds);
    const finalName =
      destIds.length === 1
        ? (destinationNames.get(destIds[0]!) ?? "destination")
        : undefined;

    const steps =
      destIds.length === 1
        ? buildRouteDirections(
            graph,
            path,
            startNodeId,
            navConditions,
            destinationNames,
            { finalDestinationName: finalName },
          )
        : await buildMultiLegDirections(
            graph,
            startNodeId,
            destIds,
            navConditions,
            (from, destId, nav) => navigate(from, destId, nav),
          );

    return NextResponse.json(
      {
        path,
        geometry,
        firstNodeId: startNodeId,
        lastNodeId,
        startNode: {
          id: startNodeId,
          lat: startNode.lat,
          lng: startNode.lng,
        },
        distanceMeters: metrics.distanceMeters,
        durationSeconds: metrics.durationSeconds,
        legs: metrics.legs,
        steps,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error("[API /api/map/navigateTo POST] error", err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not find a route!", 500, message);
  }
}
