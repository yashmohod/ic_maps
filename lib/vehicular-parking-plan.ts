/**
 * Pure expansion of user stops into mixed-mode vehicular legs.
 * `pickLot` stands in for A* “closest recommended parking” during tests.
 */

import { calcDistance } from "@/lib/geo";

export type ExpandedRouteLeg = {
  destinationId: number;
  mode: "vehicular" | "pedestrian";
  kind: "parking" | "building";
};

/**
 * If the user picked a preferred lot and it is in the building's recommended
 * list, route only through that lot. Otherwise keep the full recommended set
 * (auto = closest).
 */
export function applyPreferredParkingLot(
  recommendedLotIds: readonly number[],
  preferredParkingLotId?: number | null,
): number[] {
  if (
    preferredParkingLotId != null &&
    preferredParkingLotId > 0 &&
    recommendedLotIds.includes(preferredParkingLotId)
  ) {
    return [preferredParkingLotId];
  }
  return [...recommendedLotIds];
}

export function expandVehicularLegs(
  stopIds: number[],
  isParkingLot: (id: number) => boolean,
  recommendedLots: (buildingId: number) => readonly number[],
  pickLot: (buildingId: number, candidates: number[]) => number,
): ExpandedRouteLeg[] {
  const legs: ExpandedRouteLeg[] = [];
  let activeParkingIds = new Set<number>();

  for (const stopId of stopIds) {
    if (isParkingLot(stopId)) {
      legs.push({
        destinationId: stopId,
        mode: "vehicular",
        kind: "parking",
      });
      activeParkingIds = new Set([stopId]);
      continue;
    }

    const lots = recommendedLots(stopId);
    if (lots.length === 0) {
      legs.push({
        destinationId: stopId,
        mode: "vehicular",
        kind: "building",
      });
      activeParkingIds = new Set();
      continue;
    }

    const shared = lots.filter((id) => activeParkingIds.has(id));
    if (shared.length > 0) {
      legs.push({
        destinationId: stopId,
        mode: "pedestrian",
        kind: "building",
      });
      activeParkingIds = new Set(shared);
      continue;
    }

    const chosen = pickLot(stopId, [...lots]);
    legs.push({
      destinationId: chosen,
      mode: "vehicular",
      kind: "parking",
    });
    legs.push({
      destinationId: stopId,
      mode: "pedestrian",
      kind: "building",
    });
    activeParkingIds = new Set([chosen]);
  }

  return legs;
}

/** Arrival first, then other live pedestrian lot nodes, then remaining live lot nodes. */
export function orderParkingWalkStarts(
  arrivalNodeId: number,
  lotNodeIds: number[],
  isLivePedestrian: (id: number) => boolean,
  isLive: (id: number) => boolean,
): number[] {
  const lotSet = new Set(lotNodeIds);
  const ordered: number[] = [];
  if (lotSet.has(arrivalNodeId) && isLive(arrivalNodeId)) {
    ordered.push(arrivalNodeId);
  }
  for (const id of lotNodeIds) {
    if (id === arrivalNodeId) continue;
    if (!isLivePedestrian(id)) continue;
    ordered.push(id);
  }
  for (const id of lotNodeIds) {
    if (ordered.includes(id)) continue;
    if (!isLive(id)) continue;
    ordered.push(id);
  }
  return ordered;
}

/** A door of a recommended parking lot. Dead doors are omitted by the caller. */
export type LotDoor = {
  id: number;
  lotId: number;
  lat: number;
  lng: number;
  pedestrian: boolean;
  vehicular: boolean;
};

/** Lot ids a pedestrian can walk to. Empty when none of the doors are pedestrian. */
export function pedestrianLotIds(doors: readonly LotDoor[]): number[] {
  const ids: number[] = [];
  for (const door of doors) {
    if (!door.pedestrian || ids.includes(door.lotId)) continue;
    ids.push(door.lotId);
  }
  return ids;
}

/**
 * The walk already arrived at `arrivalNodeId`. Stay there when that door can
 * drive. Otherwise retarget a same-lot door that is both walk and drive, or
 * the straight-line nearest vehicular door of that lot.
 */
export function driveHandoffAtLot(
  arrivalNodeId: number,
  doors: readonly LotDoor[],
): { retargetNodeIds: number[] } | { driveNodeId: number } {
  const arrival = doors.find((door) => door.id === arrivalNodeId);
  if (!arrival) return { driveNodeId: -1 };
  if (arrival.vehicular) return { driveNodeId: arrival.id };

  const sameLot = doors.filter((door) => door.lotId === arrival.lotId);
  const dual = sameLot.filter((door) => door.pedestrian && door.vehicular);
  if (dual.length > 0) return { retargetNodeIds: dual.map((door) => door.id) };

  let best: LotDoor | null = null;
  let bestDistance = Infinity;
  for (const door of sameLot) {
    if (!door.vehicular) continue;
    const distance = calcDistance(arrival.lat, arrival.lng, door.lat, door.lng);
    if (distance < bestDistance) {
      best = door;
      bestDistance = distance;
    }
  }
  return { driveNodeId: best?.id ?? -1 };
}
