import { sql } from "drizzle-orm";
import { db } from "@/db/index";

import "server-only";
import {
  type NodeOutside,
  type EdgeOutside,
  type NodeInside,
  type EdgeInside,
} from "@/db/schema"; // adapt to your schema
import { MinHeap } from "./minHeap";

/** Closest outdoor node to a (lat, lng) point (for outdoor routing). */
export async function closestNode(lat: number, lng: number) {
  const result = await db.execute(
    sql<{
      id: number;
    }>`SELECT id FROM node_outside ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), id LIMIT 1`,
  );
  return result.rows[0]?.id ?? -1;
}

export function calcDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const R = 6371000; // Earth radius (m)
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function heuristic(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2));
}

///////////////////////////////// --  Graph -- ////////////////////////////////////////

export type Graph = {
  nodesInside: Map<number, NodeInside>;
  nodesOutside: Map<number, NodeOutside>;
  adjInside: Map<number, Array<{ to: number; edgeId: number }>>;
  adjOutside: Map<
    number,
    Array<{ to: number; distance: number; edgeId: number }>
  >;
  version: number; // for debugging / cache sanity
};

export function buildGraph(
  _node_inside: NodeInside[],
  _edge_inside: EdgeInside[],
  node_outside: NodeOutside[],
  edge_outside: EdgeOutside[],
  version = 1,
): Graph {
  const nodeMapInside = new Map<number, NodeInside>();
  for (const n of _node_inside) nodeMapInside.set(n.id, n);

  const nodeMapOutside = new Map<number, NodeOutside>();
  for (const n of node_outside) nodeMapOutside.set(n.id, n);

  const adjInside = new Map<number, Array<{ to: number; edgeId: number }>>();
  const adjOutside = new Map<
    number,
    Array<{ to: number; distance: number; edgeId: number }>
  >();
  const pushOutside = (
    from: number,
    to: number,
    distance: number,
    edgeId: number,
  ) => {
    const arr = adjOutside.get(from) ?? [];
    arr.push({ to, distance, edgeId });
    adjOutside.set(from, arr);
  };

  for (const e of edge_outside) {
    const from = e.nodeAId;
    const to = e.nodeBId;
    const distance = e.distance ?? 0;
    pushOutside(from, to, distance, e.id);
    if (e.biDirectional) pushOutside(to, from, distance, e.id);
  }

  const pushInside = (from: number, to: number, edgeId: number) => {
    const arr = adjInside.get(from) ?? [];
    arr.push({ to, edgeId });
    adjInside.set(from, arr);
  };

  for (const e of _edge_inside) {
    const from = e.nodeAId;
    const to = e.nodeBId;
    pushInside(from, to, e.id);
    if (e.biDirectional) pushInside(to, from, e.id);
  }

  return {
    nodesInside: nodeMapInside,
    nodesOutside: nodeMapOutside,
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
  // eslint-disable-next-line no-var
  var __graphStore: GraphStore | undefined;
}

const store: GraphStore = globalThis.__graphStore ?? {
  graph: null,
  loading: null,
};

if (process.env.NODE_ENV !== "production") globalThis.__graphStore = store;

// Load graph from DB only once (per process)
async function loadGraphFromDb(): Promise<Graph> {
  const [nodeInsideRes, nodeOutsideRes, edgeInsideRes, edgeOutsideRes] =
    await Promise.all([
      db.execute(sql<NodeInside>`SELECT * FROM node_inside`),
      db.execute(sql<NodeOutside>`SELECT * FROM node_outside`),
      db.execute(sql<EdgeInside>`SELECT * FROM edge_inside`),
      db.execute(sql<EdgeOutside>`SELECT * FROM edge_outside`),
    ]);

  const version = (store.graph?.version ?? 0) + 1;
  return buildGraph(
    nodeInsideRes.rows as NodeInside[],
    edgeInsideRes.rows as EdgeInside[],
    nodeOutsideRes.rows as NodeOutside[],
    edgeOutsideRes.rows as EdgeOutside[],
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
  navConditions: string[],
) {
  const graph = await getGraph();
  const startNode = graph.nodesOutside.get(start) as NodeOutside;
  const endNodes = await db
    .execute(
      sql`SELECT node_outside_id AS FROM destination_node WHERE destination_id = ${destinationId}`,
    )
    .then((res) => {
      return new Set(res.rows.map((row) => row.id as number));
    });
  const destniationPos = await db
    .execute(sql`SELECT lng,lat FROM destination WHERE id=${destinationId};`)
    .then((res) => res.rows[0] as { lng: number; lat: number });
  if (!startNode || !endNodes) {
    throw new Error("Start or end node not found");
  }
  const pathTree: Map<number, number> | null = await aStar(
    graph,
    startNode.id,
    destniationPos,
    endNodes,
    navConditions,
  );

  if (!pathTree) return null;
  let pathStart: null | number = null;
  for (const endnode of endNodes) {
    if (pathTree.has(endnode)) {
      pathStart = endnode;
      break;
    }
  }
  if (!pathStart) return null;
  const path: number[] = [];
  while (pathStart !== start) {
    path.push(pathStart);
    pathStart = pathTree.get(pathStart)!;
  }
  path.push(start);
  return path;
}

type AStarNode = { f: number; g: number; id: number };

async function aStar(
  graph: Graph,
  startNode: number,
  destinaitonPos: { lat: number; lng: number },
  endNodes: Set<number>,
  navConditions: string[],
) {
  const pathTree = new Map<number, number>();
  const gScore = new Map<number, number>();
  gScore.set(startNode, 0);
  const openSet = new MinHeap<AStarNode>((a, b) => a.f - b.f);

  const startPos = graph.nodesOutside.get(startNode);
  if (!startPos) return null;
  const h0 = heuristic(
    startPos.lat,
    startPos.lng,
    destinaitonPos.lat,
    destinaitonPos.lng,
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

      let check = true;
      for (const condition of navConditions) {
        const key = condition as keyof NodeOutside;
        if (key in neighborNode) {
          check = Boolean(neighborNode[key]) && check;
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
        destinaitonPos.lat,
        destinaitonPos.lng,
      );
      openSet.add({ f: gNew + h, g: gNew, id: neighbor.to });
    }
  }

  return null;
}
