import type { OutsideNodeDetail } from "@/lib/types/map";

export type FloorplanApiNode = {
  id: number;
  nodeOutsideId: number | null;
  parentNodeInsideId: number | null;
  x: number;
  y: number;
  isEntry: boolean;
  isExit: boolean;
  isElevator: boolean;
  isStairs: boolean;
  isRamp: boolean;
  isGroup: boolean;
  imageUrl: string | null;
  incline: number | null;
  width: number | null;
  height: number | null;
  name: string | null;
  isDead: boolean;
};

const BASE_GROUP_WIDTH = 420;
const BASE_GROUP_HEIGHT = 280;
const BASE_SMALL_NODE_SIZE = 24;

function isDefaultDoorPosition(node: FloorplanApiNode) {
  return (
    node.nodeOutsideId != null &&
    !node.isGroup &&
    node.parentNodeInsideId == null &&
    Math.abs(node.x) < 1 &&
    Math.abs(node.y) < 1
  );
}

/** Ensure every building entrance has an indoor door node and is visible on a floor. */
export async function syncFloorplanEntrances(
  destinationId: number,
  apiNodes: FloorplanApiNode[],
): Promise<FloorplanApiNode[]> {
  const outsideResp = await fetch(
    `/api/destination/outsideNode?id=${encodeURIComponent(destinationId)}`,
  );
  if (!outsideResp.ok) return apiNodes;

  const outsidePayload = await outsideResp.json();
  const outsideIds = Array.isArray(outsidePayload?.nodes)
    ? outsidePayload.nodes
        .map((id: unknown) => Number(id))
        .filter(Number.isFinite)
    : [];

  let nodes = [...apiNodes];

  for (const outsideId of outsideIds) {
    if (nodes.some((n) => n.nodeOutsideId === outsideId)) continue;

    const createResp = await fetch("/api/destination/floorplan/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationId,
        x: 0,
        y: 0,
        nodeOutsideId: outsideId,
      }),
    });
    if (!createResp.ok) continue;

    const created = (await createResp.json()) as FloorplanApiNode;
    nodes.push(created);
  }

  const floors = nodes.filter((n) => n.isGroup);
  const firstFloor = floors[0];
  if (!firstFloor) return nodes;

  const floorWidth =
    firstFloor.width != null && firstFloor.width > 0
      ? firstFloor.width
      : BASE_GROUP_WIDTH;
  const floorHeight =
    firstFloor.height != null && firstFloor.height > 0
      ? firstFloor.height
      : BASE_GROUP_HEIGHT;

  const unplacedDoors = nodes.filter(isDefaultDoorPosition);
  if (unplacedDoors.length === 0) return nodes;

  const spacing = BASE_SMALL_NODE_SIZE + 16;
  const updated = [...nodes];

  for (let i = 0; i < unplacedDoors.length; i++) {
    const door = unplacedDoors[i];
    const relX = Math.min(
      floorWidth - BASE_SMALL_NODE_SIZE - 8,
      24 + i * spacing,
    );
    const relY = Math.max(24, floorHeight - 40);

    const putResp = await fetch("/api/destination/floorplan/nodes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: door.id,
        x: relX,
        y: relY,
        parentNodeInsideId: firstFloor.id,
      }),
    });
    if (!putResp.ok) continue;

    const idx = updated.findIndex((n) => n.id === door.id);
    if (idx >= 0) {
      updated[idx] = {
        ...updated[idx],
        x: relX,
        y: relY,
        parentNodeInsideId: firstFloor.id,
      };
    }
  }

  return updated;
}

export async function fetchEntranceMarkers(
  destinationId: number,
): Promise<OutsideNodeDetail[]> {
  const resp = await fetch(
    `/api/destination/outsideNode?id=${encodeURIComponent(destinationId)}`,
  );
  if (!resp.ok) return [];

  const payload = await resp.json();
  if (!Array.isArray(payload?.nodeDetails)) return [];

  return payload.nodeDetails as OutsideNodeDetail[];
}
