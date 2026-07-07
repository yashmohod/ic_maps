import type { CSSProperties } from "react";
import type { Edge, Node } from "@xyflow/react";

import { withBasePath } from "@/lib/base-path";

export type FloorplanNodeKind =
  | "generic"
  | "door"
  | "stairs"
  | "elevator"
  | "ramp";

export type FloorplanNodeData = {
  label: string;
  name?: string;
  kind?: FloorplanNodeKind;
  rampValue?: number;
  nodeOutsideId?: number | null;
  isReportHighlight?: boolean;
  isDead?: boolean;
};

export type FloorplanFlowNode = Node<FloorplanNodeData>;
export type FloorplanFlowEdge = Edge;

export type FloorplanApiNode = {
  id: number;
  nodeOutsideId: number | null;
  parentNodeInsideId: number | null;
  x: number;
  y: number;
  isEntry: boolean;
  isExit: boolean;
  isElevator: boolean;
  isStairs: boolean;
  isRamp: boolean;
  isGroup: boolean;
  isDead: boolean;
  imageUrl: string | null;
  incline: number | null;
  width: number | null;
  height: number | null;
  name: string | null;
};

export type FloorplanApiEdge = {
  id: number;
  nodeAId: number;
  nodeBId: number;
  direction: boolean;
  biDirectional: boolean;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export const BASE_GROUP_WIDTH = 420;
export const BASE_GROUP_HEIGHT = 280;
export const BASE_SMALL_NODE_SIZE = 24;
export const BASE_RAMP_WIDTH = 88;
export const BASE_RAMP_HEIGHT = 40;
export const FLOORPLAN_EDGE_Z_INDEX = 10;
export const EDGE_STROKE_DEFAULT = "#475569";
export const EDGE_STROKE_CROSS_FLOOR = "#2563eb";

export const NODE_KIND_META: Record<
  FloorplanNodeKind,
  { label: string; color: string; text: string }
> = {
  generic: { label: "Generic Node", color: "#60a5fa", text: "N" },
  door: { label: "Door", color: "#34d399", text: "D" },
  stairs: { label: "Stairs", color: "#35D5A4", text: "S" },
  elevator: { label: "Elevator", color: "#f472b6", text: "E" },
  ramp: { label: "Ramp", color: "#8b5cf6", text: "R" },
};

export const REPORT_HIGHLIGHT_STYLE: CSSProperties = {
  outline: "3px solid #35D5A4",
  outlineOffset: 2,
  boxShadow: "0 0 0 1px #35D5A4",
};

export function apiNodeToKind(row: FloorplanApiNode): FloorplanNodeKind {
  if (row.isStairs) return "stairs";
  if (row.isElevator) return "elevator";
  if (row.isRamp) return "ramp";
  if (row.nodeOutsideId != null) return "door";
  return "generic";
}

export function groupNodeStyle(
  imageUrl?: string,
  width = BASE_GROUP_WIDTH,
  height = BASE_GROUP_HEIGHT,
): CSSProperties {
  return {
    width,
    height,
    border: "2px solid #999",
    backgroundColor: "#0f172a0d",
    backgroundImage: imageUrl
      ? `url(${withBasePath(imageUrl)})`
      : undefined,
    backgroundSize: "contain",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export function smallNodeStyle(kind: FloorplanNodeKind): CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: "9999px",
    border: "2px solid #0f172a",
    backgroundColor: NODE_KIND_META[kind].color,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
  };
}

export function sortNodesParentBeforeChild<
  T extends { id: string; parentId?: string },
>(nodes: T[]): T[] {
  const roots = nodes.filter((n) => !n.parentId);
  const result: T[] = [];
  const add = (n: T) => {
    result.push(n);
    nodes.filter((c) => c.parentId === n.id).forEach(add);
  };
  roots.forEach(add);
  nodes.forEach((n) => {
    if (!result.includes(n)) result.push(n);
  });
  return result;
}

export function getEdgeStyle(
  parentOf: (nodeId: string) => string | number | null | undefined,
  sourceId: string,
  targetId: string,
): { stroke: string; strokeWidth: number } {
  const a = parentOf(sourceId) ?? null;
  const b = parentOf(targetId) ?? null;
  const crossFloor = a !== b;
  return crossFloor
    ? { stroke: EDGE_STROKE_CROSS_FLOOR, strokeWidth: 3 }
    : { stroke: EDGE_STROKE_DEFAULT, strokeWidth: 2 };
}

export function floorplanApiToFlow(
  apiNodes: FloorplanApiNode[],
  apiEdges: FloorplanApiEdge[],
  options?: { highlightNodeId?: number | null },
): { nodes: FloorplanFlowNode[]; edges: FloorplanFlowEdge[] } {
  const highlightId =
    options?.highlightNodeId != null ? String(options.highlightNodeId) : null;

  const flowNodes: FloorplanFlowNode[] = apiNodes.map((row) => {
    const kind = apiNodeToKind(row);
    const id = String(row.id);
    const position = { x: row.x, y: row.y };
    const parentId =
      row.parentNodeInsideId != null
        ? String(row.parentNodeInsideId)
        : undefined;
    const isReportHighlight = id === highlightId;

    if (row.isGroup) {
      const w =
        row.width != null && row.width > 0
          ? Math.round(row.width)
          : BASE_GROUP_WIDTH;
      const h =
        row.height != null && row.height > 0
          ? Math.round(row.height)
          : BASE_GROUP_HEIGHT;
      return {
        id,
        type: "floor",
        position,
        data: {
          label: `Floor ${id}`,
          name: row.name?.trim() || undefined,
          isReportHighlight,
        },
        style: {
          ...groupNodeStyle(row.imageUrl ?? undefined, w, h),
          border: "none",
          background: "transparent",
        },
        zIndex: 0,
      };
    }

    if (row.isRamp) {
      const w =
        row.width != null && row.width > 0
          ? Math.round(row.width)
          : BASE_RAMP_WIDTH;
      const h =
        row.height != null && row.height > 0
          ? Math.round(row.height)
          : BASE_RAMP_HEIGHT;
      return {
        id,
        type: "ramp",
        position,
        parentId,
        extent: parentId ? "parent" : undefined,
        data: {
          label: "R",
          kind: "ramp",
          rampValue: row.incline ?? 0,
          name: row.name?.trim() || undefined,
          isReportHighlight,
          isDead: row.isDead,
        },
        style: { width: w, height: h, zIndex: 20 },
        zIndex: 20,
      };
    }

    const size =
      row.width != null && row.width > 0
        ? Math.round(row.width)
        : BASE_SMALL_NODE_SIZE;
    const smallH =
      row.height != null && row.height > 0
        ? Math.round(row.height)
        : BASE_SMALL_NODE_SIZE;

    return {
      id,
      type: "smallIcon",
      position,
      parentId,
      extent: parentId ? "parent" : undefined,
      data: {
        label: NODE_KIND_META[kind].text,
        kind,
        nodeOutsideId: row.nodeOutsideId,
        name: row.name?.trim() || undefined,
        isReportHighlight,
        isDead: row.isDead,
      },
      style: { ...smallNodeStyle(kind), width: size, height: smallH },
      zIndex: 20,
    };
  });

  const parentFromApi = (nodeId: string) =>
    apiNodes.find((n) => String(n.id) === nodeId)?.parentNodeInsideId ?? null;

  const flowEdges: FloorplanFlowEdge[] = apiEdges.map((e) => {
    const a = String(e.nodeAId);
    const b = String(e.nodeBId);
    const source = e.direction ? a : b;
    const target = e.direction ? b : a;
    const edgeStyle = getEdgeStyle(parentFromApi, source, target);
    return {
      id: String(e.id),
      source,
      target,
      sourceHandle: e.sourceHandle ?? "right",
      targetHandle: e.targetHandle ?? "left",
      type: "smoothstep",
      zIndex: FLOORPLAN_EDGE_Z_INDEX,
      style: edgeStyle,
    };
  });

  return {
    nodes: sortNodesParentBeforeChild(flowNodes),
    edges: flowEdges,
  };
}
