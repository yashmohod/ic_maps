import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { campus_entrance } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  closestNode,
  navigate,
  navigateMulti,
  navigateToNode,
  navigateVehicularWithParking,
  outdoorNodeMatchesNav,
  startNodeForDestination,
  getGraph,
  pathToRouteGeometry,
  endNodeFromPath,
  computePathMetrics,
  computeRouteMetrics,
} from "@/lib/navigation";
import {
  buildRouteDirections,
  buildMultiLegDirections,
  buildMixedModeDirections,
  loadDestinationNames,
} from "@/lib/navigation-instructions";
import {
  takeRateLimit,
  clientIpFromRequest,
  NAVIGATE_RATE_LIMIT,
} from "@/lib/rate-limit";

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
    viaDestIds: z.array(z.coerce.number().int().positive()).max(10).optional(),
    /** When set, vehicular routes prefer this recommended parking lot. */
    preferredParkingLotId: z.coerce.number().int().positive().optional(),
    /** Replaces each building's saved recommended lots for this request. */
    parkingLotIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    gpsAt: z.enum(["start", "end"]).optional(),
    startDestId: z.coerce.number().int().positive().optional(),
    startNodeId: z.coerce.number().int().positive().optional(),
    endNodeId: z.coerce.number().int().positive().optional(),
    navConditions: navConditionsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const starts = [
      data.startNodeId != null,
      data.startDestId != null,
      data.gpsAt === "start",
    ].filter(Boolean).length;
    if (starts !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Choose exactly one start",
      });
    }
    const hasPlaces =
      data.destId != null || (data.viaDestIds?.length ?? 0) > 0;
    const ends = [
      data.endNodeId != null,
      hasPlaces,
      data.gpsAt === "end",
    ].filter(Boolean).length;
    if (ends !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Choose exactly one destination",
      });
    }
    if ((data.gpsAt === "start" || data.gpsAt === "end") && (data.lat == null || data.lng == null)) {
      ctx.addIssue({
        code: "custom",
        message: "lat and lng are required for a GPS end",
      });
    }
    if (
      data.startNodeId != null &&
      data.endNodeId != null &&
      data.startNodeId === data.endNodeId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Start and destination are the same",
      });
    }
  });

