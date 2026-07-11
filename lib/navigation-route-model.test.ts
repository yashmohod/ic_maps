import { describe, expect, it } from "vitest";
import {
  edgePathToNodeIds,
  edgePathToSegments,
  hasOutdoorEdge,
} from "@/lib/navigation-route-model";
import { buildGraph, reconstructIndoorPath } from "@/lib/navigation-graph";
import type {
  EdgeInside,
  EdgeOutside,
  NodeInside,
  NodeOutside,
} from "@/db/schema";

const nav = {
  is_pedestrian: true,
  is_vehicular: false,
  is_avoid_stairs: false,
  is_incline_limit: false,
  is_through_building: true,
  max_incline: 45,
};

function outdoorNode(id: number, lat: number, lng: number): NodeOutside {
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
    location: { x: lng, y: lat },
  };
}

describe("edgePathToNodeIds", () => {
  it("walks outdoor edges into node sequence", () => {
    const outside = [
      outdoorNode(1, 42.42, -76.49),
      outdoorNode(2, 42.421, -76.491),
    ];
    const edges: EdgeOutside[] = [
      {
        id: 100,
        node_a_id: 1,
        node_b_id: 2,
        bi_directional: true,
        direction: true,
        distance: 50,
        incline: 0,
      },
    ];
    const graph = buildGraph([], [], outside, edges, []);
    expect(edgePathToNodeIds(graph, 1, [100])).toEqual([1, 2]);
  });
});

describe("indoor shortcut detection", () => {
  it("detects indoor segment when no outdoor edge connects entrance to exit", () => {
    const outside = [
      outdoorNode(10, 42.42, -76.49),
      outdoorNode(20, 42.421, -76.491),
      outdoorNode(30, 42.422, -76.492),
      outdoorNode(40, 42.423, -76.493),
    ];
    const edges: EdgeOutside[] = [
      {
        id: 1,
        node_a_id: 10,
        node_b_id: 20,
        bi_directional: true,
        direction: true,
        distance: 30,
        incline: 0,
      },
      {
        id: 2,
        node_a_id: 30,
        node_b_id: 40,
        bi_directional: true,
        direction: true,
        distance: 30,
        incline: 0,
      },
    ];
    const inside: NodeInside[] = [
      {
        id: 101,
        node_outside_id: 20,
        parent_node_inside_id: null,
        x: 0,
        y: 0,
        is_entry: true,
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
        name: "Main entrance",
        destination_id: 5,
      },
      {
        id: 102,
        node_outside_id: 30,
        parent_node_inside_id: null,
        x: 10,
        y: 0,
        is_entry: false,
        is_exit: true,
        is_elevator: false,
        is_stairs: false,
        is_ramp: false,
        is_group: false,
        is_dead: false,
        image_url: null,
        incline: 0,
        width: null,
        height: null,
        name: "North exit",
        destination_id: 5,
      },
    ];
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
    const graph = buildGraph(inside, insideEdges, outside, edges, []);
    expect(hasOutdoorEdge(graph, 20, 30)).toBe(false);

    const path = reconstructIndoorPath(graph, 20, 30, nav);
    expect(path).toEqual([101, 102]);

    const segments = edgePathToSegments(graph, 10, [1, 2]);
    const indoor = segments.find((s) => s.kind === "indoor");
    expect(indoor).toBeDefined();
    if (indoor?.kind === "indoor") {
      expect(indoor.entranceOutdoorId).toBe(20);
      expect(indoor.exitOutdoorId).toBe(30);
    }
  });
});
