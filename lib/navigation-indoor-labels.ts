import type { NodeInside } from "@/db/schema";
import type { Graph } from "@/lib/navigation-graph";

export type IndoorNodeLike = Pick<
  NodeInside,
  | "id"
  | "parent_node_inside_id"
  | "destination_id"
  | "name"
  | "is_entry"
  | "is_exit"
  | "is_elevator"
  | "is_stairs"
  | "is_ramp"
  | "is_group"
  | "node_outside_id"
  | "incline"
>;

export function floorLabelForNode(
  node: IndoorNodeLike,
  allNodes: Map<number, IndoorNodeLike>,
): string {
  if (node.parent_node_inside_id == null) return "Floor unknown";
  const parent = allNodes.get(node.parent_node_inside_id);
  if (!parent) return "Floor unknown";
  if (parent.is_group) {
    return parent.name?.trim() || `Floor ${parent.id}`;
  }
  return floorLabelForNode(parent, allNodes);
}

function nodeDisplayName(node: IndoorNodeLike, floor: string): string {
  if (node.name?.trim()) return node.name.trim();
  if (node.is_elevator) return `Elevator (${floor})`;
  if (node.is_stairs) return `Stairs (${floor})`;
  if (node.is_ramp) return `Ramp (${floor})`;
  if (node.node_outside_id != null) return "Entrance";
  return `Waypoint (${floor})`;
}

export function indoorInstructionForNode(
  node: IndoorNodeLike,
  allNodes: Map<number, IndoorNodeLike>,
  buildingName: string,
): string {
  const floor = floorLabelForNode(node, allNodes);
  const name = nodeDisplayName(node, floor);

  if (node.is_entry && node.node_outside_id != null) {
    return `Enter ${buildingName} at ${name}`;
  }
  if (node.is_exit && node.node_outside_id != null) {
    return `Exit at ${name}`;
  }
  if (node.is_elevator) {
    return `Take ${name} to ${floor}`;
  }
  if (node.is_stairs) {
    return `Take stairs to ${floor}`;
  }
  if (node.is_ramp) {
    const incline = Math.round(node.incline ?? 0);
    return incline > 0
      ? `Use ramp (${incline}°) toward ${floor}`
      : `Use ramp toward ${floor}`;
  }
  if (node.name?.trim()) {
    return `Continue to ${name}`;
  }
  return `Continue through ${floor}`;
}

/** Skip redundant generic hops with identical instructions. */
export function shouldIncludeIndoorNode(
  node: IndoorNodeLike,
  allNodes: Map<number, IndoorNodeLike>,
  buildingName: string,
  prevInstruction: string | null,
): boolean {
  const instruction = indoorInstructionForNode(node, allNodes, buildingName);
  if (instruction === prevInstruction) return false;
  if (
    !node.is_entry &&
    !node.is_exit &&
    !node.is_elevator &&
    !node.is_stairs &&
    !node.is_ramp &&
    !node.name?.trim()
  ) {
    return false;
  }
  return true;
}

export function graphInsideNodesMap(graph: Graph): Map<number, IndoorNodeLike> {
  const map = new Map<number, IndoorNodeLike>();
  for (const [id, node] of graph.nodesInside) {
    map.set(id, node);
  }
  return map;
}