export async function POST(req: Request) {
  const limit = takeRateLimit(
    `navigate:${clientIpFromRequest(req)}`,
    NAVIGATE_RATE_LIMIT,
  );
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "Too many route requests. Slow down.",
        retryAfterMs: limit.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

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
      preferredParkingLotId,
      parkingLotIds,
      lat,
      lng,
      gpsAt,
      startDestId,
      startNodeId: requestedStartNodeId,
      endNodeId: requestedEndNodeId,
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
      preferredParkingLotId,
      parkingLotIds,
      lat,
      lng,
      gpsAt,
      startDestId,
      requestedStartNodeId,
      requestedEndNodeId,
      navConditions,
    });

    const graph = await getGraph();

    let goalNodeId = requestedEndNodeId ?? null;
    if (gpsAt === "end") {
      goalNodeId = await closestNode(lat!, lng!, navConditions);
      if (goalNodeId < 0) {
        return NextResponse.json(
          { error: "No nearby routing node found" },
          { status: 404 },
        );
      }
    }

    let target = { lat: lat ?? 0, lng: lng ?? 0 };
    if (goalNodeId != null) {
      const goal = graph.nodesOutside.get(goalNodeId);
      if (!goal) {
        return NextResponse.json(
          { error: "Destination node not found" },
          { status: 404 },
        );
      }
      target = { lat: goal.lat, lng: goal.lng };
    } else if (destIds[0] != null) {
      const destRow = await db
        .execute(
          sql`SELECT lat, lng FROM destination WHERE id = ${destIds[0]}`,
        )
        .then(
          (res) => res.rows[0] as { lat: number; lng: number } | undefined,
        );
      if (!destRow) {
        return NextResponse.json(
          { error: "Destination not found" },
          { status: 404 },
        );
      }
      target = { lat: Number(destRow.lat), lng: Number(destRow.lng) };
    }

    let startNodeId = -1;
    let originBuildingId: number | null = null;
    if (requestedStartNodeId != null) {
      const node = graph.nodesOutside.get(requestedStartNodeId);
      if (!node || !outdoorNodeMatchesNav(node, navConditions)) {
        return NextResponse.json(
          { error: "That entrance is not available for this mode" },
          { status: 404 },
        );
      }
      startNodeId = requestedStartNodeId;
    } else if (startDestId != null) {
      startNodeId = await startNodeForDestination(
        startDestId,
        target,
        navConditions,
      );
      if (startNodeId < 0 && navConditions.is_vehicular) {
        startNodeId = await startNodeForDestination(startDestId, target, {
          ...navConditions,
          is_pedestrian: true,
          is_vehicular: false,
        });
        if (startNodeId > 0) originBuildingId = startDestId;
      }
      if (startNodeId < 0) {
        return NextResponse.json(
          { error: "This place has no entrance for this mode" },
          { status: 404 },
        );
      }
    } else {
      startNodeId = await closestNode(lat!, lng!, navConditions);
      if (startNodeId < 0) {
        return NextResponse.json(
          { error: "No nearby routing node found" },
          { status: 404 },
        );
      }
    }

    const startNode = graph.nodesOutside.get(startNodeId);
    if (!startNode) {
      return NextResponse.json(
        { error: "Start node not found in graph" },
        { status: 500 },
      );
    }

    if (goalNodeId != null) {
      const goalNode = graph.nodesOutside.get(goalNodeId);
      if (!goalNode || !outdoorNodeMatchesNav(goalNode, navConditions)) {
        return NextResponse.json(
          { error: "That entrance is not available for this mode" },
          { status: 404 },
        );
      }
      if (originBuildingId == null) {
        const nodePath = await navigateToNode(
        startNodeId,
        goalNodeId,
        navConditions,
      );
      if (!nodePath || nodePath.length === 0) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
      }
      const geometry = pathToRouteGeometry(graph, nodePath, startNodeId);
      const lastNodeId = endNodeFromPath(graph, startNodeId, nodePath);
      const pathMetrics = computePathMetrics(
        graph,
        startNodeId,
        nodePath,
        navConditions,
      );
      const [entrance] = requestedEndNodeId
        ? await db
            .select({ name: campus_entrance.name })
            .from(campus_entrance)
            .where(eq(campus_entrance.node_outside_id, requestedEndNodeId))
            .limit(1)
        : [];
      const endLabel = entrance?.name ?? "your location";
      const steps = buildRouteDirections(
        graph,
        nodePath,
        startNodeId,
        navConditions,
        new Map(),
        { finalDestinationName: endLabel },
      );
      return NextResponse.json(
        {
          path: nodePath,
          geometry,
          firstNodeId: startNodeId,
          lastNodeId,
          startNode: {
            id: startNodeId,
            lat: startNode.lat,
            lng: startNode.lng,
          },
          distanceMeters: pathMetrics.distanceMeters,
          durationSeconds: pathMetrics.durationSeconds,
          legs: [
            {
              destinationId: requestedEndNodeId ?? 0,
              distanceMeters: pathMetrics.distanceMeters,
              durationSeconds: pathMetrics.durationSeconds,
              mode: navConditions.is_vehicular
                ? ("vehicular" as const)
                : ("pedestrian" as const),
              kind: "building" as const,
            },
          ],
          steps,
        },
        { status: 200 },
      );
      }
    }

    if (navConditions.is_vehicular) {
      const mixed = await navigateVehicularWithParking(
        startNodeId,
        destIds,
        navConditions,
        preferredParkingLotId ?? null,
        parkingLotIds ?? null,
        originBuildingId,
        originBuildingId != null ? goalNodeId : null,
      );
      if (!mixed) {
        return NextResponse.json({ error: "No route found" }, { status: 404 });
      }

      const geometry = pathToRouteGeometry(graph, mixed.path, startNodeId);
      const lastNodeId = endNodeFromPath(graph, startNodeId, mixed.path);
      const steps = await buildMixedModeDirections(
        graph,
        startNodeId,
        mixed.legs,
        mixed.legPaths,
        navConditions,
      );

      return NextResponse.json(
        {
          path: mixed.path,
          geometry: {
            ...geometry,
            modeSegments: mixed.modeSegments,
          },
          firstNodeId: startNodeId,
          lastNodeId,
          startNode: {
            id: startNodeId,
            lat: startNode.lat,
            lng: startNode.lng,
          },
          distanceMeters: mixed.distanceMeters,
          durationSeconds: mixed.durationSeconds,
          legs: mixed.legs,
          steps,
        },
        { status: 200 },
      );
    }

    const path =
      destIds.length === 1
        ? await navigate(startNodeId, destIds[0]!, navConditions)
        : await navigateMulti(startNodeId, destIds, navConditions);

    if (path === null) {
      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const geometry = pathToRouteGeometry(graph, path, startNodeId);
    const lastNodeId = endNodeFromPath(graph, startNodeId, path);

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
                  mode: "pedestrian" as const,
                  kind: "building" as const,
                },
              ],
            };
          })()
        : await computeRouteMetrics(startNodeId, destIds, navConditions);

    if (!metrics) {
      return NextResponse.json(
        { error: "Could not compute route metrics" },
        { status: 500 },
      );
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
            (from, dId, nav) => navigate(from, dId, nav),
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
    return NextResponse.json(
      {
        error: "Could not find a route!",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(message) }
          : {}),
      },
      { status: 500 },
    );
  } finally {
    limit.release();
  }
}
