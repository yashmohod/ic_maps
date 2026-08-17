import { describe, expect, it } from "vitest";
import {
  buildGraph,
  encodeThroughBuildingHop,
  decodeThroughBuildingHop,
  nextNodeFromEdge,
} from "@/lib/navigation-graph";
import type { EdgeOutside, NodeOutside } from "@/db/schema";
import { heuristic } from "@/lib/geo";

function outside(
  id: number,
  lat: number,
  lng: number,
  extra: Partial<NodeOutside> = {},
): NodeOutside {
  return {
    id,
    lat,
    lng,
    is_pedestrian: true,
    is_vehicular: false,
    is_elevator: false,
    is_stairs: false,
    is_blue_light: false,
    is_dead: false,
    incline: 0,
    location: { x: lng, y: lat },
    ...extra,
  } as NodeOutside;
}

describe("buildGraph one-way edges", () => {
  it("honors direction when not bidirectional", () => {
    const nodes = [outside(1, 42.42, -76.49), outside(2, 42.421, -76.49)];
    const edges: EdgeOutside[] = [
      {
        id: 10,
        node_a_id: 1,
        node_b_id: 2,
        bi_directional: false,
        direction: false, // b -> a
        distance: 100,
      },
    ];
    const g = buildGraph([], [], nodes, edges, [], 1);
    expect(g.adjOutside.get(2)?.some((n) => n.to === 1)).toBe(true);
    expect(g.adjOutside.get(1)?.some((n) => n.to === 2)).toBeFalsy();
  });
});

describe("through-building hop encoding", () => {
  it("round-trips from/to", () => {
    const id = encodeThroughBuildingHop(12, 34);
    expect(decodeThroughBuildingHop(id)).toEqual({ from: 12, to: 34 });
  });

  it("nextNodeFromEdge follows synthetic hop", () => {
    const nodes = [outside(12, 42.42, -76.49), outside(34, 42.421, -76.49)];
    const g = buildGraph([], [], nodes, [], [], 1);
    const hop = encodeThroughBuildingHop(12, 34);
    expect(nextNodeFromEdge(g, 12, hop)).toBe(34);
    expect(nextNodeFromEdge(g, 34, hop)).toBeNull();
  });
});

describe("heuristic lng scale", () => {
  it("does not inflate pure east-west vs inflated 111km scale", () => {
    const h = heuristic(42.42, -76.5, 42.42, -76.49);
    // 0.01° lng * 82e3 ≈ 820m
    expect(h).toBeGreaterThan(800);
    expect(h).toBeLessThan(900);
  });
});
