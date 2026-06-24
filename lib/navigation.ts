import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { calcDistance, heuristic } from "./utils";
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
  type Graph,
  type NavConditions,
} from "@/lib/navigation-graph";

export type { Graph, NavConditions } from "@/lib/navigation-graph";
export {
  buildGraph,
  endNodeFromPath,
  nextNodeFromEdge,
  reconstructIndoorPath,
} from "@/lib/navigation-graph";

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
        WHERE (${is_pedestrian} AND is_pedestrian = true) OR (${is_vehicular} AND is_vehicular = true)
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
};

declare global {
  var __graphStore: GraphStore | undefined;
}

const store: GraphStore = globalThis.__graphStore ?? {
  graph: null,
  loading: null,
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
    store.loading = loadGraphFromDb()
      .then((g) => {
        store.graph = g;
        store.loading = null;
        return g;
      })
      .catch((e) => {
        store.loading = null;
        throw e;
      });
  }

  return store.loading;
}

/**
 * Mutate by REBUILDING (safe + easy).
 * You can do incremental updates too, but rebuild keeps correctness simple.
 */
export async function reloadGraph(): Promise<Graph> {
  const g = await loadGraphFromDb();
  store.graph = g;
  store.loading = null;
  return g;
}

export async function navigate(
  start: number,
  destinationId: number,
  navConditions: NavConditions,
): Promise<number[] | null> {
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

  if (endNodes.has(startNode.id)) return [];

  const pathTree: Map<number, number> | null | undefined = await aStar(
    graph,
    startNode.id,
    destinationPos,
    endNodes,
    navConditions,
  );

  if (!pathTree) {
    logReturnNull("pathTree is null (aStar found no path)");
    return null;
  }
  let curP: null | number = null;
  for (const endnode of endNodes) {
    if (pathTree.has(endnode)) {
      curP = endnode;
      break;
    }
  }
  if (curP === null) {
    logReturnNull("curP is null (no end node in pathTree)");
    return null;
  }
  const path: number[] = [];
  while (curP !== start) {
    const nxt: number = pathTree.get(curP)!;
    const adjList = graph.adjOutside.get(nxt);
    const edgeId: number | undefined = adjList?.find(
      (cur) => cur.to === curP,
    )?.edgeId;
    if (edgeId != null) {
      path.push(edgeId);
    }
    curP = nxt;
  }
  path.reverse();
  return path;
}

function dedupeCoords(coords: [number, number][]): [number, number][] {
  if (coords.length <= 1) return coords;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = out[out.length - 1];
    const cur = coords[i];
    if (prev[0] !== cur[0] || prev[1] !== cur[1]) out.push(cur);
  }
  return out;
}

export type RouteLegMetrics = {
  destinationId: number;
  distanceMeters: number;
  durationSeconds: number;
};

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
  const usePedestrianFinalLeg =
    navConditions.is_vehicular && destIds.length > 1;

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

  for (let i = 0; i < destIds.length; i++) {
    const destId = destIds[i]!;
    const legNav =
      usePedestrianFinalLeg && i === destIds.length - 1
        ? pedestrianNavConditions(navConditions)
        : navConditions;

    const segment = await navigate(currentStart, destId, legNav);
    if (!segment) return null;

    const legMetrics = computePathMetrics(graph, currentStart, segment, legNav);
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
): { type: "LineString"; coordinates: [number, number][] } {
  const coords: [number, number][] = [];
  const startNode = graph.nodesOutside.get(startNodeId);
  if (startNode) coords.push([startNode.lng, startNode.lat]);

  let currentNodeId = startNodeId;
  for (const edgeId of path) {
    const nextId = nextNodeFromEdge(graph, currentNodeId, edgeId);
    if (nextId == null) continue;
    const nextNode = graph.nodesOutside.get(nextId);
    if (nextNode) coords.push([nextNode.lng, nextNode.lat]);
    currentNodeId = nextId;
  }

  return { type: "LineString", coordinates: dedupeCoords(coords) };
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

/** Vehicular legs for all but the last destination; final leg uses pedestrian routing. */
export function pedestrianNavConditions(base: NavConditions): NavConditions {
  return {
    ...base,
    is_pedestrian: true,
    is_vehicular: false,
    is_through_building: true,
  };
}

export async function navigateMultiWithPedestrianFinalLeg(
  startOutdoorNodeId: number,
  destIds: number[],
  vehicularConditions: NavConditions,
): Promise<number[] | null> {
  if (destIds.length === 0) return [];
  if (destIds.length === 1) {
    return navigate(startOutdoorNodeId, destIds[0]!, vehicularConditions);
  }

  const vehicularLegDests = destIds.slice(0, -1);
  const finalDestId = destIds[destIds.length - 1]!;

  let currentStart = startOutdoorNodeId;
  const fullPath: number[] = [];

  const vehPath = await navigateMulti(
    currentStart,
    vehicularLegDests,
    vehicularConditions,
  );
  if (vehPath === null) return null;
  fullPath.push(...vehPath);

  const graph = await getGraph();
  currentStart = endNodeFromPath(graph, currentStart, vehPath);

  const pedPath = await navigate(
    currentStart,
    finalDestId,
    pedestrianNavConditions(vehicularConditions),
  );
  if (pedPath === null) return null;
  fullPath.push(...pedPath);

  return fullPath;
}

type AStarNode = { f: number; g: number; id: number };

async function aStar(
  graph: Graph,
  startNode: number,
  destinationPos: { lat: number; lng: number },
  endNodes: Set<number>,
  navConditions: NavConditions,
) {
  const pathTree = new Map<number, number>();
  const gScore = new Map<number, number>();
  gScore.set(startNode, 0);
  const openSet = new MinHeap<AStarNode>((a, b) => a.f - b.f);

  const startPos = graph.nodesOutside.get(startNode);
  if (!startPos) {
    logReturnNull("startPos not in graph.nodesOutside");
    return null;
  }
  const h0 = heuristic(
    startPos.lat,
    startPos.lng,
    destinationPos.lat,
    destinationPos.lng,
  );
  openSet.add({ f: h0, g: 0, id: startNode });

  while (openSet.size() > 0) {
    const cur = openSet.remove();
    if (!cur) continue;
    const curNode = graph.nodesOutside.get(cur.id);
    if (!curNode) continue;
    if (endNodes.has(cur.id)) {
      return pathTree;
    }

    const neighbors = graph.adjOutside.get(cur.id);
    if (!neighbors) continue;

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
            ? neighbor.incline <= navConditions.max_incline
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
      const h = heuristic(
        neighborNode.lat,
        neighborNode.lng,
        destinationPos.lat,
        destinationPos.lng,
      );
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
      if (!possibleBuildingExits) continue;
      for (const { exitOutsideId, indoorCost } of possibleBuildingExits) {
        const exitNode = graph.nodesOutside.get(exitOutsideId);
        if (!exitNode) continue;

        const gNew = cur.g + indoorCost;
        const bestG = gScore.get(exitOutsideId);
        if (bestG !== undefined && gNew >= bestG) continue;

        pathTree.set(exitOutsideId, cur.id);
        gScore.set(exitOutsideId, gNew);
        const h = heuristic(
          exitNode.lat,
          exitNode.lng,
          destinationPos.lat,
          destinationPos.lng,
        );
        openSet.add({ f: gNew + h, g: gNew, id: exitOutsideId });
      }
    }
  }

  logReturnNull("aStar exhausted openSet without reaching any end node");
  return null;
}
