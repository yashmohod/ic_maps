import type { Graph } from "@/lib/navigation-graph";
import { isThroughBuildingHop, nextNodeFromEdge } from "@/lib/navigation-graph";

type OutdoorEdgeRun = {
  kind: "outdoor";
  edgeIds: number[];
  nodeIds: number[];
};

type IndoorShortcut = {
  kind: "indoor";
  entranceOutdoorId: number;
  exitOutdoorId: number;
};

export type RouteSegment = OutdoorEdgeRun | IndoorShortcut;

/** Endpoints of an outdoor edge (either direction). */
export function nodePairForEdge(
  graph: Graph,
  edgeId: number,
): [number, number] | null {
  for (const [from, neighbors] of graph.adjOutside) {
    for (const n of neighbors) {
      if (n.edgeId === edgeId) return [from, n.to];
    }
  }
  return null;
}

export function hasOutdoorEdge(
  graph: Graph,
  fromId: number,
  toId: number,
): boolean {
  const neighbors = graph.adjOutside.get(fromId);
  return neighbors?.some((n) => n.to === toId) ?? false;
}

/** Ordered outdoor node ids along an edge-id path (start node included). */
export function edgePathToNodeIds(
  graph: Graph,
  startNodeId: number,
  edgePath: number[],
): number[] {
  const nodes = [startNodeId];
  let current = startNodeId;
  for (const edgeId of edgePath) {
    const next = nextNodeFromEdge(graph, current, edgeId);
    if (next != null) {
      nodes.push(next);
      current = next;
      continue;
    }
    const pair = nodePairForEdge(graph, edgeId);
    if (!pair) continue;
    const [a, b] = pair;
    const attach = a === current ? b : b === current ? a : a;
    if (attach !== current) {
      nodes.push(attach);
      current = attach;
    }
    const after = nextNodeFromEdge(graph, current, edgeId);
    if (after != null && after !== current) {
      nodes.push(after);
      current = after;
    }
  }
  return nodes;
}

/**
 * Split an edge path into outdoor runs and indoor shortcuts (entrance → exit with no outdoor edge).
 */
export function edgePathToSegments(
  graph: Graph,
  startNodeId: number,
  edgePath: number[],
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let current = startNodeId;
  let runNodes = [current];
  let runEdges: number[] = [];

  const flushOutdoor = () => {
    if (runNodes.length >= 2 || runEdges.length > 0) {
      segments.push({
        kind: "outdoor",
        edgeIds: [...runEdges],
        nodeIds: [...runNodes],
      });
    }
    runNodes = [current];
    runEdges = [];
  };

  for (const edgeId of edgePath) {
    if (isThroughBuildingHop(edgeId)) {
      const hopTo = nextNodeFromEdge(graph, current, edgeId);
      if (hopTo == null) continue;
      flushOutdoor();
      segments.push({
        kind: "indoor",
        entranceOutdoorId: current,
        exitOutdoorId: hopTo,
      });
      current = hopTo;
      runNodes = [current];
      runEdges = [];
      continue;
    }

    const next = nextNodeFromEdge(graph, current, edgeId);
    if (next != null) {
      runEdges.push(edgeId);
      runNodes.push(next);
      current = next;
      continue;
    }

    const pair = nodePairForEdge(graph, edgeId);
    if (!pair) continue;

    const [a, b] = pair;
    let exitNode: number;
    if (a === current) {
      exitNode = b;
    } else if (b === current) {
      exitNode = a;
    } else {
      flushOutdoor();
      const entranceOutdoorId = current;
      exitNode = a;
      segments.push({
        kind: "indoor",
        entranceOutdoorId,
        exitOutdoorId: exitNode,
      });
      current = exitNode;
      runNodes = [current];
      runEdges = [edgeId];
      const after = nextNodeFromEdge(graph, current, edgeId);
      if (after != null && after !== current) {
        runNodes.push(after);
        current = after;
      }
      continue;
    }

    if (!hasOutdoorEdge(graph, current, exitNode)) {
      flushOutdoor();
      segments.push({
        kind: "indoor",
        entranceOutdoorId: current,
        exitOutdoorId: exitNode,
      });
      current = exitNode;
      runNodes = [current];
    }

    runEdges.push(edgeId);
    if (runNodes[runNodes.length - 1] !== exitNode) {
      runNodes.push(exitNode);
    }
    current = exitNode;
  }

  flushOutdoor();
  return segments;
}

function dedupeCoords(coords: [number, number][]): [number, number][] {
  if (coords.length <= 1) return coords;
  const out: [number, number][] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = coords[i]!;
    if (prev[0] !== cur[0] || prev[1] !== cur[1]) out.push(cur);
  }
  return out;
}

export type ThroughBuildingPortal = {
  entry: [number, number];
  exit: [number, number];
};

/** Outdoor draw segments + portal nodes; continuous coords keep GPS on-route through buildings. */
export type RouteDrawModel = {
  type: "LineString";
  coordinates: [number, number][];
  outdoorSegments: [number, number][][];
  portals: ThroughBuildingPortal[];
};

export function pathToRouteDrawModel(
  graph: Graph,
  edgePath: number[],
  startNodeId: number,
): RouteDrawModel {
  const continuous: [number, number][] = [];
  const outdoorSegments: [number, number][][] = [];
  const portals: ThroughBuildingPortal[] = [];
  let run: [number, number][] = [];

  const appendRun = (lng: number, lat: number) => {
    const last = run[run.length - 1];
    if (!last || last[0] !== lng || last[1] !== lat) run.push([lng, lat]);
  };

  const flushRun = () => {
    if (run.length >= 2) outdoorSegments.push(run);
    run = [];
  };

  const startNode = graph.nodesOutside.get(startNodeId);
  if (startNode) {
    continuous.push([startNode.lng, startNode.lat]);
    appendRun(startNode.lng, startNode.lat);
  }

  let currentNodeId = startNodeId;
  for (const edgeId of edgePath) {
    const nextId = nextNodeFromEdge(graph, currentNodeId, edgeId);
    if (nextId == null) continue;
    const nextNode = graph.nodesOutside.get(nextId);
    if (!nextNode) {
      currentNodeId = nextId;
      continue;
    }

    if (isThroughBuildingHop(edgeId)) {
      const entryNode = graph.nodesOutside.get(currentNodeId);
      flushRun();
      if (entryNode) {
        portals.push({
          entry: [entryNode.lng, entryNode.lat],
          exit: [nextNode.lng, nextNode.lat],
        });
      }
      continuous.push([nextNode.lng, nextNode.lat]);
      run = [[nextNode.lng, nextNode.lat]];
      currentNodeId = nextId;
      continue;
    }

    continuous.push([nextNode.lng, nextNode.lat]);
    appendRun(nextNode.lng, nextNode.lat);
    currentNodeId = nextId;
  }
  flushRun();

  return {
    type: "LineString",
    coordinates: dedupeCoords(continuous),
    outdoorSegments,
    portals,
  };
}
