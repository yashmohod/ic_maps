import { sql } from "drizzle-orm";
import { db } from "@/db";
import { calcDistance, heuristic } from "@/lib/geo";
import {
  durationSecondsFromDistance,
  lineStringLengthMeters,
  STAIR_DISTANCE_FACTOR,
} from "@/lib/route-metrics";

import "server-only";
import {
  type DestinationNode,
  type EdgeInside,
  type EdgeOutside,
  type NodeInside,
  type NodeOutside,
} from "@/db/schema";
import { MinHeap } from "./minHeap";
import {
  buildGraph,
  endNodeFromPath,
  nextNodeFromEdge,
  through_building_bfs_with_cost,
  encodeThroughBuildingHop,
  isThroughBuildingHop,
  type Graph,
  type NavConditions,
} from "@/lib/navigation-graph";
import { pathToRouteDrawModel } from "@/lib/navigation-route-model";
import type { RouteLegMetrics } from "@/lib/types/map";

export type { Graph, NavConditions } from "@/lib/navigation-graph";
export { endNodeFromPath, nextNodeFromEdge } from "@/lib/navigation-graph";

const FILE = "navigation.ts";
function logReturnNull(_reason: string): void {}

/** Closest outdoor node to a (lat, lng) point (for outdoor routing), filtered by nav mode. */
export async function closestNode(
  lat: number,
  lng: number,
  navConditions: NavConditions,
): Promise<number> {
  const { is_pedestrian, is_vehicular } = navConditions;
  const row = await db
    .execute(
      sql<{ id: number }>`
        SELECT id FROM node_outside
        WHERE is_dead = false
          AND ((${is_pedestrian} AND is_pedestrian = true) OR (${is_vehicular} AND is_vehicular = true))
        ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), id
        LIMIT 1
      `,
    )
    .then((cur) => cur.rows[0] as { id: number } | undefined);
  return row?.id ?? -1;
}

///////////////////////////////// --  Graph -- ////////////////////////////////////////

type GraphStore = {
  graph: Graph | null;
  loading: Promise<Graph> | null;
  /** Bumped on every load/reload; only matching gen may commit to store.graph */
  generation: number;
};

declare global {
  var __graphStore: GraphStore | undefined;
}

const store: GraphStore = globalThis.__graphStore ?? {
  graph: null,
  loading: null,
  generation: 0,
};

if (process.env.NODE_ENV !== "production") globalThis.__graphStore = store;

// Load graph from DB only once (per process)
async function loadGraphFromDb(): Promise<Graph> {
  const [
    nodeInsideRes,
    nodeOutsideRes,
    edgeInsideRes,
    edgeOutsideRes,
    destinationNodeOutside,
  ] = await Promise.all([
    db.execute(sql<NodeInside>`SELECT * FROM node_inside`),
    db.execute(sql<NodeOutside>`SELECT * FROM node_outside`),
    db.execute(sql<EdgeInside>`SELECT * FROM edge_inside`),
    db.execute(sql<EdgeOutside>`SELECT * FROM edge_outside`),
    db.execute(sql<DestinationNode>`SELECT * FROM destination_node`),
  ]);

  const version = (store.graph?.version ?? 0) + 1;
  return buildGraph(
    nodeInsideRes.rows as NodeInside[],
    edgeInsideRes.rows as EdgeInside[],
    nodeOutsideRes.rows as NodeOutside[],
    edgeOutsideRes.rows as EdgeOutside[],
    destinationNodeOutside.rows as DestinationNode[],
    version,
  );
}

export async function getGraph(): Promise<Graph> {
  if (store.graph) return store.graph;

  if (!store.loading) {
    const gen = ++store.generation;
    store.loading = loadGraphFromDb()
      .then((g) => {
        if (gen === store.generation) {
          store.graph = g;
        }
        if (store.loading) store.loading = null;
        return store.graph ?? g;
      })
      .catch((e) => {
        if (gen === store.generation) store.loading = null;
        throw e;
      });
  }

  return store.loading;
}

/**
 * Mutate by REBUILDING (safe + easy).
 * Generation counter prevents an older in-flight getGraph load from overwriting.
 */
export async function reloadGraph(): Promise<Graph> {
  const gen = ++store.generation;
  store.loading = null;
  const g = await loadGraphFromDb();
  if (gen === store.generation) {
    store.graph = g;
  }
  return store.graph ?? g;
}

/** Retry reload a few times; throws if all attempts fail. */
export async function reloadGraphReliable(attempts = 3): Promise<Graph> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await reloadGraph();
    } catch (err) {
      lastErr = err;
      console.error(`[reloadGraphReliable] attempt ${i + 1} failed`, err);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "reloadGraph failed"));
}

