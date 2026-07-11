"use client";

/**
 * Floorplan Editor Page
 * ---------------------
 * This page lets you build and edit indoor floor plans for a chosen destination (building).
 * It uses React Flow for the canvas: nodes are rooms/floors, doors, stairs, elevators, ramps;
 * edges are connections (e.g. corridors) between them. Data is persisted via the
 * /api/destination/floorplan/* APIs.
 *
 * How the code is structured:
 * 1. Types & constants – shapes for API data and React Flow nodes/edges.
 * 2. Node components – SmallIconNode, RampNode, FloorGroupNode (custom React Flow node UIs).
 * 3. Helpers – edge styling, node ordering (parent-before-child), insert/move helpers.
 * 4. FloorPlanContext – provides putNode(id, payload) so nodes can PATCH themselves (resize, ramp angle, etc.).
 * 5. FloorPlanInner – main state, data loading (destinations, nodes, edges), and all handlers.
 * 6. Handlers – onConnect (new edge), onNodeDragStop (move/resize + parent change), onAdd* (new node/floor),
 *    onDelete (remove selection or floor group), onUploadFloorplan (image for a floor).
 * 7. Bottom map – when a "door" node (linked to an outside node) is selected, shows that door’s lat/lng on a map.
 *
 * Data flow: Load destination list → pick destination → load nodes/edges for it → render React Flow.
 * Changes (add/move/connect/delete) call the API then update local nodes/edges state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeResizer,
  NodeToolbar,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type ResizeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Map as ReactMap, Marker } from "@vis.gl/react-maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowLeft,
  CircleDot,
  DoorOpen,
  Layers,
  MoveVertical,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import ComboboxSelect, { type ComboboxItem } from "@/components/ComboboxSelect";
import { HomeLogoLink } from "@/components/home-logo-link";
import { useMapStyle } from "@/hooks/use-map-style";
import { usePmtilesStyle } from "@/hooks/use-pmtiles-style";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-constants";
import { withBasePath } from "@/lib/base-path";
import {
  fetchEntranceMarkers,
  syncFloorplanEntrances,
} from "@/lib/floorplan-entrances";
import { panelClass } from "@/lib/panel-classes";
import type { OutsideNodeDetail } from "@/lib/types/map";
import {
  apiNodeToKind,
  BASE_GROUP_HEIGHT,
  BASE_GROUP_WIDTH,
  BASE_RAMP_HEIGHT,
  BASE_RAMP_WIDTH,
  BASE_SMALL_NODE_SIZE,
  EDGE_STROKE_DEFAULT,
  FLOORPLAN_EDGE_Z_INDEX as EDGE_Z_INDEX,
  getEdgeStyle,
  groupNodeStyle,
  NODE_KIND_META,
  smallNodeStyle,
  sortNodesParentBeforeChild,
  type FloorplanApiEdge as ApiEdge,
  type FloorplanApiNode as ApiNode,
  type FloorplanNodeKind as NodeKind,
} from "@/lib/floorplan-flow";
import { useRequireAdmin } from "@/hooks/use-require-admin";
import { Spinner } from "@/components/ui/spinner";

// -----------------------------------------------------------------------------
// Types: React Flow uses string ids; API uses numeric ids. NodeData carries kind and optional link to "outside" (door).
// Shared shapes (ApiNode, ApiEdge, NodeKind) and layout helpers come from @/lib/floorplan-flow.
// -----------------------------------------------------------------------------
type NodeData = {
  label: string;
  name?: string;
  kind?: NodeKind;
  rampValue?: number;
  nodeOutsideId?: number | null;
  isEntry?: boolean;
  isExit?: boolean;
  isDead?: boolean;
};
type AppNode = Node<NodeData>; // includes group nodes (floors) and normal nodes (smallIcon, ramp)
type AppEdge = Edge;
type DestinationOption = { id: number; name: string };

/** Four connection points: top, right, bottom, left. Each has both source and target handle so edges can attach from any side. */
const HANDLE_POSITIONS = [
  { id: "top" as const, position: Position.Top },
  { id: "right" as const, position: Position.Right },
  { id: "bottom" as const, position: Position.Bottom },
  { id: "left" as const, position: Position.Left },
];

/** Renders 8 handles (4 source + 4 target) so edges can connect from any of the four sides. */
function FourHandles() {
  return (
    <>
      {HANDLE_POSITIONS.flatMap(({ id, position }) => [
        <Handle key={`src-${id}`} type="source" id={id} position={position} />,
        <Handle key={`tgt-${id}`} type="target" id={id} position={position} />,
      ])}
    </>
  );
}

const ICON_SIZE = 12;

/** Renders the small icon (circle, door, layers, etc.) for a given node kind. */
function NodeKindIcon({ kind }: { kind: NodeKind }) {
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

const SELECTED_STYLE: CSSProperties = {
  outline: "3px solid #2563eb",
  outlineOffset: 2,
  boxShadow: "0 0 0 1px #2563eb",
};

const DEAD_NODE_STYLE: CSSProperties = {
  outline: "3px solid #dc2626",
  outlineOffset: 2,
  boxShadow: "0 0 0 1px #dc2626",
  opacity: 0.85,
};

// -----------------------------------------------------------------------------
// Node components: custom React Flow node types. Each calls floorPlan.putNode() on resize/drag to persist.
// -----------------------------------------------------------------------------

/** Generic/door/stairs/elevator node: resizable circle with icon and four handles. Resize end → putNode(width, height, x, y). */
function SmallIconNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { getNode, setNodes } = useReactFlow();
  const floorPlan = useFloorPlan();
  const kind = (data.kind ?? "generic") as NodeKind;
  const onResizeEnd = useCallback(
    (_: unknown, params?: ResizeParams) => {
      if (
        params &&
        typeof params.width === "number" &&
        typeof params.height === "number"
      ) {
        floorPlan?.putNode(id, {
          width: params.width,
          height: params.height,
          x: params.x ?? 0,
          y: params.y ?? 0,
        });
        return;
      }
      const n = getNode(id);
      if (!n) return;
      const w =
        typeof n.style?.width === "number"
          ? n.style.width
          : BASE_SMALL_NODE_SIZE;
      const h =
        typeof n.style?.height === "number"
          ? n.style.height
          : BASE_SMALL_NODE_SIZE;
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      floorPlan?.putNode(id, { width: w, height: h, x, y });
    },
    [id, getNode, floorPlan],
  );
  return (
    <>
      <NodeNameToolbar id={id} data={data} selected={!!selected} />
      <NodeResizer
        minWidth={BASE_SMALL_NODE_SIZE * 0.5}
        minHeight={BASE_SMALL_NODE_SIZE * 0.5}
        maxWidth={BASE_SMALL_NODE_SIZE * 4}
        maxHeight={BASE_SMALL_NODE_SIZE * 4}
        keepAspectRatio
        onResizeEnd={onResizeEnd}
        isVisible={selected}
      />
      <div
        style={{
          ...smallNodeStyle(kind),
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          ...(data.isDead ? DEAD_NODE_STYLE : undefined),
          ...(selected ? SELECTED_STYLE : undefined),
        }}
      >
        <NodeKindIcon kind={kind} />
        <FourHandles />
      </div>
    </>
  );
}

