"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { ReactFlowProvider } from "@xyflow/react";
import {
  CircleDot,
  DoorOpen,
  Layers,
  MoveVertical,
  TrendingUp,
} from "lucide-react";

import { FloorplanReadonlyCanvas } from "@/components/floorplan/floorplan-readonly-canvas";
import { Spinner } from "@/components/ui/spinner";
import {
  floorplanApiToFlow,
  NODE_KIND_META,
  type FloorplanApiEdge,
  type FloorplanApiNode,
  type FloorplanNodeKind,
} from "@/lib/floorplan-flow";
import { cn } from "@/lib/utils";

type RouteReportFloorplanPreviewProps = {
  className?: string;
  destinationId: number;
  highlightNodeId: number;
};

function NodeKindLegendIcon({ kind }: { kind: FloorplanNodeKind }) {
  const color = "#0f172a";
  const common = { size: 12, color, strokeWidth: 2.5 };
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

function FloorplanNodeKindLegend() {
  return (
    <div className="border-border bg-panel rounded-lg border px-3 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-panel-muted-foreground">
        Legend
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            "door",
            "stairs",
            "elevator",
            "ramp",
            "generic",
          ] as FloorplanNodeKind[]
        ).map((kind) => (
          <div key={kind} className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center justify-center rounded-full border border-slate-900"
              style={{
                width: 18,
                height: 18,
                backgroundColor: NODE_KIND_META[kind].color,
              }}
            >
              <NodeKindLegendIcon kind={kind} />
            </span>
            <span className="text-[10px]">{NODE_KIND_META[kind].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloorplanPreviewInner({
  className,
  destinationId,
  highlightNodeId,
}: RouteReportFloorplanPreviewProps) {
  const [apiNodes, setApiNodes] = useState<FloorplanApiNode[]>([]);
  const [apiEdges, setApiEdges] = useState<FloorplanApiEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [nodesResp, edgesResp] = await Promise.all([
          fetch(withBasePath(`/api/destination/floorplan/nodes?destinationId=${destinationId}`)),
          fetch(withBasePath(`/api/destination/floorplan/edges?destinationId=${destinationId}`)),
        ]);

        if (!nodesResp.ok || !edgesResp.ok) {
          throw new Error("Failed to load floor plan");
        }

        const nodesPayload = await nodesResp.json();
        const edgesPayload = await edgesResp.json();
        if (cancelled) return;

        setApiNodes(
          Array.isArray(nodesPayload?.nodes)
            ? (nodesPayload.nodes as FloorplanApiNode[])
            : [],
        );
        setApiEdges(
          Array.isArray(edgesPayload?.edges)
            ? (edgesPayload.edges as FloorplanApiEdge[])
            : [],
        );
      } catch {
        if (!cancelled) setError("Could not load floor plan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [destinationId]);

  const { nodes, edges } = useMemo(
    () =>
      floorplanApiToFlow(apiNodes, apiEdges, {
        highlightNodeId,
      }),
    [apiNodes, apiEdges, highlightNodeId],
  );

  if (loading) {
    return (
      <div
        className={cn(
          "border-border bg-panel flex h-80 items-center justify-center rounded-xl border",
          className,
        )}
      >
        <Spinner className="text-brand-cta" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "border-border bg-panel text-muted-foreground flex h-80 items-center justify-center rounded-xl border px-4 text-center text-sm",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <FloorplanNodeKindLegend />
      <div className="border-border bg-panel relative h-80 w-full overflow-hidden rounded-xl border">
        <FloorplanReadonlyCanvas nodes={nodes} edges={edges} />
      </div>
    </div>
  );
}

export function RouteReportFloorplanPreview(
  props: RouteReportFloorplanPreviewProps,
) {
  return (
    <ReactFlowProvider>
      <FloorplanPreviewInner {...props} />
    </ReactFlowProvider>
  );
}
