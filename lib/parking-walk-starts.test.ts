import { describe, expect, it } from "vitest";
import {
  driveHandoffAtLot,
  orderParkingWalkStarts,
  pedestrianLotIds,
  type LotDoor,
} from "@/lib/vehicular-parking-plan";

describe("orderParkingWalkStarts", () => {
  const livePed = (id: number) => id === 2200 || id === 2201;
  const live = (id: number) => id === 1822 || id === 2200 || id === 2201;

  it("tries arrival first, then other pedestrian lot nodes", () => {
    expect(
      orderParkingWalkStarts(1822, [1822, 2200, 2201], livePed, live),
    ).toEqual([1822, 2200, 2201]);
  });

  it("skips dead / unknown nodes and still lists ped starts", () => {
    expect(
      orderParkingWalkStarts(999, [1822, 2200, 9999], livePed, live),
    ).toEqual([2200, 1822]);
  });
});

const doors: LotDoor[] = [
  { id: 1, lotId: 10, lat: 42.42, lng: -76.5, pedestrian: true, vehicular: false },
  { id: 2, lotId: 10, lat: 42.421, lng: -76.5, pedestrian: true, vehicular: true },
  { id: 3, lotId: 10, lat: 42.43, lng: -76.49, pedestrian: false, vehicular: true },
  { id: 4, lotId: 11, lat: 42.4201, lng: -76.5001, pedestrian: false, vehicular: true },
  { id: 5, lotId: 12, lat: 42.5, lng: -76.6, pedestrian: false, vehicular: true },
];

describe("pedestrianLotIds", () => {
  it("keeps lots a person can walk to", () => {
    expect(pedestrianLotIds(doors)).toEqual([10]);
  });
});

describe("driveHandoffAtLot", () => {
  it("stays on a door that can already drive", () => {
    expect(driveHandoffAtLot(2, doors)).toEqual({ driveNodeId: 2 });
  });

  it("retargets a walk-only arrival to a same-lot door that can drive", () => {
    expect(driveHandoffAtLot(1, doors)).toEqual({ retargetNodeIds: [2] });
  });

  it("snaps to the nearest vehicular door of the same lot", () => {
    const pedOnly = doors.map((door) =>
      door.id === 2 ? { ...door, pedestrian: false, vehicular: false } : door,
    );
    expect(driveHandoffAtLot(1, pedOnly)).toEqual({ driveNodeId: 3 });
  });
});