/** Ramp node: same as small node but with a range slider for incline (0–90°). Resize and incline changes → putNode. */
function RampNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { getNode, setNodes } = useReactFlow();
  const floorPlan = useFloorPlan();
  const value = Math.min(90, Math.max(0, data.rampValue ?? 0));

  const onResizeEnd = useCallback(
    (_: unknown, params?: ResizeParams) => {
      if (
        params &&
        typeof params.width === "number" &&
        typeof params.height === "number"
      ) {
        floorPlan?.putNode(id, {
          width: params.width,
          height: params.height,
          x: params.x ?? 0,
          y: params.y ?? 0,
        });
        return;
      }
      const n = getNode(id);
      if (!n) return;
      const w =
        typeof n.style?.width === "number" ? n.style.width : BASE_RAMP_WIDTH;
      const h =
        typeof n.style?.height === "number" ? n.style.height : BASE_RAMP_HEIGHT;
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      floorPlan?.putNode(id, { width: w, height: h, x, y });
    },
    [id, getNode, floorPlan],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const num = Number(e.target.value);
      if (!Number.isFinite(num)) return;
      const clamped = Math.min(90, Math.max(0, num));
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, rampValue: clamped } } : n,
        ),
      );
      floorPlan?.putNode(id, { incline: clamped });
    },
    [id, setNodes, floorPlan],
  );

  return (
    <>
      <NodeNameToolbar id={id} data={data} selected={!!selected} />
      <NodeResizer
        minWidth={BASE_RAMP_WIDTH * 0.5}
        minHeight={BASE_RAMP_HEIGHT * 0.5}
        maxWidth={BASE_RAMP_WIDTH * 4}
        maxHeight={BASE_RAMP_HEIGHT * 4}
        keepAspectRatio
        onResizeEnd={onResizeEnd}
        isVisible={selected}
      />
      <div
        style={{
          ...smallNodeStyle("ramp"),
          width: "100%",
          minWidth: 0,
          height: "100%",
          minHeight: 0,
          padding: "4px 6px",
          flexDirection: "column",
          gap: 2,
          ...(data.isDead ? DEAD_NODE_STYLE : undefined),
          ...(selected ? SELECTED_STYLE : undefined),
        }}
      >
        <span className="nodrag flex items-center justify-center">
          <NodeKindIcon kind="ramp" />
        </span>
        <input
          type="range"
          min={0}
          max={90}
          step={1}
          value={value}
          onChange={onChange}
          onClick={(e) => e.stopPropagation()}
          className="nodrag w-full accent-slate-900"
          style={{ height: 6, margin: 0 }}
        />
        <span
          className="nodrag text-[10px] font-bold leading-none"
          style={{ color: "#0f172a" }}
        >
          {value}°
        </span>
        <FourHandles />
      </div>
    </>
  );
}

/** Floor (group) node: large resizable rectangle, optional background image. Children nodes use parentId so they move with the floor. */
function FloorGroupNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { getNode, setNodes } = useReactFlow();
  const floorPlan = useFloorPlan();
  const node = getNode(id);
  const style = node?.style ?? {};
  const w = (style?.width as number) ?? BASE_GROUP_WIDTH;
  const h = (style?.height as number) ?? BASE_GROUP_HEIGHT;
  const selected = node?.selected ?? false;

  const onResizeEnd = useCallback(
    (_: unknown, params?: ResizeParams) => {
      if (
        params &&
        typeof params.width === "number" &&
        typeof params.height === "number"
      ) {
        floorPlan?.putNode(id, {
          width: params.width,
          height: params.height,
          x: params.x ?? 0,
          y: params.y ?? 0,
        });
        return;
      }
      const n = getNode(id);
      if (!n) return;
      const nw =
        typeof n.style?.width === "number" ? n.style.width : BASE_GROUP_WIDTH;
      const nh =
        typeof n.style?.height === "number"
          ? n.style.height
          : BASE_GROUP_HEIGHT;
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      floorPlan?.putNode(id, { width: nw, height: nh, x, y });
    },
    [id, getNode, floorPlan],
  );

  return (
    <>
      <NodeNameToolbar
        id={id}
        data={data}
        selected={selected}
        placeholder="Floor name"
      />
      <NodeResizer
        minWidth={BASE_GROUP_WIDTH * 0.5}
        minHeight={BASE_GROUP_HEIGHT * 0.5}
        maxWidth={BASE_GROUP_WIDTH * 4}
        maxHeight={BASE_GROUP_HEIGHT * 4}
        keepAspectRatio
        onResizeEnd={onResizeEnd}
        isVisible={selected}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          border: selected ? "4px solid #2563eb" : "2px solid #999",
          backgroundColor: selected ? "#2563eb14" : "#0f172a0d",
          boxShadow: selected
            ? "0 0 0 2px #2563eb, 0 4px 12px rgba(37,99,235,0.25)"
            : undefined,
          backgroundImage: style?.backgroundImage as string | undefined,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <FourHandles />
    </>
  );
}

// -----------------------------------------------------------------------------
// Node list helpers: React Flow expects parents to appear before children in the nodes array so dragging a floor moves its children correctly.
// -----------------------------------------------------------------------------

/** Insert newNode into the list; if it has parentId, place it right after the parent so React Flow keeps parent-before-child order (children move with parent). */
function insertNodeWithParent<T extends { id: string; parentId?: string }>(
  nodes: T[],
  newNode: T,
): T[] {
  const parentId = newNode.parentId;
  if (!parentId) return [...nodes, newNode];
  const idx = nodes.findIndex((n) => n.id === parentId);
  if (idx === -1) return [...nodes, newNode];
  return [...nodes.slice(0, idx + 1), newNode, ...nodes.slice(idx + 1)];
}

/** Move the node with movedId to right after the node with parentId so React Flow keeps parent-before-child order. */
function moveNodeAfterParent<T extends { id: string }>(
  nodes: T[],
  movedId: string,
  parentId: string,
): T[] {
  const movedIdx = nodes.findIndex((n) => n.id === movedId);
  const parentIdx = nodes.findIndex((n) => n.id === parentId);
  if (movedIdx === -1 || parentIdx === -1) return nodes;
  if (movedIdx === parentIdx + 1) return nodes; // already in place
  const node = nodes[movedIdx];
  const without = [...nodes.slice(0, movedIdx), ...nodes.slice(movedIdx + 1)];
  const newParentIdx = without.findIndex((n) => n.id === parentId);
  return [
    ...without.slice(0, newParentIdx + 1),
    node,
    ...without.slice(newParentIdx + 1),
  ];
}

