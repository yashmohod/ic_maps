import { describe, expect, it } from "vitest";
import { applyPreferredParkingLot } from "@/lib/vehicular-parking-plan";
import {
  buildNavigatePayload,
  pickNearestMatchingNode,
  type NavPayloadConditions,
} from "@/lib/trip-end";

const walk: NavPayloadConditions = {
  is_pedestrian: true,
  is_vehicular: false,
  is_through_building: true,
  is_avoid_stairs: false,
  is_incline_limit: false,
  max_incline: 0,
};

describe("applyPreferredParkingLot", () => {
  it("keeps a preferred lot only when it is in the candidate list", () => {
    expect(applyPreferredParkingLot([4, 5], 5)).toEqual([5]);
    expect(applyPreferredParkingLot([4, 5], 9)).toEqual([4, 5]);
    expect(applyPreferredParkingLot([4, 5], null)).toEqual([4, 5]);
  });
});

describe("pickNearestMatchingNode", () => {
  const nodes = [
    { id: 1, lat: 42.42, lng: -76.5, pedestrian: true, vehicular: false },
    { id: 2, lat: 42.43, lng: -76.49, pedestrian: true, vehicular: true },
    { id: 3, lat: 42.421, lng: -76.501, pedestrian: false, vehicular: true },
  ];

  it("picks the nearest node that matches the mode", () => {
    expect(
      pickNearestMatchingNode(nodes, { lat: 42.421, lng: -76.501 }, "pedestrian"),
    ).toBe(1);
    expect(
      pickNearestMatchingNode(nodes, { lat: 42.421, lng: -76.501 }, "vehicular"),
    ).toBe(3);
  });
});

describe("buildNavigatePayload", () => {
  it("refuses a missing end, the same end, and a GPS end with no fix", () => {
    expect(
      buildNavigatePayload({
        from: { kind: "gps" },
        to: null,
        gps: null,
        navConditions: walk,
      }).ok,
    ).toBe(false);
    expect(
      buildNavigatePayload({
        from: { kind: "place", id: 3 },
        to: { kind: "place", id: 3 },
        gps: null,
        navConditions: walk,
      }),
    ).toMatchObject({ ok: false, reason: "same" });
    expect(
      buildNavigatePayload({
        from: { kind: "gps" },
        to: { kind: "place", id: 3 },
        gps: null,
        navConditions: walk,
      }),
    ).toMatchObject({ ok: false, reason: "gps" });
  });

  it("sends a place start and an entrance end without GPS", () => {
    const built = buildNavigatePayload({
      from: { kind: "place", id: 8 },
      to: { kind: "entrance", id: 2, nodeId: 44 },
      gps: null,
      navConditions: walk,
    });
    expect(built).toEqual({
      ok: true,
      body: {
        navConditions: walk,
        startDestId: 8,
        endNodeId: 44,
      },
    });
  });
});
