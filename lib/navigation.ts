import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { calcDistance, heuristic } from "./utils";

import "server-only";
import {
  type NodeOutside,
  type EdgeOutside,
  type NodeInside,
  type EdgeInside,
  navMode,
  DestinationNode,
} from "@/db/schema"; // adapt to your schema
import { MinHeap } from "./minHeap";

const FILE = "navigation.ts";
function logReturnNull(reason: string): void {
  const match = new Error().stack?.split("\n")[2]?.match(/:(\d+):/);
  const line = match?.[1] ?? "?";
  console.log(`[${FILE}:${line}] returning null: ${reason}`);
}

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
export type NavConditions = {
  is_pedestrian: boolean;
  is_vehicular: boolean;
  is_avoid_stairs: boolean;
  is_incline_limit: boolean;
  is_through_building: boolean;
  max_incline: number;
};

export type Graph = {
  nodesInside: Map<number, NodeInside>;
  nodesOutside: Map<number, NodeOutside>;
  adjInside: Map<number, Array<{ to: number; edgeId: number }>>;
  adjOutside: Map<
    number,
    Array<{ to: number; distance: number; edgeId: number; incline: number }>
  >;
  /** destination_id -> one representative node_outside_id (for reference) */
  buildingNodeOutside: Map<number, number>;
  /** Outdoor node IDs that are building entrances (in destination_node). Used to trigger through-building. */
  buildingEntranceNodeIds: Set<number>;
  version: number; // for debugging / cache sanity
};

export function buildGraph(
  _node_inside: NodeInside[],
  _edge_inside: EdgeInside[],
  node_outside: NodeOutside[],
  edge_outside: EdgeOutside[],
  desinationNodeOutside: DestinationNode[],
  version = 1,
): Graph {
  const nodeMapInside = new Map<number, NodeInside>();
  for (const n of _node_inside) nodeMapInside.set(n.id, n);

  const nodeMapOutside = new Map<number, NodeOutside>();
  for (const n of node_outside) nodeMapOutside.set(n.id, n);

  const adjInside = new Map<number, Array<{ to: number; edgeId: number }>>();
  const adjOutside = new Map<
    number,
    Array<{ to: number; distance: number; edgeId: number; incline: number }>
  >();
  const pushOutside = (
    from: number,
    to: number,
    distance: number,
    edgeId: number,
    incline: number,
  ) => {
    const arr = adjOutside.get(from) ?? [];
    arr.push({ to, distance, edgeId, incline });
    adjOutside.set(from, arr);
  };

  for (const e of edge_outside) {
    const from = e.node_a_id;
    const to = e.node_b_id;
    const distance = e.distance ?? 0;
    pushOutside(from, to, distance, e.id, e.incline);
    if (e.bi_directional) pushOutside(to, from, distance, e.id, e.incline);
  }

  const pushInside = (from: number, to: number, edgeId: number) => {
    const arr = adjInside.get(from) ?? [];
    arr.push({ to, edgeId });
    adjInside.set(from, arr);
  };

  for (const e of _edge_inside) {
    const from = e.node_a_id;
    const to = e.node_b_id;
    pushInside(from, to, e.id);
    if (e.bi_directional) pushInside(to, from, e.id);
  }

  const buildingNodeOutside = new Map<number, number>();
  const buildingEntranceNodeIds = new Set<number>();
  for (const cur of desinationNodeOutside) {
    buildingNodeOutside.set(cur.destination_id, cur.node_outside_id);
    buildingEntranceNodeIds.add(cur.node_outside_id);
  }
  return {
    nodesInside: nodeMapInside,
    nodesOutside: nodeMapOutside,
    buildingNodeOutside,
    buildingEntranceNodeIds,
    adjInside,
    adjOutside,
    version,
  };
}

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
  const startNode = graph.nodesOutside.get(start) as NodeOutside;
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
  console.log(navConditions);

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
  console.log(startPos);
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
    console.log(
      navConditions.is_through_building &&
        navConditions.is_pedestrian &&
        graph.buildingEntranceNodeIds.has(cur.id),
    );

    if (
      navConditions.is_through_building &&
      navConditions.is_pedestrian &&
      graph.buildingEntranceNodeIds.has(cur.id)
    ) {
      const possibleBuildingExits = through_building_simple_bfs(
        graph,
        cur.id,
        navConditions,
      );
      if (!possibleBuildingExits) continue;
      for (const exit of possibleBuildingExits) {
        const exitNode = graph.nodesOutside.get(exit);
        if (!exitNode) continue;

        const gNew =
          cur.g +
          calcDistance(curNode.lat, curNode.lng, exitNode.lat, exitNode.lng);
        const bestG = gScore.get(exit);
        if (bestG !== undefined && gNew >= bestG) continue;

        pathTree.set(exit, cur.id);
        gScore.set(exit, gNew);
        const h = heuristic(
          exitNode.lat,
          exitNode.lng,
          destinationPos.lat,
          destinationPos.lng,
        );
        openSet.add({ f: gNew + h, g: gNew, id: exit });
      }
    }
  }

  logReturnNull("aStar exhausted openSet without reaching any end node");
  return null;
}

function through_building_simple_bfs(
  graph: Graph,
  buildingEntranceOutside: number,
  nav: NavConditions,
): number[] {
  let start: any | undefined;
  for (const [, node] of graph.nodesInside) {
    if (node.node_outside_id === buildingEntranceOutside) {
      start = node;
      break;
    }
  }
  if (!start) return [];

  const exits = new Set<number>();

  const queue: number[] = [start.id];
  let head = 0;

  // Here "visited" means "seen (maybe rejected)"
  const visited = new Set<number>([start.id]);
  const allowed = (n: any) =>
    (nav.is_avoid_stairs ? !n.is_stairs : true) &&
    (nav.is_incline_limit ? n.incline <= nav.max_incline : true);

  while (head < queue.length) {
    const nodeId = queue[head++];

    const neighbors = graph.adjInside.get(nodeId);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      const nextId = edge.to;
      if (visited.has(nextId)) continue;

      const nextNode = graph.nodesInside.get(nextId);
      if (!nextNode) continue;

      visited.add(nextId); // early mark is OK under node-only constraints

      if (!allowed(nextNode)) continue;

      if (nextNode.is_exit && nextNode.node_outside_id != null) {
        if (nextNode.node_outside_id !== buildingEntranceOutside) {
          exits.add(nextNode.node_outside_id);
        }
      }

      queue.push(nextId);
    }
  }
  console.log("exits:", exits);
  return [...exits];
}