const initialNodes: AppNode[] = [];
const initialEdges: AppEdge[] = [];

// -----------------------------------------------------------------------------
// FloorPlan context: nodes (SmallIconNode, RampNode, FloorGroupNode) call putNode(id, payload) to persist position, size, parent, incline, isEntry, isExit.
// -----------------------------------------------------------------------------
type FloorPlanContextValue = {
  putNode: (id: string, payload: Record<string, unknown>) => Promise<void>;
};
const FloorPlanContext = createContext<FloorPlanContextValue | null>(null);

function useFloorPlan() {
  const ctx = useContext(FloorPlanContext);
  return ctx;
}

/** Name input shown above a selected node; persists on blur or Enter. */
function NodeNameToolbar({
  id,
  data,
  selected,
  placeholder = "Node name",
}: {
  id: string;
  data: NodeData;
  selected: boolean;
  placeholder?: string;
}) {
  const floorPlan = useFloorPlan();
  const [localName, setLocalName] = useState(data.name ?? "");

  useEffect(() => {
    setLocalName(data.name ?? "");
  }, [data.name, id]);

  const saveName = useCallback(() => {
    const trimmed = localName.trim();
    const nextName = trimmed.length > 0 ? trimmed : null;
    if ((data.name ?? "") === (nextName ?? "")) return;
    void floorPlan?.putNode(id, { name: nextName });
  }, [data.name, floorPlan, id, localName]);

  return (
    <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
      <input
        type="text"
        value={localName}
        placeholder={placeholder}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => saveName()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveName();
            e.currentTarget.blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="nodrag nopan min-w-[140px] max-w-[220px] rounded-lg border border-border bg-panel px-2 py-1 text-xs text-panel-foreground shadow-md focus:border-brand-cta focus:outline-none focus:ring-2 focus:ring-brand-cta/30"
      />
    </NodeToolbar>
  );
}

