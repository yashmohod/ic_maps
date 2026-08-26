/**
 * Pure expansion of user stops into mixed-mode vehicular legs.
 * `pickLot` stands in for A* “closest recommended parking” during tests.
 */

export type ExpandedRouteLeg = {
  destinationId: number;
  mode: "vehicular" | "pedestrian";
  kind: "parking" | "building";
};

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
