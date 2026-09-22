import { describe, expect, it } from "vitest";
import { orderParkingWalkStarts } from "@/lib/vehicular-parking-plan";

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