// -----------------------------------------------------------------------------
// FloorPlanInner: main component. Holds all state, loads destinations and floorplan data, and wires React Flow to API.
// -----------------------------------------------------------------------------
function FloorPlanInner() {
  const searchParams = useSearchParams();
  const destinationIdFromUrl = useMemo(() => {
    const parsed = Number(searchParams.get("destinationId"));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const fromDestinationEditor =
    searchParams.get("from") === "destination-editor";

  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(initialEdges);
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [selectedDestinationId, setSelectedDestinationId] = useState<
    number | null
  >(null);
  const [isLoadingDestinations, setIsLoadingDestinations] = useState(false);
  const [isLoadingFloorplan, setIsLoadingFloorplan] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>("None");
  const [isUploading, setIsUploading] = useState(false);
  const [entranceMarkers, setEntranceMarkers] = useState<OutsideNodeDetail[]>(
    [],
  );
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);

  // Map style (dark/light) and view state; when a door is selected we pan to its outside node lat/lng.
  const { isDark, mapStyle } = useMapStyle();
  const { baseStyle } = usePmtilesStyle({ stylePath: mapStyle });
  const canRenderMap = !!baseStyle;

  /** Selected indoor feature node (door, stairs, elevator, ramp). */
  const selectedFeatureNode = useMemo(() => {
    const sel = nodes.filter((n) => n.selected);
    if (sel.length !== 1) return null;
    const n = sel[0];
    if (n.type === "floor") return null;
    const kind = n.data?.kind;
    if (!kind || kind === "generic") return null;
    return n;
  }, [nodes]);

  const selectedDoorNode = useMemo(() => {
    if (selectedFeatureNode?.data?.nodeOutsideId == null) return null;
    return selectedFeatureNode;
  }, [selectedFeatureNode]);

  const selectedOutsideNodePos = useMemo(() => {
    const outsideId = selectedDoorNode?.data?.nodeOutsideId;
    if (outsideId == null) return null;
    const match = entranceMarkers.find((m) => m.id === outsideId);
    return match ? { lat: match.lat, lng: match.lng } : null;
  }, [selectedDoorNode, entranceMarkers]);

  const defaultMapCenter = {
    longitude: DEFAULT_CENTER.lng,
    latitude: DEFAULT_CENTER.lat,
    zoom: DEFAULT_ZOOM,
  };
  const [mapViewState, setMapViewState] = useState<{
    longitude: number;
    latitude: number;
    zoom: number;
  }>(defaultMapCenter);

  useEffect(() => {
    if (selectedOutsideNodePos) {
      setMapViewState({
        longitude: selectedOutsideNodePos.lng,
        latitude: selectedOutsideNodePos.lat,
        zoom: 18,
      });
      return;
    }
    if (entranceMarkers.length > 0) {
      const lng =
        entranceMarkers.reduce((sum, m) => sum + m.lng, 0) /
        entranceMarkers.length;
      const lat =
        entranceMarkers.reduce((sum, m) => sum + m.lat, 0) /
        entranceMarkers.length;
      setMapViewState({ longitude: lng, latitude: lat, zoom: 17 });
      return;
    }
    setMapViewState(defaultMapCenter);
  }, [selectedOutsideNodePos, entranceMarkers]);

  // Custom node types for React Flow: ramp, floor (group), smallIcon (generic/door/stairs/elevator).
  const nodeTypes = useMemo(
    () => ({
      ramp: RampNode,
      floor: FloorGroupNode,
      smallIcon: SmallIconNode,
    }),
    [],
  );

  const rf = useReactFlow();

  /** Flow position at the center of the visible viewport (used when adding a node/floor with no selected floor). */
  const getCenterFlowPosition = useCallback((): { x: number; y: number } => {
    const el = flowContainerRef.current;
    if (!el) return { x: 100, y: 300 };
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return rf.screenToFlowPosition({ x: centerX, y: centerY });
  }, [rf]);

  /** Position and optional parent for adding a new node (center of viewport or center of selected floor) */
  const getAddNodePosition = useCallback(
    (
      nodeWidth: number,
      nodeHeight: number,
    ): { x: number; y: number; parentId?: string } => {
      const floor = selectedGroupId
        ? nodes.find((n) => n.id === selectedGroupId && n.type === "floor")
        : null;
      if (floor) {
        const w = (floor.style?.width as number) ?? BASE_GROUP_WIDTH;
        const h = (floor.style?.height as number) ?? BASE_GROUP_HEIGHT;
        return {
          x: w / 2 - nodeWidth / 2,
          y: h / 2 - nodeHeight / 2,
          parentId: floor.id,
        };
      }
      const pos = getCenterFlowPosition();
      return { x: pos.x, y: pos.y };
    },
    [selectedGroupId, nodes, getCenterFlowPosition],
  );

  /**
   * Persist a single node update to the API (PUT /api/destination/floorplan/nodes) and then update local state.
   * Payload can include: x, y, width, height, parentNodeInsideId, imageUrl, incline, isEntry, isExit, etc.
   * Used by: node resize end, drag stop, ramp slider, door entry/exit toggles, floorplan image upload.
   */
  const putNode = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return;
      const body: Record<string, unknown> = { id: numId, ...payload };
      const res = await fetch(
        withBasePath("/api/destination/floorplan/nodes"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) return;
      const hasPosition = "x" in payload || "y" in payload;
      const hasParent = "parentNodeInsideId" in payload;
      const hasSize = "width" in payload || "height" in payload;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n };
          if (hasPosition && "x" in payload && "y" in payload) {
            next.position = {
              x: Number(payload.x),
              y: Number(payload.y),
            };
          }
          if (hasParent) {
            next.parentId =
              payload.parentNodeInsideId != null
                ? String(payload.parentNodeInsideId)
                : undefined;
            next.extent = next.parentId ? "parent" : undefined;
          }
          if (hasSize) {
            const style = { ...(next.style ?? {}) };
            if (typeof payload.width === "number") style.width = payload.width;
            if (typeof payload.height === "number")
              style.height = payload.height;
            next.style = style;
          }
          const dataKeys = [
            "isEntry",
            "isExit",
            "isDead",
            "incline",
            "rampValue",
          ];
          const dataUpdate: Partial<NodeData> = {};
          for (const k of dataKeys) {
            if (k in payload)
              (dataUpdate as Record<string, unknown>)[k] = payload[k];
          }
          if (Object.keys(dataUpdate).length)
            next.data = { ...n.data, ...dataUpdate };
          if ("name" in payload) {
            const nameVal = payload.name;
            next.data = {
              ...next.data,
              name:
                nameVal == null || String(nameVal).trim() === ""
                  ? undefined
                  : String(nameVal).trim(),
            };
          }
          return next;
        }),
      );
    },
    [setNodes],
  );

  const destinationItems = useMemo<ComboboxItem<number>[]>(
    () => destinations.map((d) => ({ value: d.id, label: d.name })),
    [destinations],
  );

  // Load destination list once on mount (for the Building dropdown).
  useEffect(() => {
    let cancelled = false;

    async function loadDestinations() {
      try {
        setIsLoadingDestinations(true);
        const res = await fetch(withBasePath("/api/destination"));
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.destinations || cancelled) return;

        const list = (
          payload.destinations as Array<{ id: unknown; name: unknown }>
        )
          .map((d) => ({
            id: Number(d.id),
            name: String(d.name ?? ""),
          }))
          .filter(
            (d) => Number.isInteger(d.id) && d.id > 0 && d.name.length > 0,
          );

        setDestinations(list);
        const preferredId =
          destinationIdFromUrl != null &&
          list.some((d) => d.id === destinationIdFromUrl)
            ? destinationIdFromUrl
            : (list[0]?.id ?? null);
        setSelectedDestinationId((prev) => prev ?? preferredId);
      } finally {
        if (!cancelled) setIsLoadingDestinations(false);
      }
    }

    void loadDestinations();

    return () => {
      cancelled = true;
    };
  }, [destinationIdFromUrl]);

  // When selectedDestinationId changes: fetch nodes and edges for that destination, convert API shape to React Flow shape, sort parents before children.
  useEffect(() => {
    if (selectedDestinationId == null) {
      setNodes([]);
      setEdges([]);
      setEntranceMarkers([]);
      setSelectedGroupId("None");
      return;
    }

    let cancelled = false;
    setIsLoadingFloorplan(true);

    (async () => {
      try {
        const [nodesRes, edgesRes] = await Promise.all([
          fetch(
            withBasePath(
              `/api/destination/floorplan/nodes?destinationId=${selectedDestinationId}`,
            ),
          ),
          fetch(
            withBasePath(
              `/api/destination/floorplan/edges?destinationId=${selectedDestinationId}`,
            ),
          ),
        ]);
        const nodesPayload = await nodesRes.json().catch(() => null);
        const edgesPayload = await edgesRes.json().catch(() => null);
        if (cancelled) return;
        if (!nodesRes.ok || !nodesPayload?.nodes) {
          setNodes([]);
          setEdges([]);
          return;
        }

        let apiNodes = nodesPayload.nodes as ApiNode[];
        apiNodes = (await syncFloorplanEntrances(
          selectedDestinationId,
          apiNodes,
        )) as ApiNode[];
        const markers = await fetchEntranceMarkers(selectedDestinationId);
        if (cancelled) return;
        setEntranceMarkers(markers);

        const flowNodes: AppNode[] = apiNodes.map((row) => {
          const kind = apiNodeToKind(row);
          const id = String(row.id);
          const position = { x: row.x, y: row.y };
          const parentId =
            row.parentNodeInsideId != null
              ? String(row.parentNodeInsideId)
              : undefined;
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
              isEntry: row.isEntry,
              isExit: row.isExit,
              name: row.name?.trim() || undefined,
              isDead: row.isDead,
            },
            style: { ...smallNodeStyle(kind), width: size, height: smallH },
            zIndex: 20,
          };
        });

        setNodes(sortNodesParentBeforeChild(flowNodes));

        // Build edges: map API direction/handles to React Flow edge; style by same-floor vs cross-floor.
        const apiEdges = (edgesPayload?.edges ?? []) as ApiEdge[];
        const parentFromApi = (nodeId: string) =>
          apiNodes.find((n) => String(n.id) === nodeId)?.parentNodeInsideId ??
          null;
        const flowEdges: AppEdge[] = apiEdges.map((e) => {
          const a = String(e.nodeAId);
          const b = String(e.nodeBId);
          const source = e.direction ? a : b;
          const target = e.direction ? b : a;
          const sourceHandle = e.sourceHandle ?? "right";
          const targetHandle = e.targetHandle ?? "left";
          return {
            id: String(e.id),
            source,
            target,
            sourceHandle,
            targetHandle,
            type: "smoothstep",
            zIndex: EDGE_Z_INDEX,
            style: getEdgeStyle(parentFromApi, source, target),
          };
        });
        setEdges(flowEdges);
        setSelectedGroupId("None");
      } finally {
        if (!cancelled) setIsLoadingFloorplan(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDestinationId, setNodes, setEdges]);

  /** User connects two nodes: POST new edge to API, then add edge to state (or update handle if same source–target already exists). */
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (selectedDestinationId == null) return;
      const from = connection.source;
      const to = connection.target;
      if (!from || !to) return;
      const res = await fetch(
        withBasePath("/api/destination/floorplan/edges"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinationId: selectedDestinationId,
            from: Number(from),
            to: Number(to),
            biDirectional: true,
            sourceHandle: connection.sourceHandle ?? undefined,
            targetHandle: connection.targetHandle ?? undefined,
          }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.id) return;
      const sourceHandle = connection.sourceHandle ?? undefined;
      const targetHandle = connection.targetHandle ?? undefined;
      const parentFromNodes = (nodeId: string) =>
        nodes.find((n) => n.id === nodeId)?.parentId ?? null;
      const newEdge: AppEdge = {
        id: String(payload.id),
        source: from,
        target: to,
        sourceHandle,
        targetHandle,
        type: "smoothstep",
        zIndex: EDGE_Z_INDEX,
        style: getEdgeStyle(parentFromNodes, from, to),
      };
      setEdges((eds) => {
        const existing = eds.find((e) => e.source === from && e.target === to);
        if (existing)
          return eds.map((e) =>
            e.id === existing.id
              ? { ...e, sourceHandle, targetHandle, style: newEdge.style }
              : e,
          );
        return [...eds, newEdge];
      });
    },
    [selectedDestinationId, nodes, setEdges],
  );

  /** Double-click an edge: DELETE edge via API and remove from state. */
  const onEdgeDoubleClick = useCallback(
    async (_evt: unknown, edge: AppEdge) => {
      if (selectedDestinationId == null) return;
      const res = await fetch(
        withBasePath("/api/destination/floorplan/edges"),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: edge.id }),
        },
      );
      if (!res.ok) return;
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [selectedDestinationId, setEdges],
  );

  /** Wrap React Flow's onNodesChange: when a node is removed, also remove any edges that referenced it. */
  const onNodesChangeWithEdgeCleanup = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const removedIds = new Set(
        changes
          .filter(
            (c): c is { id: string; type: "remove" } => c.type === "remove",
          )
          .map((c) => c.id),
      );
      onNodesChange(changes);
      if (removedIds.size > 0) {
        setEdges((eds) =>
          eds.filter(
            (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
          ),
        );
      }
    },
    [onNodesChange, setEdges],
  );

  /**
   * When the user stops dragging a node: compute which floor (if any) it's over; update parentId and position (relative if inside floor);
   * then persist via putNode (x, y, parentNodeInsideId, width, height). Floor nodes only persist their own position/size.
   * Uses setTimeout(0) so our parent/position update runs after React Flow's internal onNodesChange.
   */
  /** Allow dragging child nodes past the floor edge; extent is restored on drag stop. */
  const onNodeDragStart = useCallback(
    (_evt: unknown, node: AppNode) => {
      if (node.type === "floor" || !node.parentId) return;
      setNodes((nds) =>
        nds.map((n) => (n.id === node.id ? { ...n, extent: undefined } : n)),
      );
    },
    [setNodes],
  );

  // Defer our update so it runs after React Flow's onNodesChange (position) so we don't get overwritten.
  const onNodeDragStop = useCallback(
    (_evt: unknown, node: AppNode) => {
      const internal = rf.getInternalNode(node.id);
      if (!internal) return;

      const abs = internal.internals.positionAbsolute;

      // Floor nodes: persist position and dimensions only (no parent/child logic).
      if (node.type === "floor") {
        const numId = Number(node.id);
        if (Number.isInteger(numId) && numId > 0) {
          const w =
            typeof node.style?.width === "number"
              ? node.style.width
              : BASE_GROUP_WIDTH;
          const h =
            typeof node.style?.height === "number"
              ? node.style.height
              : BASE_GROUP_HEIGHT;
          void putNode(node.id, {
            x: abs.x,
            y: abs.y,
            width: w,
            height: h,
          });
        }
        return;
      }

      // Assign parent from the node center so dragging mostly outside a floor detaches cleanly.
      const nodeW =
        node.measured?.width ??
        (typeof node.style?.width === "number"
          ? node.style.width
          : BASE_SMALL_NODE_SIZE);
      const nodeH =
        node.measured?.height ??
        (typeof node.style?.height === "number"
          ? node.style.height
          : BASE_SMALL_NODE_SIZE);
      const cx = abs.x + nodeW / 2;
      const cy = abs.y + nodeH / 2;

      let groupId: string | null = null;
      const allFloors = rf.getNodes().filter((n) => n.type === "floor");
      for (const floor of allFloors) {
        const fi = rf.getInternalNode(floor.id);
        if (!fi?.internals.positionAbsolute) continue;
        const fw = (floor.style?.width as number) ?? BASE_GROUP_WIDTH;
        const fh = (floor.style?.height as number) ?? BASE_GROUP_HEIGHT;
        const fx = fi.internals.positionAbsolute.x;
        const fy = fi.internals.positionAbsolute.y;
        if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) {
          groupId = floor.id;
          break;
        }
      }

      const parentInternal = groupId ? rf.getInternalNode(groupId) : null;
      const parentAbs = parentInternal?.internals.positionAbsolute;
      const relative = parentAbs
        ? { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y }
        : null;

      const nodeId = node.id;
      const hadParent = !!node.parentId;

      const applyParentUpdate = () => {
        if (groupId) {
          if (node.parentId !== groupId) {
            setNodes((nds) => {
              const updated = nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      parentId: groupId,
                      position: relative ?? { x: 0, y: 0 },
                      extent: "parent" as const,
                    }
                  : n,
              );
              return moveNodeAfterParent(updated, nodeId, groupId);
            });
          } else {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      extent: "parent" as const,
                      position: relative ?? n.position,
                    }
                  : n,
              ),
            );
          }
        } else if (!groupId && hadParent) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    parentId: undefined,
                    extent: undefined,
                    position: { x: abs.x, y: abs.y },
                  }
                : n,
            ),
          );
        }
      };

      // Run after React Flow's onNodesChange so our parentId/position wins
      setTimeout(applyParentUpdate, 0);

      // Persist position, dimensions, and parent for nodes with a numeric id (from API)
      const numId = Number(nodeId);
      if (Number.isInteger(numId) && numId > 0) {
        const w =
          typeof node.style?.width === "number" ? node.style.width : undefined;
        const h =
          typeof node.style?.height === "number"
            ? node.style.height
            : undefined;
        const sizePayload =
          w != null && h != null ? ({ width: w, height: h } as const) : {};
        if (groupId) {
          void putNode(nodeId, {
            x: relative!.x,
            y: relative!.y,
            parentNodeInsideId: Number(groupId),
            ...sizePayload,
          });
        } else if (hadParent) {
          void putNode(nodeId, {
            x: abs.x,
            y: abs.y,
            parentNodeInsideId: null,
            ...sizePayload,
          });
        } else {
          void putNode(nodeId, { x: abs.x, y: abs.y, ...sizePayload });
        }
      }
    },
    [rf, setNodes, putNode],
  );

  /** Add a generic small node: POST to nodes API with position (center or selected floor center), then insert into nodes list. */
  const onAddNode = useCallback(async () => {
    if (selectedDestinationId == null) return;
    const { x, y, parentId } = getAddNodePosition(24, 24);
    const body: Record<string, unknown> = {
      destinationId: selectedDestinationId,
      x,
      y,
      width: BASE_SMALL_NODE_SIZE,
      height: BASE_SMALL_NODE_SIZE,
    };
    if (parentId) body.parentNodeInsideId = Number(parentId);
    const res = await fetch(withBasePath("/api/destination/floorplan/nodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.id) return;
    const id = String(payload.id);
    const newNode: AppNode = {
      id,
      type: "smallIcon",
      position: { x: payload.x, y: payload.y },
      parentId,
      extent: parentId ? "parent" : undefined,
      data: { label: "N", kind: "generic" },
      style: {
        ...smallNodeStyle("generic"),
        width: BASE_SMALL_NODE_SIZE,
        height: BASE_SMALL_NODE_SIZE,
      },
      zIndex: 20,
    };
    setNodes((nds) => insertNodeWithParent(nds, newNode));
  }, [selectedDestinationId, setNodes, getAddNodePosition]);

  /** Add a new floor (group) node at viewport center; POST with isGroup: true. Then set it as selected group for upload. */
  const onAddGroup = useCallback(async () => {
    if (selectedDestinationId == null) return;
    const position = getCenterFlowPosition();
    const res = await fetch(withBasePath("/api/destination/floorplan/nodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationId: selectedDestinationId,
        x: position.x,
        y: position.y,
        isGroup: true,
        width: BASE_GROUP_WIDTH,
        height: BASE_GROUP_HEIGHT,
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.id) return;
    const id = String(payload.id);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "floor",
        position: { x: payload.x, y: payload.y },
        data: { label: `Floor ${id}` },
        style: {
          ...groupNodeStyle(undefined, BASE_GROUP_WIDTH, BASE_GROUP_HEIGHT),
          border: "none",
          background: "transparent",
        },
        zIndex: 0,
      },
    ]);
    setSelectedGroupId(id);
  }, [selectedDestinationId, setNodes, getCenterFlowPosition]);

  /** Open file picker for floorplan image (triggered by "Upload Floorplan" button; uses hidden input). */
  const onPickFloorplan = useCallback(() => {
    if (!selectedDestinationId) {
      toast.error("Select a destination first.");
      return;
    }
    if (!selectedGroupId) {
      toast.error("Select a floor group first.");
      return;
    }
    uploadInputRef.current?.click();
  }, [selectedDestinationId, selectedGroupId]);

  /** Upload chosen file: POST to floorplan API, then PUT node imageUrl for selected group and update local node style. */
  const onUploadFloorplan = useCallback(
    async (evt: ChangeEvent<HTMLInputElement>) => {
      const file = evt.target.files?.[0];
      evt.target.value = "";
      if (!file) return;

      if (!selectedGroupId) {
        toast.error("Select a floor group first.");
        return;
      }
      if (!selectedDestinationId) {
        toast.error("Select a destination first.");
        return;
      }

      try {
        setIsUploading(true);

        const form = new FormData();
        form.append("file", file);
        form.append("destinationId", String(selectedDestinationId));

        const res = await fetch(withBasePath("/api/destination/floorplan"), {
          method: "POST",
          body: form,
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok || !payload?.url) {
          toast.error(payload?.error ?? "Upload failed.");
          return;
        }

        const floorplanUrl = String(payload.url);
        if (selectedGroupId) {
          const nid = Number(selectedGroupId);
          if (Number.isInteger(nid) && nid > 0) {
            await fetch(withBasePath("/api/destination/floorplan/nodes"), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: nid, imageUrl: floorplanUrl }),
            });
          }
        }
        setNodes((nds) =>
          nds.map((n) =>
            n.id === selectedGroupId && n.type === "floor"
              ? {
                  ...n,
                  style: {
                    ...groupNodeStyle(floorplanUrl),
                    ...(n.style ?? {}),
                    backgroundImage: `url(${withBasePath(floorplanUrl)})`,
                    backgroundSize: "contain",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  },
                }
              : n,
          ),
        );
      } catch {
        toast.error("Upload failed.");
      } finally {
        setIsUploading(false);
      }
    },
    [selectedDestinationId, selectedGroupId, setNodes],
  );

  /** Add stairs node (same as Add Node but with isStairs: true and kind "stairs"). */
  const onAddStairs = useCallback(async () => {
    if (selectedDestinationId == null) return;
    const { x, y, parentId } = getAddNodePosition(24, 24);
    const body: Record<string, unknown> = {
      destinationId: selectedDestinationId,
      x,
      y,
      isStairs: true,
      width: BASE_SMALL_NODE_SIZE,
      height: BASE_SMALL_NODE_SIZE,
    };
    if (parentId) body.parentNodeInsideId = Number(parentId);
    const res = await fetch(withBasePath("/api/destination/floorplan/nodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.id) return;
    const id = String(payload.id);
    const newNode: AppNode = {
      id,
      type: "smallIcon",
      position: { x: payload.x, y: payload.y },
      parentId,
      extent: parentId ? "parent" : undefined,
      data: { label: "S", kind: "stairs" },
      style: {
        ...smallNodeStyle("stairs"),
        width: BASE_SMALL_NODE_SIZE,
        height: BASE_SMALL_NODE_SIZE,
      },
      zIndex: 20,
    };
    setNodes((nds) => insertNodeWithParent(nds, newNode));
  }, [selectedDestinationId, setNodes, getAddNodePosition]);

  /** Add elevator node (same pattern with isElevator: true). */
  const onAddElevator = useCallback(async () => {
    if (selectedDestinationId == null) return;
    const { x, y, parentId } = getAddNodePosition(24, 24);
    const body: Record<string, unknown> = {
      destinationId: selectedDestinationId,
      x,
      y,
      isElevator: true,
      width: BASE_SMALL_NODE_SIZE,
      height: BASE_SMALL_NODE_SIZE,
    };
    if (parentId) body.parentNodeInsideId = Number(parentId);
    const res = await fetch(withBasePath("/api/destination/floorplan/nodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.id) return;
    const id = String(payload.id);
    const newNode: AppNode = {
      id,
      type: "smallIcon",
      position: { x: payload.x, y: payload.y },
      parentId,
      extent: parentId ? "parent" : undefined,
      data: { label: "E", kind: "elevator" },
      style: {
        ...smallNodeStyle("elevator"),
        width: BASE_SMALL_NODE_SIZE,
        height: BASE_SMALL_NODE_SIZE,
      },
      zIndex: 20,
    };
    setNodes((nds) => insertNodeWithParent(nds, newNode));
  }, [selectedDestinationId, setNodes, getAddNodePosition]);

  /** Add ramp node: larger default size, incline 0, type "ramp". */
  const onAddRamp = useCallback(async () => {
    if (selectedDestinationId == null) return;
    const { x, y, parentId } = getAddNodePosition(88, 40);
    const body: Record<string, unknown> = {
      destinationId: selectedDestinationId,
      x,
      y,
      isRamp: true,
      incline: 0,
      width: BASE_RAMP_WIDTH,
      height: BASE_RAMP_HEIGHT,
    };
    if (parentId) body.parentNodeInsideId = Number(parentId);
    const res = await fetch(withBasePath("/api/destination/floorplan/nodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.id) return;
    const id = String(payload.id);
    const newNode: AppNode = {
      id,
      type: "ramp",
      position: { x: payload.x, y: payload.y },
      parentId,
      extent: parentId ? "parent" : undefined,
      data: { label: "R", kind: "ramp", rampValue: 0 },
      style: { width: BASE_RAMP_WIDTH, height: BASE_RAMP_HEIGHT, zIndex: 20 },
      zIndex: 20,
    };
    setNodes((nds) => insertNodeWithParent(nds, newNode));
  }, [selectedDestinationId, setNodes, getAddNodePosition]);

  /**
   * Delete: (1) If nodes/edges are selected on canvas → delete those (door nodes are only unparented, not deleted).
   * (2) Else if a floor is selected in dropdown → delete that floor and all its non-door children; door children are unparented.
   */
  const onDelete = useCallback(async () => {
    const groupId =
      selectedGroupId && selectedGroupId !== "None" ? selectedGroupId : null;
    const group = groupId
      ? nodes.find((n) => n.id === groupId && n.type === "floor")
      : null;

    const isDoorNode = (n: AppNode) => n.data?.nodeOutsideId != null;

    // Prefer canvas selection: delete selected nodes/edges first; otherwise delete selected group from dropdown
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedEdges = edges.filter((e) => e.selected);
    const hasCanvasSelection =
      selectedNodes.length > 0 || selectedEdges.length > 0;

    if (hasCanvasSelection) {
      const selectedDoorNodes = selectedNodes.filter(isDoorNode);
      const selectedNonDoorNodes = selectedNodes.filter((n) => !isDoorNode(n));
      const nodeIdsToRemove = new Set(
        selectedNonDoorNodes
          .map((n) => n.id)
          .filter((id): id is string => id != null),
      );
      const edgeIdsToRemove = new Set(
        selectedEdges.map((e) => e.id).filter((id): id is string => id != null),
      );

      for (const node of selectedDoorNodes) {
        const internal = rf.getInternalNode(node.id);
        const abs = internal?.internals.positionAbsolute ?? node.position;
        const absX = "x" in abs ? abs.x : (node.position?.x ?? 0);
        const absY = "y" in abs ? abs.y : (node.position?.y ?? 0);
        await putNode(node.id, {
          x: absX,
          y: absY,
          parentNodeInsideId: null,
        });
      }

      for (const id of nodeIdsToRemove) {
        const nid = Number(id);
        if (Number.isInteger(nid) && nid > 0) {
          await fetch(withBasePath("/api/destination/floorplan/nodes"), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: nid }),
          });
        }
      }
      for (const id of edgeIdsToRemove) {
        const eid = Number(id);
        if (Number.isInteger(eid) && eid > 0) {
          await fetch(withBasePath("/api/destination/floorplan/edges"), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: eid }),
          });
        }
      }

      setNodes((nds) =>
        nds
          .filter((n) => !nodeIdsToRemove.has(n.id))
          .map((n) => {
            const door = selectedDoorNodes.find((d) => d.id === n.id);
            if (!door) return n;
            const internal = rf.getInternalNode(n.id);
            const abs = internal?.internals.positionAbsolute ?? n.position;
            return {
              ...n,
              parentId: undefined,
              extent: undefined,
              position: {
                x: "x" in abs ? abs.x : (n.position?.x ?? 0),
                y: "y" in abs ? abs.y : (n.position?.y ?? 0),
              },
            };
          }),
      );
      setEdges((eds) =>
        eds.filter(
          (e) =>
            !edgeIdsToRemove.has(e.id) &&
            !nodeIdsToRemove.has(e.source) &&
            !nodeIdsToRemove.has(e.target),
        ),
      );
      if (selectedGroupId && nodeIdsToRemove.has(selectedGroupId)) {
        setSelectedGroupId("None");
      }
      return;
    }

    if (group && groupId) {
      const childIds = nodes
        .filter((n) => n.parentId === groupId && n.id != null)
        .map((n) => n.id as string);
      const doorChildren = nodes.filter(
        (n) => n.parentId === groupId && n.id != null && isDoorNode(n),
      );
      const nonDoorChildIds = new Set(
        childIds.filter((id) => !doorChildren.some((d) => d.id === id)),
      );

      // Detach door nodes (PUT parentNodeInsideId: null, absolute position); do not delete them
      for (const node of doorChildren) {
        const internal = rf.getInternalNode(node.id);
        const abs = internal?.internals.positionAbsolute ?? node.position;
        const absX = "x" in abs ? abs.x : (node.position?.x ?? 0);
        const absY = "y" in abs ? abs.y : (node.position?.y ?? 0);
        const nid = Number(node.id);
        if (Number.isInteger(nid) && nid > 0) {
          await putNode(node.id, {
            x: absX,
            y: absY,
            parentNodeInsideId: null,
          });
        }
      }

      // Delete the floor and non-door children
      const idsToRemove = new Set<string>([groupId, ...nonDoorChildIds]);
      for (const id of idsToRemove) {
        const nid = Number(id);
        if (Number.isInteger(nid) && nid > 0) {
          await fetch(withBasePath("/api/destination/floorplan/nodes"), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: nid }),
          });
        }
      }

      setNodes((nds) =>
        nds
          .filter((n) => !idsToRemove.has(n.id))
          .map((n) =>
            doorChildren.some((d) => d.id === n.id)
              ? {
                  ...n,
                  parentId: undefined,
                  extent: undefined,
                  position: (() => {
                    const internal = rf.getInternalNode(n.id);
                    const abs =
                      internal?.internals.positionAbsolute ?? n.position;
                    return {
                      x: "x" in abs ? abs.x : (n.position?.x ?? 0),
                      y: "y" in abs ? abs.y : (n.position?.y ?? 0),
                    };
                  })(),
                }
              : n,
          ),
      );
      setEdges((eds) =>
        eds.filter(
          (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
        ),
      );
      setSelectedGroupId("None");
      return;
    }
  }, [selectedGroupId, nodes, edges, setNodes, setEdges, rf, putNode]);

  // --- UI: toolbar, legend, React Flow canvas, hidden file input, bottom map ---
  return (
    <FloorPlanContext.Provider value={{ putNode }}>
      <div className="flex flex-col h-screen w-full bg-background text-foreground">
        <div ref={flowContainerRef} className="relative flex-1 min-h-0 w-full">
          <div
            className={`absolute z-20 top-3 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${panelClass}`}
          >
            {fromDestinationEditor ? (
              <Link
                href="/destination-editor"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs font-semibold text-panel-foreground transition hover:bg-panel-muted"
              >
                <ArrowLeft size={14} aria-hidden="true" />
                Destination editor
              </Link>
            ) : (
              <HomeLogoLink className="shrink-0" />
            )}
            <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {/* Building */}
            <ComboboxSelect<number>
              label="Destination"
              placeholder={
                isLoadingDestinations ? "Loading..." : "Select destination..."
              }
              items={destinationItems}
              value={selectedDestinationId}
              onChange={(v) => setSelectedDestinationId(Number(v))}
              widthClassName="w-[260px]"
              searchPlaceholder="Search destination..."
              disabled={isLoadingDestinations || destinationItems.length === 0}
            />
            <button
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
              onClick={() => void onAddGroup()}
              disabled={selectedDestinationId == null || isLoadingFloorplan}
            >
              Add Floor
            </button>
            <button
              className="px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-60"
              onClick={onPickFloorplan}
              disabled={
                isUploading || selectedDestinationId == null || !selectedGroupId
              }
            >
              {isUploading ? "Uploading..." : "Upload Floorplan"}
            </button>
            <span className="text-xs opacity-80">
              Selected: {selectedGroupId ?? "none"}
            </span>
            <div className="mx-1 w-px h-5 bg-border" />
            {/* Add */}
            <span className="text-xs font-medium opacity-80">Add</span>
            <button
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
              onClick={() => void onAddNode()}
              disabled={selectedDestinationId == null || isLoadingFloorplan}
            >
              Add Node
            </button>
            <button
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
              onClick={() => void onAddStairs()}
              disabled={selectedDestinationId == null || isLoadingFloorplan}
            >
              Add Stairs
            </button>
            <button
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
              onClick={() => void onAddElevator()}
              disabled={selectedDestinationId == null || isLoadingFloorplan}
            >
              Add Elevator
            </button>
            <button
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
              onClick={() => void onAddRamp()}
              disabled={selectedDestinationId == null || isLoadingFloorplan}
            >
              Add Ramp
            </button>
            <div className="mx-1 w-px h-5 bg-border" />
            {/* Delete */}
            <button
              className="px-2 py-1 rounded bg-destructive text-destructive-foreground"
              onClick={() => void onDelete()}
            >
              Delete
            </button>
          </div>
          {/* Door options panel: show when exactly one door node is selected; Entry/Exit checkboxes call putNode. */}
          {selectedFeatureNode && (
            <div
              className={`absolute z-20 top-24 right-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${panelClass}`}
            >
              <span className="text-xs font-semibold capitalize">
                {selectedFeatureNode.data?.kind ?? "Feature"}
              </span>
              {selectedDoorNode ? (
                <>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDoorNode.data?.isEntry ?? false}
                      onChange={(e) =>
                        selectedDoorNode.id &&
                        putNode(selectedDoorNode.id, {
                          isEntry: e.target.checked,
                        })
                      }
                    />
                    Entry
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDoorNode.data?.isExit ?? false}
                      onChange={(e) =>
                        selectedDoorNode.id &&
                        putNode(selectedDoorNode.id, {
                          isExit: e.target.checked,
                        })
                      }
                    />
                    Exit
                  </label>
                </>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedFeatureNode.data?.isDead ?? false}
                  onChange={(e) =>
                    selectedFeatureNode.id &&
                    putNode(selectedFeatureNode.id, {
                      isDead: e.target.checked,
                    })
                  }
                />
                Dead
              </label>
            </div>
          )}
          <div
            className={`absolute z-20 top-28 left-3 rounded-xl px-3 py-3 w-44 ${panelClass}`}
          >
            <div className="text-xs font-semibold mb-2">Legend</div>
            {(
              ["door", "stairs", "elevator", "ramp", "generic"] as NodeKind[]
            ).map((kind) => (
              <div
                key={kind}
                className="flex items-center gap-2 mb-1 last:mb-0"
              >
                <span
                  className="inline-flex items-center justify-center rounded-full border border-slate-900"
                  style={{
                    width: 20,
                    height: 20,
                    backgroundColor: NODE_KIND_META[kind].color,
                    color: "#0f172a",
                  }}
                >
                  <NodeKindIcon kind={kind} />
                </span>
                <span className="text-xs">{NODE_KIND_META[kind].label}</span>
              </div>
            ))}
          </div>

          {/* connectOnClick: click source then target to create edge. deleteKeyCode: Backspace/Delete remove selected nodes/edges. */}
          <ReactFlow<AppNode, AppEdge>
            nodeTypes={nodeTypes}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWithEdgeCleanup}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            defaultEdgeOptions={{
              type: "smoothstep",
              zIndex: EDGE_Z_INDEX,
              style: { stroke: EDGE_STROKE_DEFAULT, strokeWidth: 2 },
            }}
            connectOnClick
            connectionRadius={24}
            zIndexMode="manual"
            elevateNodesOnSelect={false}
            onNodeClick={(_evt, node) => {
              if (node.type === "floor") setSelectedGroupId(node.id);
            }}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onUploadFloorplan}
          />
        </div>

        {/* Bottom map: all building entrances; highlights the selected door */}
        <div
          className={`flex-shrink-0 h-52 w-full border-t border-border ${panelClass}`}
          aria-label="Map showing building entrance locations"
        >
          {!canRenderMap ? (
            <div className="h-full w-full grid place-items-center text-sm opacity-70">
              Loading map...
            </div>
          ) : (
            <div className="relative h-full w-full">
              <ReactMap
                {...mapViewState}
                onMove={(e) =>
                  setMapViewState({
                    longitude: e.viewState.longitude,
                    latitude: e.viewState.latitude,
                    zoom: e.viewState.zoom,
                  })
                }
                mapLib={maplibregl}
                mapStyle={baseStyle as any}
                style={{ width: "100%", height: "100%" }}
              >
                {entranceMarkers.map((entrance) => {
                  const isSelected =
                    selectedDoorNode?.data?.nodeOutsideId === entrance.id;
                  return (
                    <Marker
                      key={entrance.id}
                      longitude={entrance.lng}
                      latitude={entrance.lat}
                      anchor="center"
                    >
                      <div
                        className={`h-4 w-4 rounded-full border-2 border-white shadow-lg ${
                          isSelected ? "bg-brand-cta" : "bg-brand"
                        }`}
                        title={
                          entrance.name?.trim() || `Entrance ${entrance.id}`
                        }
                      />
                    </Marker>
                  );
                })}
              </ReactMap>
              {entranceMarkers.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-sm text-muted-foreground bg-panel/90 px-2 py-1 rounded">
                    No entrances linked to this building. Add them in the route
                    editor.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </FloorPlanContext.Provider>
  );
}

export default function FloorPlan() {
  const { isPending, allowed } = useRequireAdmin();

  if (isPending || !allowed) {
    return (
      <div className="grid h-screen place-items-center bg-background text-foreground">
        <Spinner className="size-10" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <FloorPlanInner />
    </ReactFlowProvider>
  );
}