export async function navigate(
  start: number,
  destinationId: number,
  navConditions: NavConditions,
): Promise<number[] | null> {
  const result = await navigateToDestination(start, destinationId, navConditions);
  return result?.path ?? null;
}

/** Navigate to whichever of `destinationIds` is closest by A* under navConditions. */
export async function navigateToClosestDestination(
  start: number,
  destinationIds: number[],
  navConditions: NavConditions,
): Promise<{ path: number[]; destinationId: number } | null> {
  if (destinationIds.length === 0) return null;
  if (destinationIds.length === 1) {
    const path = await navigate(start, destinationIds[0]!, navConditions);
    if (!path) return null;
    return { path, destinationId: destinationIds[0]! };
  }

  const graph = await getGraph();
  const startNode = graph.nodesOutside.get(start);
  if (!startNode) throw new Error("Start node not found");

  const nodeToDest = new Map<number, number>();
  const endNodes = new Set<number>();
  let sumLat = 0;
  let sumLng = 0;
  let nPos = 0;

  for (const destinationId of destinationIds) {
    const nodes = await db
      .execute(
        sql`SELECT node_outside_id AS id FROM destination_node WHERE destination_id = ${destinationId}`,
      )
      .then((res) => res.rows.map((row) => Number(row.id)));
    for (const id of nodes) {
      endNodes.add(id);
      nodeToDest.set(id, destinationId);
    }
    const pos = await db
      .execute(sql`SELECT lng,lat FROM destination WHERE id=${destinationId};`)
      .then((res) => res.rows[0] as { lng: number; lat: number } | undefined);
    if (pos) {
      sumLat += Number(pos.lat);
      sumLng += Number(pos.lng);
      nPos += 1;
    }
  }

  if (endNodes.size === 0 || nPos === 0) {
    throw new Error("Start or end node not found");
  }
  if (endNodes.has(startNode.id)) {
    return { path: [], destinationId: nodeToDest.get(startNode.id)! };
  }

  const destinationPos = { lat: sumLat / nPos, lng: sumLng / nPos };
  const astar = await aStar(
    graph,
    startNode.id,
    destinationPos,
    endNodes,
    navConditions,
  );
  if (!astar) return null;

  const path = reconstructEdgePath(graph, start, astar.endNodeId, astar.pathTree);
  const destinationId = nodeToDest.get(astar.endNodeId);
  if (destinationId == null) return null;
  return { path, destinationId };
}

async function navigateToDestination(
  start: number,
  destinationId: number,
  navConditions: NavConditions,
): Promise<{ path: number[]; endNodeId: number } | null> {
  const graph = await getGraph();
  const startNode = graph.nodesOutside.get(start);
  const endNodes = await db
    .execute(
      sql`SELECT node_outside_id AS id FROM destination_node WHERE destination_id = ${destinationId}`,
    )
    .then((res) => {
      return new Set(res.rows.map((row) => row.id as number));
    });
  const destinationPos = await db
    .execute(sql`SELECT lng,lat FROM destination WHERE id=${destinationId};`)
    .then((res) => res.rows[0] as { lng: number; lat: number } | undefined);

  if (!startNode || endNodes.size === 0 || !destinationPos) {
    throw new Error("Start or end node not found");
  }

  if (endNodes.has(startNode.id)) return { path: [], endNodeId: startNode.id };

  const astar = await aStar(
    graph,
    startNode.id,
    destinationPos,
    endNodes,
    navConditions,
  );

  if (!astar) {
    logReturnNull("pathTree is null (aStar found no path)");
    return null;
  }

  return {
    path: reconstructEdgePath(graph, start, astar.endNodeId, astar.pathTree),
    endNodeId: astar.endNodeId,
  };
}

function reconstructEdgePath(
  graph: Graph,
  start: number,
  endNodeId: number,
  pathTree: Map<number, number>,
): number[] {
  const path: number[] = [];
  let curP: number | null = endNodeId;
  while (curP !== start) {
    const nxt: number = pathTree.get(curP)!;
    const adjList = graph.adjOutside.get(nxt);
    const edgeId: number | undefined = adjList?.find(
      (cur) => cur.to === curP,
    )?.edgeId;
    if (edgeId != null) {
      path.push(edgeId);
    } else {
      path.push(encodeThroughBuildingHop(nxt, curP));
    }
    curP = nxt;
  }
  path.reverse();
  return path;
}

export type RouteMetrics = {
  distanceMeters: number;
  durationSeconds: number;
  legs: RouteLegMetrics[];
};

