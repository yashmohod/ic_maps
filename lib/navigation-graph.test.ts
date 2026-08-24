import { describe, expect, it } from "vitest";
import {
  buildGraph,
  encodeThroughBuildingHop,
  decodeThroughBuildingHop,
  nextNodeFromEdge,
  reconstructIndoorPath,
  through_building_bfs_with_cost,
} from "@/lib/navigation-graph";
import type { EdgeInside, EdgeOutside, NodeInside, NodeOutside } from "@/db/schema";
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

  it("round-trips campus-scale ids that overflow 32-bit shifts", () => {
    const from = 4712;
    const to = 5001;
    const id = encodeThroughBuildingHop(from, to);
    expect(id).toBeLessThan(0);
    expect(decodeThroughBuildingHop(id)).toEqual({ from, to });
  });

  it("nextNodeFromEdge follows synthetic hop", () => {
    const nodes = [outside(12, 42.42, -76.49), outside(34, 42.421, -76.49)];
    const g = buildGraph([], [], nodes, [], [], 1);
    const hop = encodeThroughBuildingHop(12, 34);
    expect(nextNodeFromEdge(g, 12, hop)).toBe(34);
    expect(nextNodeFromEdge(g, 34, hop)).toBeNull();
  });

  it("walks a path into a building and back out after a hop", () => {
    const nodes = [
      outside(4001, 42.42, -76.49),
      outside(4712, 42.421, -76.491),
      outside(5001, 42.422, -76.492),
      outside(6002, 42.423, -76.493),
    ];
    const edges: EdgeOutside[] = [
      {
        id: 10,
        node_a_id: 4001,
        node_b_id: 4712,
        bi_directional: true,
        direction: true,
        distance: 40,
      },
      {
        id: 20,
        node_a_id: 5001,
        node_b_id: 6002,
        bi_directional: true,
        direction: true,
        distance: 40,
      },
    ];
    const g = buildGraph([], [], nodes, edges, [], 1);
    const hop = encodeThroughBuildingHop(4712, 5001);
    const path = [10, hop, 20];
    const walked: number[] = [4001];
    let cur = 4001;
    for (const edgeId of path) {
      const next = nextNodeFromEdge(g, cur, edgeId);
      expect(next).not.toBeNull();
      walked.push(next!);
      cur = next!;
    }
    expect(walked).toEqual([4001, 4712, 5001, 6002]);
  });
});

describe("through-building portals", () => {
  const nav = {
    is_pedestrian: true,
    is_vehicular: false,
    is_avoid_stairs: false,
    is_incline_limit: false,
    is_through_building: true,
    max_incline: 45,
  };

  function door(
    id: number,
    outsideId: number,
    destId: number,
  ): NodeInside {
    return {
      id,
      node_outside_id: outsideId,
      parent_node_inside_id: null,
      x: 0,
      y: 0,
      is_entry: false,
      is_exit: false,
      is_elevator: false,
      is_stairs: false,
      is_ramp: false,
      is_group: false,
      is_dead: false,
      image_url: null,
      incline: 0,
      width: null,
      height: null,
      name: null,
      destination_id: destId,
    };
  }

  it("uses linked outdoor doors even when is_entry/is_exit are unset", () => {
    const outsideNodes = [
      outside(20, 42.421, -76.491),
      outside(30, 42.422, -76.492),
    ];
    const inside = [door(101, 20, 5), door(102, 30, 5)];
    const insideEdges: EdgeInside[] = [
      {
        id: 201,
        node_a_id: 101,
        node_b_id: 102,
        bi_directional: true,
        direction: true,
        source_handle: null,
        target_handle: null,
        destination_id: 5,
      },
    ];
    const g = buildGraph(inside, insideEdges, outsideNodes, [], []);
    expect(g.buildingEntranceNodeIds.has(20)).toBe(true);
    expect(g.buildingEntranceNodeIds.has(30)).toBe(true);
    const exits = through_building_bfs_with_cost(g, 20, nav);
    expect(exits.some((e) => e.exitOutsideId === 30)).toBe(true);
    expect(reconstructIndoorPath(g, 20, 30, nav)).toEqual([101, 102]);
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
