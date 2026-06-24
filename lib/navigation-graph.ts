import type {
  DestinationNode,
  EdgeInside,
  EdgeOutside,
  NodeInside,
  NodeOutside,
} from "@/db/schema";

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
  adjInside: Map<
    number,
    Array<{ to: number; edgeId: number; distance: number }>
  >;
  adjOutside: Map<
    number,
    Array<{ to: number; distance: number; edgeId: number; incline: number }>
  >;
  /** destination_id -> one representative node_outside_id (for reference) */
  buildingNodeOutside: Map<number, number>;
  /** Outdoor node IDs with at least one live indoor door marked is_entry. Triggers through-building. */
  buildingEntranceNodeIds: Set<number>;
  version: number;
};

export function buildGraph(
  _node_inside: NodeInside[],
  _edge_inside: EdgeInside[],
  node_outside: NodeOutside[],
  edge_outside: EdgeOutside[],
  destinationNodeOutside: DestinationNode[],
  version = 1,
): Graph {
  const nodeMapInside = new Map<number, NodeInside>();
  for (const n of _node_inside) nodeMapInside.set(n.id, n);

  const nodeMapOutside = new Map<number, NodeOutside>();
  for (const n of node_outside) nodeMapOutside.set(n.id, n);

  const adjInside = new Map<
    number,
    Array<{ to: number; edgeId: number; distance: number }>
  >();
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
    arr.push({ to, edgeId, distance: 1 });
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
  for (const cur of destinationNodeOutside) {
    buildingNodeOutside.set(cur.destination_id, cur.node_outside_id);
  }
  for (const n of _node_inside) {
    if (n.node_outside_id != null && n.is_entry && !n.is_dead) {
      buildingEntranceNodeIds.add(n.node_outside_id);
    }
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

export function nextNodeFromEdge(
  graph: Graph,
  currentNodeId: number,
  edgeId: number,
): number | null {
  const forward = graph.adjOutside.get(currentNodeId);
  const fwd = forward?.find((e) => e.edgeId === edgeId);
  if (fwd) return fwd.to;

  for (const [nodeId, neighbors] of graph.adjOutside) {
    const rev = neighbors.find(
      (e) => e.edgeId === edgeId && e.to === currentNodeId,
    );
    if (rev) return nodeId;
  }
  return null;
}

export function endNodeFromPath(
  graph: Graph,
  startNodeId: number,
  path: number[],
): number {
  let current = startNodeId;
  for (const edgeId of path) {
    const next = nextNodeFromEdge(graph, current, edgeId);
    if (next == null) break;
    current = next;
  }
  return current;
}

function through_building_bfs(
  graph: Graph,
  buildingEntranceOutside: number,
  nav: NavConditions,
): {
  exits: Map<number, number>;
  parent: Map<number, number>;
  exitInsideNode: Map<number, number>;
} {
  const entryStarts: NodeInside[] = [];
  for (const [, node] of graph.nodesInside) {
    if (
      node.node_outside_id === buildingEntranceOutside &&
      node.is_entry &&
      !node.is_dead
    ) {
      entryStarts.push(node);
    }
  }
  if (entryStarts.length === 0) {
    return {
      exits: new Map(),
      parent: new Map(),
      exitInsideNode: new Map(),
    };
  }

  const exits = new Map<number, number>();
  const parent = new Map<number, number>();
  const exitInsideNode = new Map<number, number>();

  const queue: number[] = [];
  const costSoFar = new Map<number, number>();
  for (const start of entryStarts) {
    if (!costSoFar.has(start.id)) {
      costSoFar.set(start.id, 0);
      parent.set(start.id, -1);
      queue.push(start.id);
    }
  }
  let head = 0;

  const allowed = (n: NodeInside) =>
    !n.is_dead &&
    (nav.is_avoid_stairs ? !n.is_stairs : true) &&
    (nav.is_incline_limit ? (n.incline ?? 0) <= nav.max_incline : true);

  while (head < queue.length) {
    const nodeId = queue[head++];
    const curCost = costSoFar.get(nodeId) ?? 0;

    const neighbors = graph.adjInside.get(nodeId);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      const nextId = edge.to;
      const nextCost = curCost + edge.distance;
      const prev = costSoFar.get(nextId);
      if (prev !== undefined && nextCost > prev) continue;

      const nextNode = graph.nodesInside.get(nextId);
      if (!nextNode) continue;
      if (!allowed(nextNode)) continue;

      costSoFar.set(nextId, nextCost);
      parent.set(nextId, nodeId);
      queue.push(nextId);

      if (
        nextNode.is_exit &&
        !nextNode.is_dead &&
        nextNode.node_outside_id != null &&
        nextNode.node_outside_id !== buildingEntranceOutside
      ) {
        const outsideExit = graph.nodesOutside.get(nextNode.node_outside_id);
        if (!outsideExit || outsideExit.is_dead) continue;
        const existing = exits.get(nextNode.node_outside_id);
        if (existing === undefined || nextCost < existing) {
          exits.set(nextNode.node_outside_id, nextCost);
          exitInsideNode.set(nextNode.node_outside_id, nextId);
        } else if (
          existing === nextCost &&
          nextId < (exitInsideNode.get(nextNode.node_outside_id) ?? Infinity)
        ) {
          exitInsideNode.set(nextNode.node_outside_id, nextId);
        }
      }
    }
  }

  return { exits, parent, exitInsideNode };
}

export function through_building_bfs_with_cost(
  graph: Graph,
  buildingEntranceOutside: number,
  nav: NavConditions,
): Array<{ exitOutsideId: number; indoorCost: number }> {
  const { exits } = through_building_bfs(graph, buildingEntranceOutside, nav);
  return [...exits.entries()].map(([exitOutsideId, indoorCost]) => ({
    exitOutsideId,
    indoorCost,
  }));
}

/** Reconstruct indoor node ids from entrance outdoor node to exit outdoor node. */
export function reconstructIndoorPath(
  graph: Graph,
  entranceOutdoorId: number,
  exitOutdoorId: number,
  nav: NavConditions,
): number[] | null {
  const { exits, parent, exitInsideNode } = through_building_bfs(
    graph,
    entranceOutdoorId,
    nav,
  );
  if (!exits.has(exitOutdoorId)) return null;

  const endInside = exitInsideNode.get(exitOutdoorId);
  if (endInside == null) return null;

  const path: number[] = [];
  let cur: number | null = endInside;
  while (cur != null && cur !== -1) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
    if (cur === -1) break;
  }
  path.reverse();
  return path.length > 0 ? path : null;
}
