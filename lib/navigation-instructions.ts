import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { calcDistance } from "@/lib/utils";
import type { Graph, NavConditions } from "@/lib/navigation-graph";
import {
  endNodeFromPath,
  nextNodeFromEdge,
  reconstructIndoorPath,
} from "@/lib/navigation-graph";
import {
  edgePathToSegments,
  type RouteSegment,
} from "@/lib/navigation-route-model";
import {
  graphInsideNodesMap,
  indoorInstructionForNode,
  shouldIncludeIndoorNode,
} from "@/lib/navigation-indoor-labels";
import type {
  NavStep,
  OutdoorManeuver,
  OutdoorNavStep,
} from "@/lib/navigation-types";
import {
  classifyTurnDegrees,
  mergeContinueSteps,
  turnDegreesAtNode,
} from "@/lib/navigation-turn";

export function maneuverPhrase(maneuver: OutdoorManeuver): string {
  switch (maneuver) {
    case "depart":
      return "Head toward the route";
    case "continue":
      return "Continue straight";
    case "turn-left":
      return "Turn left";
    case "turn-right":
      return "Turn right";
    case "sharp-left":
      return "Turn sharp left";
    case "sharp-right":
      return "Turn sharp right";
    case "uturn":
      return "Make a U-turn";
    case "arrive":
      return "Arrive at destination";
    default:
      return "Continue";
  }
}

type RawOutdoorStep = {
  maneuver: OutdoorManeuver;
  coordinate: [number, number];
  nodeId: number;
  distanceMeters: number;
};

function buildOutdoorStepsForRun(
  graph: Graph,
  nodeIds: number[],
  edgeIds: number[],
): RawOutdoorStep[] {
  if (nodeIds.length < 2) return [];

  const steps: RawOutdoorStep[] = [];
  const first = graph.nodesOutside.get(nodeIds[0]!);
  if (!first) return [];

  steps.push({
    maneuver: "depart",
    coordinate: [first.lng, first.lat],
    nodeId: first.id,
    distanceMeters: 0,
  });

  for (let i = 1; i < nodeIds.length - 1; i++) {
    const a = graph.nodesOutside.get(nodeIds[i - 1]!);
    const b = graph.nodesOutside.get(nodeIds[i]!);
    const c = graph.nodesOutside.get(nodeIds[i + 1]!);
    if (!a || !b || !c) continue;

    const turn = turnDegreesAtNode(a.lng, a.lat, b.lng, b.lat, c.lng, c.lat);
    const maneuver = classifyTurnDegrees(turn);
    if (maneuver === "continue") continue;

    let dist = 0;
    if (i - 1 >= 0) {
      const prev = graph.nodesOutside.get(nodeIds[i - 1]!);
      if (prev) dist += calcDistance(prev.lat, prev.lng, b.lat, b.lng);
    }

    steps.push({
      maneuver,
      coordinate: [b.lng, b.lat],
      nodeId: b.id,
      distanceMeters: dist,
    });
  }

  const last = graph.nodesOutside.get(nodeIds[nodeIds.length - 1]!);
  if (last) {
    const prev = graph.nodesOutside.get(nodeIds[nodeIds.length - 2]!);
    const dist = prev
      ? calcDistance(prev.lat, prev.lng, last.lat, last.lng)
      : 0;
    steps.push({
      maneuver: "arrive",
      coordinate: [last.lng, last.lat],
      nodeId: last.id,
      distanceMeters: dist,
    });
  }

  return assignLegDistances(graph, nodeIds, edgeIds, steps);
}

function assignLegDistances(
  graph: Graph,
  nodeIds: number[],
  edgeIds: number[],
  steps: RawOutdoorStep[],
): RawOutdoorStep[] {
  if (steps.length === 0) return steps;

  const edgeLengths: number[] = [];
  let current = nodeIds[0]!;
  for (const edgeId of edgeIds) {
    const next = nextNodeFromEdge(graph, current, edgeId);
    if (next == null) continue;
    const from = graph.nodesOutside.get(current);
    const to = graph.nodesOutside.get(next);
    if (from && to) {
      edgeLengths.push(calcDistance(from.lat, from.lng, to.lat, to.lng));
    }
    current = next;
  }

  const totalPathMeters = edgeLengths.reduce((a, b) => a + b, 0);
  const result = steps.map((s, idx) => {
    if (idx === steps.length - 1) {
      return { ...s, distanceMeters: 0 };
    }
    const next = steps[idx + 1]!;
    const fromNode = graph.nodesOutside.get(s.nodeId);
    const toNode = graph.nodesOutside.get(next.nodeId);
    const dist =
      fromNode && toNode
        ? calcDistance(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng)
        : totalPathMeters / Math.max(1, steps.length - 1);
    return { ...s, distanceMeters: Math.max(0, dist) };
  });

  return mergeContinueSteps(result);
}

function rawToNavSteps(steps: RawOutdoorStep[]): OutdoorNavStep[] {
  return steps.map((s, idx) => ({
    kind: "outdoor" as const,
    maneuver: s.maneuver,
    instruction:
      s.maneuver === "arrive"
        ? maneuverPhrase("arrive")
        : maneuverPhrase(s.maneuver),
    distanceMeters: idx < steps.length - 1 ? s.distanceMeters : 0,
    coordinate: s.coordinate,
    nodeId: s.nodeId,
  }));
}

