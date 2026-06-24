import { describe, expect, it } from "vitest";
import {
  floorLabelForNode,
  indoorInstructionForNode,
  shouldIncludeIndoorNode,
  type IndoorNodeLike,
} from "@/lib/navigation-indoor-labels";

const floorGroup: IndoorNodeLike = {
  id: 1,
  parent_node_inside_id: null,
  destination_id: 10,
  name: "Floor 2",
  is_entry: false,
  is_exit: false,
  is_elevator: false,
  is_stairs: false,
  is_ramp: false,
  is_group: true,
  node_outside_id: null,
  incline: 0,
};

const elevator: IndoorNodeLike = {
  id: 2,
  parent_node_inside_id: 1,
  destination_id: 10,
  name: "West elevator",
  is_entry: false,
  is_exit: false,
  is_elevator: true,
  is_stairs: false,
  is_ramp: false,
  is_group: false,
  node_outside_id: null,
  incline: 0,
};

const nodes = new Map<number, IndoorNodeLike>([
  [1, floorGroup],
  [2, elevator],
]);

describe("indoor labels", () => {
  it("resolves floor label from parent group", () => {
    expect(floorLabelForNode(elevator, nodes)).toBe("Floor 2");
  });

  it("builds elevator instruction", () => {
    expect(indoorInstructionForNode(elevator, nodes, "Textor Hall")).toBe(
      "Take West elevator to Floor 2",
    );
  });

  it("skips duplicate generic instructions", () => {
    const generic: IndoorNodeLike = {
      ...elevator,
      id: 3,
      is_elevator: false,
      name: null,
    };
    const instruction = indoorInstructionForNode(generic, nodes, "Hall");
    expect(shouldIncludeIndoorNode(generic, nodes, "Hall", instruction)).toBe(
      false,
    );
  });
});