function pathDistanceMeters(
  graph: Graph,
  startNodeId: number,
  path: number[],
  navConditions: NavConditions,
): number {
  if (path.length === 0) return 0;

  let total = 0;
  let currentNodeId = startNodeId;

  for (const edgeId of path) {
    if (isThroughBuildingHop(edgeId)) {
      const nextId = nextNodeFromEdge(graph, currentNodeId, edgeId);
      if (nextId == null) continue;
      const fromNode = graph.nodesOutside.get(currentNodeId);
      const toNode = graph.nodesOutside.get(nextId);
      if (fromNode && toNode) {
        total += calcDistance(
          fromNode.lat,
          fromNode.lng,
          toNode.lat,
          toNode.lng,
        );
      }
      currentNodeId = nextId;
      continue;
    }

    const neighbors = graph.adjOutside.get(currentNodeId);
    const edge = neighbors?.find((n) => n.edgeId === edgeId);
    if (!edge) {
      currentNodeId =
        nextNodeFromEdge(graph, currentNodeId, edgeId) ?? currentNodeId;
      continue;
    }

    const nextId = edge.to;
    const fromNode = graph.nodesOutside.get(currentNodeId);
    const toNode = graph.nodesOutside.get(nextId);
    let segment = edge.distance;

    if (
      navConditions.is_pedestrian &&
      (fromNode?.is_stairs || toNode?.is_stairs)
    ) {
      segment *= STAIR_DISTANCE_FACTOR;
    }

    total += segment;
    currentNodeId = nextId;
  }

  const geometry = pathToRouteGeometry(graph, path, startNodeId);
  const geometryLength = lineStringLengthMeters(geometry.coordinates);
  return Math.max(total, geometryLength);
}

export function computePathMetrics(
  graph: Graph,
  startNodeId: number,
  path: number[],
  navConditions: NavConditions,
): RouteMetrics {
  const distanceMeters = pathDistanceMeters(
    graph,
    startNodeId,
    path,
    navConditions,
  );
  const durationSeconds = durationSecondsFromDistance(
    distanceMeters,
    navConditions,
  );
  return { distanceMeters, durationSeconds, legs: [] };
}

