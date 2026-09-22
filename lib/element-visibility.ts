export const ELEMENT_KINDS = [
  "nodes",
  "edges",
  "polygons",
  "lines",
  "points",
  "texts",
  "arrows",
] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

export type HiddenByKind = Record<ElementKind, Set<number>>;

export type CheckState = "checked" | "unchecked" | "mixed";

export function emptyHidden(): HiddenByKind {
  return {
    nodes: new Set(),
    edges: new Set(),
    polygons: new Set(),
    lines: new Set(),
    points: new Set(),
    texts: new Set(),
    arrows: new Set(),
  };
}

export function groupCheckState(
  ids: readonly number[],
  hidden: Set<number>,
): CheckState {
  if (ids.length === 0) return "checked";
  let hiddenCount = 0;
  for (const id of ids) {
    if (hidden.has(id)) hiddenCount += 1;
  }
  if (hiddenCount === 0) return "checked";
  if (hiddenCount === ids.length) return "unchecked";
  return "mixed";
}

export function toggleGroupHidden(
  ids: readonly number[],
  hidden: Set<number>,
): Set<number> {
  const next = new Set(hidden);
  if (groupCheckState(ids, hidden) === "checked") {
    for (const id of ids) next.add(id);
  } else {
    for (const id of ids) next.delete(id);
  }
  return next;
}

export function toggleItemHidden(id: number, hidden: Set<number>): Set<number> {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function isShown(hidden: Set<number>, id: number): boolean {
  return !hidden.has(id);
}

/** Node ids that are endpoints of at least one path/edge. */
export function pathLinkedNodeIds(
  edges: readonly { from: number; to: number }[],
): Set<number> {
  const ids = new Set<number>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return ids;
}

/**
 * Standalone nodes for the Elements tree: exclude path endpoints so those
 * live under Paths instead of duplicating under Nodes.
 */
export function standaloneNodesForTree<T extends { id: number }>(
  nodes: readonly T[],
  edges: readonly { from: number; to: number }[],
): T[] {
  const linked = pathLinkedNodeIds(edges);
  return nodes.filter((n) => !linked.has(n.id));
}
