import { calcDistance } from "@/lib/geo";

export type TripEnd =
  | { kind: "gps" }
  | { kind: "place"; id: number }
  | { kind: "entrance"; id: number; nodeId: number };

export type CampusEntrance = {
  id: number;
  name: string;
  nodeId: number;
  lat: number;
  lng: number;
};

export type NavPayloadConditions = {
  is_pedestrian: boolean;
  is_vehicular: boolean;
  is_through_building: boolean;
  is_avoid_stairs: boolean;
  is_incline_limit: boolean;
  max_incline: number;
};

export type RoutedNode = {
  id: number;
  lat: number;
  lng: number;
  pedestrian: boolean;
  vehicular: boolean;
};

export function sameTripEnd(a: TripEnd, b: TripEnd): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "gps") return true;
  if (a.kind === "place" && b.kind === "place") return a.id === b.id;
  if (a.kind === "entrance" && b.kind === "entrance") {
    return a.nodeId === b.nodeId;
  }
  return false;
}

export function tripEndNeedsGps(end: TripEnd | null): boolean {
  return end?.kind === "gps";
}

/**
 * Straight-line nearest door that matches the travel mode.
 * ponytail: not the shortest path among doors. Upgrade: multi-source A*.
 */
export function pickNearestMatchingNode(
  nodes: readonly RoutedNode[],
  target: { lat: number; lng: number },
  mode: "pedestrian" | "vehicular",
): number | null {
  let bestId: number | null = null;
  let best = Infinity;
  for (const node of nodes) {
    const ok = mode === "pedestrian" ? node.pedestrian : node.vehicular;
    if (!ok) continue;
    const distance = calcDistance(node.lat, node.lng, target.lat, target.lng);
    if (distance < best) {
      best = distance;
      bestId = node.id;
    }
  }
  return bestId;
}

export function buildNavigatePayload(input: {
  from: TripEnd | null;
  to: TripEnd | null;
  viaPlaceIds?: number[];
  gps: { lat: number; lng: number } | null;
  navConditions: NavPayloadConditions;
  preferredParkingLotId?: number | null;
  /** When set, these lots replace the building's saved recommendations. */
  parkingLotIds?: number[] | null;
}):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "incomplete" | "same" | "gps" } {
  const { from, to } = input;
  if (!from || !to) return { ok: false, reason: "incomplete" };
  if (sameTripEnd(from, to)) return { ok: false, reason: "same" };
  if ((from.kind === "gps" || to.kind === "gps") && !input.gps) {
    return { ok: false, reason: "gps" };
  }

  const body: Record<string, unknown> = {
    navConditions: input.navConditions,
  };

  if (from.kind === "gps" && input.gps) {
    body.lat = input.gps.lat;
    body.lng = input.gps.lng;
    body.gpsAt = "start";
  } else if (from.kind === "place") {
    body.startDestId = from.id;
  } else if (from.kind === "entrance") {
    body.startNodeId = from.nodeId;
  }

  if (to.kind === "gps" && input.gps) {
    body.lat = input.gps.lat;
    body.lng = input.gps.lng;
    body.gpsAt = "end";
  } else if (to.kind === "entrance") {
    body.endNodeId = to.nodeId;
  } else if (to.kind === "place") {
    const allowVias = from.kind !== "entrance";
    const vias = allowVias
      ? (input.viaPlaceIds ?? []).filter((id) => id > 0)
      : [];
    let ids = vias.length > 0 ? [...vias] : [to.id];
    if (ids[ids.length - 1] !== to.id) {
      ids = [...ids.filter((id) => id !== to.id), to.id];
    }
    if (ids.length === 1) body.destId = ids[0];
    else body.viaDestIds = ids;
    if (
      input.navConditions.is_vehicular &&
      input.preferredParkingLotId != null &&
      input.preferredParkingLotId > 0
    ) {
      body.preferredParkingLotId = input.preferredParkingLotId;
    }
    if (input.parkingLotIds != null) {
      body.parkingLotIds = input.parkingLotIds;
    }
  }

  return { ok: true, body };
}