export async function computeRouteMetrics(
  startNodeId: number,
  destIds: number[],
  navConditions: NavConditions,
): Promise<RouteMetrics | null> {
  if (destIds.length === 0) {
    return { distanceMeters: 0, durationSeconds: 0, legs: [] };
  }

  const graph = await getGraph();

  if (destIds.length === 1) {
    const segment = await navigate(startNodeId, destIds[0]!, navConditions);
    if (!segment) return null;
    const metrics = computePathMetrics(
      graph,
      startNodeId,
      segment,
      navConditions,
    );
    return {
      ...metrics,
      legs: [
        {
          destinationId: destIds[0]!,
          distanceMeters: metrics.distanceMeters,
          durationSeconds: metrics.durationSeconds,
        },
      ],
    };
  }

  let currentStart = startNodeId;
  const legs: RouteLegMetrics[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (const destId of destIds) {
    const segment = await navigate(currentStart, destId, navConditions);
    if (!segment) return null;

    const legMetrics = computePathMetrics(
      graph,
      currentStart,
      segment,
      navConditions,
    );
    legs.push({
      destinationId: destId,
      distanceMeters: legMetrics.distanceMeters,
      durationSeconds: legMetrics.durationSeconds,
    });
    totalDistance += legMetrics.distanceMeters;
    totalDuration += legMetrics.durationSeconds;
    currentStart = endNodeFromPath(graph, currentStart, segment);
  }

  return {
    distanceMeters: totalDistance,
    durationSeconds: totalDuration,
    legs,
  };
}

export function pathToRouteGeometry(
  graph: Graph,
  path: number[],
  startNodeId: number,
) {
  return pathToRouteDrawModel(graph, path, startNodeId);
}

export async function navigateMulti(
  startOutdoorNodeId: number,
  destIds: number[],
  navConditions: NavConditions,
): Promise<number[] | null> {
  if (destIds.length === 0) return [];

  let currentStart = startOutdoorNodeId;
  const fullPath: number[] = [];

  for (const destId of destIds) {
    const segment = await navigate(currentStart, destId, navConditions);
    if (segment === null) return null;
    fullPath.push(...segment);
    const graph = await getGraph();
    currentStart = endNodeFromPath(graph, currentStart, segment);
  }

  return fullPath;
}

type AStarNode = { f: number; g: number; id: number };

async function aStar(
  graph: Graph,
  startNode: number,
  destinationPos: { lat: number; lng: number },
  endNodes: Set<number>,
  navConditions: NavConditions,
): Promise<{ pathTree: Map<number, number>; endNodeId: number } | null> {
  const pathTree = new Map<number, number>();
  const gScore = new Map<number, number>();
  gScore.set(startNode, 0);
  const openSet = new MinHeap<AStarNode>((a, b) => a.f - b.f);

  const startPos = graph.nodesOutside.get(startNode);
  if (!startPos) {
    logReturnNull("startPos not in graph.nodesOutside");
    return null;
  }

  const endPositions: Array<{ lat: number; lng: number }> = [];
  for (const id of endNodes) {
    const n = graph.nodesOutside.get(id);
    if (n) endPositions.push({ lat: n.lat, lng: n.lng });
  }
  if (endPositions.length === 0) {
    endPositions.push(destinationPos);
  }

  const hToEnds = (lat: number, lng: number) => {
    let best = Infinity;
    for (const p of endPositions) {
      const d = heuristic(lat, lng, p.lat, p.lng);
      if (d < best) best = d;
    }
    return best;
  };

  const h0 = hToEnds(startPos.lat, startPos.lng);
  openSet.add({ f: h0, g: 0, id: startNode });

  while (openSet.size() > 0) {
    const cur = openSet.remove();
    if (!cur) continue;
    const curNode = graph.nodesOutside.get(cur.id);
    if (!curNode) continue;
    if (endNodes.has(cur.id)) {
      return { pathTree, endNodeId: cur.id };
    }

    const neighbors = graph.adjOutside.get(cur.id) ?? [];

    for (const neighbor of neighbors) {
      const neighborNode = graph.nodesOutside.get(neighbor.to);
      if (!neighborNode) continue;
      if (neighborNode.is_dead) continue;

      let check = false;

      if (navConditions.is_vehicular && neighborNode.is_vehicular) {
        check = true;
      }
      if (navConditions.is_pedestrian && neighborNode.is_pedestrian) {
        if (
          (navConditions.is_avoid_stairs ? !neighborNode.is_stairs : true) &&
          (navConditions.is_incline_limit
            ? (neighborNode.incline ?? 0) <= navConditions.max_incline
            : true)
        ) {
          check = true;
        }
      }

      if (!check) continue;

      const gNew = cur.g + neighbor.distance;
      const bestG = gScore.get(neighbor.to);
      if (bestG !== undefined && gNew >= bestG) continue;

      pathTree.set(neighbor.to, cur.id);
      gScore.set(neighbor.to, gNew);
      const h = hToEnds(neighborNode.lat, neighborNode.lng);
      openSet.add({ f: gNew + h, g: gNew, id: neighbor.to });
    }

    if (
      navConditions.is_through_building &&
      navConditions.is_pedestrian &&
      graph.buildingEntranceNodeIds.has(cur.id) &&
      !curNode.is_dead
    ) {
      const possibleBuildingExits = through_building_bfs_with_cost(
        graph,
        cur.id,
        navConditions,
      );
      for (const { exitOutsideId, indoorCost } of possibleBuildingExits) {
        const exitNode = graph.nodesOutside.get(exitOutsideId);
        if (!exitNode) continue;

        const gNew = cur.g + indoorCost;
        const bestG = gScore.get(exitOutsideId);
        if (bestG !== undefined && gNew >= bestG) continue;

        pathTree.set(exitOutsideId, cur.id);
        gScore.set(exitOutsideId, gNew);
        const h = hToEnds(exitNode.lat, exitNode.lng);
        openSet.add({ f: gNew + h, g: gNew, id: exitOutsideId });
      }
    }
  }

  logReturnNull("aStar exhausted openSet without reaching any end node");
  return null;
}

function vehicularNav(base: NavConditions): NavConditions {
  return {
    ...base,
    is_pedestrian: false,
    is_vehicular: true,
    is_through_building: false,
  };
}

function pedestrianNav(base: NavConditions): NavConditions {
  return {
    ...base,
    is_pedestrian: true,
    is_vehicular: false,
  };
}

export type MixedModeRouteResult = {
  path: number[];
  legPaths: number[][];
  legs: RouteLegMetrics[];
  distanceMeters: number;
  durationSeconds: number;
  modeSegments: Array<{
    mode: "vehicular" | "pedestrian";
    coordinates: [number, number][];
  }>;
};

/**
 * Vehicular trip: drive to recommended parking (A* closest), then walk to buildings.
 * Multi-stop: stay pedestrian between buildings that share the active parking lot.
 */
export async function navigateVehicularWithParking(
  startOutdoorNodeId: number,
  stopDestIds: number[],
  baseNavConditions: NavConditions,
): Promise<MixedModeRouteResult | null> {
  if (stopDestIds.length === 0) {
    return {
      path: [],
      legPaths: [],
      legs: [],
      distanceMeters: 0,
      durationSeconds: 0,
      modeSegments: [],
    };
  }

  const meta = await db.execute(sql`
    SELECT id, is_parking_lot FROM destination
    WHERE id IN (${sql.join(
      stopDestIds.map((id) => sql`${id}`),
      sql`, `,
    )});
  `);
  const isParking = new Map<number, boolean>();
  for (const row of meta.rows as Array<{ id: number; is_parking_lot: boolean }>) {
    isParking.set(Number(row.id), Boolean(row.is_parking_lot));
  }

  const linkRows = await db.execute(sql`
    SELECT building_id, parking_lot_id FROM destination_parking_lot
    WHERE building_id IN (${sql.join(
      stopDestIds.map((id) => sql`${id}`),
      sql`, `,
    )});
  `);
  const recommended = new Map<number, number[]>();
  for (const row of linkRows.rows as Array<{
    building_id: number;
    parking_lot_id: number;
  }>) {
    const bid = Number(row.building_id);
    const list = recommended.get(bid) ?? [];
    list.push(Number(row.parking_lot_id));
    recommended.set(bid, list);
  }

  const graph = await getGraph();
  const driveNav = vehicularNav(baseNavConditions);
  const walkNav = pedestrianNav(baseNavConditions);

  const fullPath: number[] = [];
  const legPaths: number[][] = [];
  const legs: RouteLegMetrics[] = [];
  const modeSegments: MixedModeRouteResult["modeSegments"] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let currentStart = startOutdoorNodeId;
  let activeParkingIds = new Set<number>();

  const appendLeg = async (
    destId: number,
    mode: "vehicular" | "pedestrian",
    kind: "parking" | "building",
    path: number[],
  ) => {
    const nav = mode === "vehicular" ? driveNav : walkNav;
    const metrics = computePathMetrics(graph, currentStart, path, nav);
    legs.push({
      destinationId: destId,
      distanceMeters: metrics.distanceMeters,
      durationSeconds: metrics.durationSeconds,
      mode,
      kind,
    });
    totalDistance += metrics.distanceMeters;
    totalDuration += metrics.durationSeconds;
    const geom = pathToRouteGeometry(graph, path, currentStart);
    if (geom.coordinates.length >= 2) {
      modeSegments.push({ mode, coordinates: geom.coordinates });
    }
    legPaths.push(path);
    fullPath.push(...path);
    currentStart = endNodeFromPath(graph, currentStart, path);
  };

  const ensureVehicularStart = async () => {
    const node = graph.nodesOutside.get(currentStart);
    if (node?.is_vehicular) return;
    if (!node) return;
    const snapped = await closestNode(node.lat, node.lng, driveNav);
    if (snapped > 0) currentStart = snapped;
  };

  for (const stopId of stopDestIds) {
    if (isParking.get(stopId)) {
      await ensureVehicularStart();
      const path = await navigate(currentStart, stopId, driveNav);
      if (path == null) return null;
      await appendLeg(stopId, "vehicular", "parking", path);
      activeParkingIds = new Set([stopId]);
      continue;
    }

    const lots = recommended.get(stopId) ?? [];
    if (lots.length === 0) {
      await ensureVehicularStart();
      const path = await navigate(currentStart, stopId, driveNav);
      if (path == null) return null;
      await appendLeg(stopId, "vehicular", "building", path);
      activeParkingIds = new Set();
      continue;
    }

    const shared = lots.filter((id) => activeParkingIds.has(id));
    if (shared.length > 0) {
      const path = await navigate(currentStart, stopId, walkNav);
      if (path == null) return null;
      await appendLeg(stopId, "pedestrian", "building", path);
      activeParkingIds = new Set(shared);
      continue;
    }

    await ensureVehicularStart();
    const closest = await navigateToClosestDestination(
      currentStart,
      lots,
      driveNav,
    );
    if (!closest) return null;
    await appendLeg(closest.destinationId, "vehicular", "parking", closest.path);
    const walkPath = await navigate(currentStart, stopId, walkNav);
    if (walkPath == null) return null;
    await appendLeg(stopId, "pedestrian", "building", walkPath);
    activeParkingIds = new Set([closest.destinationId]);
  }

  return {
    path: fullPath,
    legPaths,
    legs,
    distanceMeters: totalDistance,
    durationSeconds: totalDuration,
    modeSegments,
  };
}
