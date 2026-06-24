import type { Graph } from "@/lib/navigation-graph";
import { nextNodeFromEdge } from "@/lib/navigation-graph";

export type OutdoorEdgeRun = {
  kind: "outdoor";
  edgeIds: number[];
  nodeIds: number[];
};

export type IndoorShortcut = {
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
