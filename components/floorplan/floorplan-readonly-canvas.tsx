"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  useReactFlow,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CircleDot,
  DoorOpen,
  Layers,
  MoveVertical,
  TrendingUp,
} from "lucide-react";

import {
  EDGE_STROKE_DEFAULT,
  FLOORPLAN_EDGE_Z_INDEX,
  NODE_KIND_META,
  REPORT_HIGHLIGHT_STYLE,
  type FloorplanFlowEdge,
  type FloorplanFlowNode,
  type FloorplanNodeData,
  type FloorplanNodeKind,
} from "@/lib/floorplan-flow";
import { cn } from "@/lib/utils";

const ICON_SIZE = 12;

function NodeKindIcon({ kind }: { kind: FloorplanNodeKind }) {
  const color = "#0f172a";
  const common = { size: ICON_SIZE, color, strokeWidth: 2.5 };
  switch (kind) {
    case "generic":
      return <CircleDot {...common} />;
    case "door":
      return <DoorOpen {...common} />;
    case "stairs":
      return <Layers {...common} />;
    case "elevator":
      return <MoveVertical {...common} />;
    case "ramp":
      return <TrendingUp {...common} />;
    default:
      return <CircleDot {...common} />;
  }
}

function ReadonlySmallIconNode({ data }: NodeProps<Node<FloorplanNodeData>>) {
  const kind = (data.kind ?? "generic") as FloorplanNodeKind;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        ...(data.isReportHighlight ? REPORT_HIGHLIGHT_STYLE : undefined),
      }}
    >
      <div
        className="h-full w-full"
        style={{
          borderRadius: "9999px",
          border: "2px solid #0f172a",
          backgroundColor: NODE_KIND_META[kind].color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <NodeKindIcon kind={kind} />
      </div>
    </div>
  );
}

function ReadonlyRampNode({ data }: NodeProps<Node<FloorplanNodeData>>) {
  const value = Math.min(90, Math.max(0, data.rampValue ?? 0));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        padding: "4px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        borderRadius: "9999px",
        border: "2px solid #0f172a",
        backgroundColor: NODE_KIND_META.ramp.color,
        ...(data.isReportHighlight ? REPORT_HIGHLIGHT_STYLE : undefined),
      }}
    >
      <span className="flex items-center justify-center">
        <NodeKindIcon kind="ramp" />
      </span>
      <span
        className="text-center text-[10px] font-bold leading-none"
        style={{ color: "#0f172a" }}
      >
        {value}°
      </span>
    </div>
  );
}

function ReadonlyFloorGroupNode({
  id,
  data,
}: NodeProps<Node<FloorplanNodeData>>) {
  const { getNode } = useReactFlow();
  const node = getNode(id);
  const style = node?.style ?? {};

  return (
    <div className="relative h-full w-full">
      <div
        className="h-full w-full"
        style={{
          border: data.isReportHighlight
            ? "4px solid #35D5A4"
            : "2px solid #999",
          backgroundColor: data.isReportHighlight ? "#35D5A414" : "#0f172a0d",
          boxShadow: data.isReportHighlight
            ? "0 0 0 2px #35D5A4, 0 4px 12px rgba(53,213,164,0.25)"
            : undefined,
          backgroundImage: style?.backgroundImage as string | undefined,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {data.name ? (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-panel/90 px-1.5 py-0.5 text-[10px] font-semibold text-panel-foreground shadow">
          {data.name}
        </span>
      ) : null}
    </div>
  );
}

type FloorplanReadonlyCanvasProps = {
  className?: string;
  nodes: FloorplanFlowNode[];
  edges: FloorplanFlowEdge[];
};

export function FloorplanReadonlyCanvas({
  className,
  nodes,
  edges,
}: FloorplanReadonlyCanvasProps) {
  const nodeTypes = useMemo(
    () => ({
      ramp: ReadonlyRampNode,
      floor: ReadonlyFloorGroupNode,
      smallIcon: ReadonlySmallIconNode,
    }),
    [],
  );

  return (
    <div className={cn("h-full w-full", className)}>
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        preventScrolling
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: "smoothstep",
          zIndex: FLOORPLAN_EDGE_Z_INDEX,
          style: { stroke: EDGE_STROKE_DEFAULT, strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2.5}
      />
    </div>
  );
}
