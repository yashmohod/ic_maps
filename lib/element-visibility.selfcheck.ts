import {
  emptyHidden,
  groupCheckState,
  pathLinkedNodeIds,
  standaloneNodesForTree,
  toggleGroupHidden,
  toggleItemHidden,
} from "@/lib/element-visibility";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const hidden = emptyHidden();
assert(groupCheckState([1, 2, 3], hidden.nodes) === "checked", "all shown");
hidden.nodes = toggleGroupHidden([1, 2, 3], hidden.nodes);
assert(groupCheckState([1, 2, 3], hidden.nodes) === "unchecked", "all hidden");
hidden.nodes = toggleItemHidden(2, hidden.nodes);
assert(groupCheckState([1, 2, 3], hidden.nodes) === "mixed", "mixed");

const edges = [
  { from: 10, to: 11 },
  { from: 11, to: 12 },
];
const linked = pathLinkedNodeIds(edges);
assert(linked.has(10) && linked.has(11) && linked.has(12), "linked endpoints");
const alone = standaloneNodesForTree(
  [{ id: 10 }, { id: 20 }, { id: 12 }],
  edges,
);
assert(
  alone.map((n) => n.id).join(",") === "20",
  "path endpoints excluded from node tree",
);

console.log("element-visibility.selfcheck: ok");