function indoorStepsForShortcut(
  graph: Graph,
  entranceOutdoorId: number,
  exitOutdoorId: number,
  nav: NavConditions,
  destinationNames: Map<number, string>,
): NavStep[] {
  const insidePath = reconstructIndoorPath(
    graph,
    entranceOutdoorId,
    exitOutdoorId,
    nav,
  );
  if (!insidePath?.length) return [];

  const allInside = graphInsideNodesMap(graph);
  const steps: NavStep[] = [];
  let prevInstruction: string | null = null;

  for (const insideId of insidePath) {
    const node = graph.nodesInside.get(insideId);
    if (!node) continue;
    const buildingName =
      destinationNames.get(node.destination_id) ?? "Building";
    if (
      !shouldIncludeIndoorNode(node, allInside, buildingName, prevInstruction)
    ) {
      continue;
    }
    const instruction = indoorInstructionForNode(node, allInside, buildingName);
    prevInstruction = instruction;
    steps.push({
      kind: "indoor",
      instruction,
      buildingName,
      destinationId: node.destination_id,
      exitOutdoorNodeId:
        node.is_exit && node.node_outside_id != null
          ? node.node_outside_id
          : undefined,
    });
  }

  if (steps.length > 0) {
    const last = steps[steps.length - 1]!;
    if (last.kind === "indoor" && !last.exitOutdoorNodeId) {
      last.exitOutdoorNodeId = exitOutdoorId;
    }
  }

  return steps;
}

function segmentsToSteps(
  graph: Graph,
  segments: RouteSegment[],
  nav: NavConditions,
  destinationNames: Map<number, string>,
): NavStep[] {
  const steps: NavStep[] = [];
  for (const seg of segments) {
    if (seg.kind === "outdoor") {
      const raw = buildOutdoorStepsForRun(graph, seg.nodeIds, seg.edgeIds);
      steps.push(...rawToNavSteps(raw));
      continue;
    }
    steps.push(
      ...indoorStepsForShortcut(
        graph,
        seg.entranceOutdoorId,
        seg.exitOutdoorId,
        nav,
        destinationNames,
      ),
    );
  }
  return collapseDuplicateArrives(steps);
}

function collapseDuplicateArrives(steps: NavStep[]): NavStep[] {
  const out: NavStep[] = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (
      prev?.kind === "outdoor" &&
      step.kind === "outdoor" &&
      prev.maneuver === "arrive" &&
      step.maneuver === "depart"
    ) {
      out.pop();
    }
    if (
      prev?.kind === "outdoor" &&
      step.kind === "outdoor" &&
      prev.maneuver === "arrive" &&
      step.maneuver === "arrive"
    ) {
      continue;
    }
    out.push(step);
  }
  return out;
}

export async function loadDestinationNames(
  ids: number[],
): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  if (unique.length === 0) return new Map();

  const map = new Map<number, string>();
  for (const id of unique) {
    const result = await db.execute(
      sql<{ id: number; name: string }>`
        SELECT id, name FROM destination WHERE id = ${id}
      `,
    );
    const row = result.rows[0];
    if (row) map.set(Number(row.id), String(row.name));
  }
  return map;
}

export function buildRouteDirections(
  graph: Graph,
  edgePath: number[],
  startNodeId: number,
  navConditions: NavConditions,
  destinationNames: Map<number, string>,
  options?: { finalDestinationName?: string },
): NavStep[] {
  if (edgePath.length === 0) {
    const node = graph.nodesOutside.get(startNodeId);
    if (!node) return [];
    return [
      {
        kind: "outdoor",
        maneuver: "arrive",
        instruction: options?.finalDestinationName
          ? `Arrive at ${options.finalDestinationName}`
          : maneuverPhrase("arrive"),
        distanceMeters: 0,
        coordinate: [node.lng, node.lat],
        nodeId: node.id,
      },
    ];
  }

  const segments = edgePathToSegments(graph, startNodeId, edgePath);
  const steps = segmentsToSteps(
    graph,
    segments,
    navConditions,
    destinationNames,
  );

  if (steps.length > 0 && options?.finalDestinationName) {
    const last = steps[steps.length - 1]!;
    if (last.kind === "outdoor" && last.maneuver === "arrive") {
      last.instruction = `Arrive at ${options.finalDestinationName}`;
    }
  }

  return steps;
}

/** Multi-leg: build steps for each leg and insert waypoint arrivals. */
export async function buildMultiLegDirections(
  graph: Graph,
  startNodeId: number,
  destIds: number[],
  navConditions: NavConditions,
  getLegPath: (
    from: number,
    destId: number,
    nav: NavConditions,
  ) => Promise<number[] | null>,
): Promise<NavStep[]> {
  const names = await loadDestinationNames(destIds);
  const allSteps: NavStep[] = [];
  let legStart = startNodeId;

  for (let i = 0; i < destIds.length; i++) {
    const destId = destIds[i]!;
    const destName = names.get(destId) ?? "destination";
    const legNav =
      navConditions.is_vehicular &&
      i === destIds.length - 1 &&
      destIds.length > 1
        ? {
            ...navConditions,
            is_pedestrian: true,
            is_vehicular: false,
            is_through_building: true,
          }
        : navConditions;

    const edgePath = await getLegPath(legStart, destId, legNav);
    if (!edgePath) continue;

    const legSteps = buildRouteDirections(
      graph,
      edgePath,
      legStart,
      legNav,
      names,
      { finalDestinationName: destName },
    );

    if (i > 0 && legSteps.length > 0) {
      const first = legSteps[0];
      if (first?.kind === "outdoor" && first.maneuver === "depart") {
        legSteps.shift();
      }
    }

    allSteps.push(...legSteps);
    legStart = endNodeFromPath(graph, legStart, edgePath);
  }

  return allSteps;
}
