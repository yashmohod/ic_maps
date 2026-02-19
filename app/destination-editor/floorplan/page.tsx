"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ChangeEvent,
} from "react";
import {
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    useNodesState,
    useEdgesState,
    addEdge,
    type Node,
    type Edge,
    type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ComboboxSelect, { type ComboboxItem } from "@/components/DropDown";

type NodeKind = "generic" | "door" | "stairs" | "elevator";
type NodeData = { label: string; kind?: NodeKind };
type AppNode = Node<NodeData>; // includes group + normal nodes
type AppEdge = Edge;
type DestinationOption = { id: number; name: string };

const BASE_GROUP_WIDTH = 420;
const BASE_GROUP_HEIGHT = 280;
const MIN_SCALE_PERCENT = 40;
const MAX_SCALE_PERCENT = 1000;
const EDGE_Z_INDEX = 10;

const groupNodeStyle = (imageUrl?: string, width = BASE_GROUP_WIDTH, height = BASE_GROUP_HEIGHT) => ({
    width,
    height,
    border: "2px solid #999",
    backgroundColor: "#0f172a0d",
    backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
    backgroundSize: "contain",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
});

const NODE_KIND_META: Record<NodeKind, { label: string; color: string; text: string }> = {
    generic: { label: "Generic Node", color: "#60a5fa", text: "N" },
    door: { label: "Door", color: "#34d399", text: "D" },
    stairs: { label: "Stairs", color: "#f59e0b", text: "S" },
    elevator: { label: "Elevator", color: "#f472b6", text: "E" },
};

function smallNodeStyle(kind: NodeKind): CSSProperties {
    return {
        width: 20,
        height: 20,
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

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

const initialNodes: AppNode[] = [

];

const initialEdges: AppEdge[] = [];

function FloorPlanInner() {
    const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(initialEdges);
    const [destinations, setDestinations] = useState<DestinationOption[]>([]);
    const [selectedDestinationId, setSelectedDestinationId] = useState<number | null>(null);
    const [isLoadingDestinations, setIsLoadingDestinations] = useState(false);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>("floor-1");
    const [isUploading, setIsUploading] = useState(false);
    const [scalePercent, setScalePercent] = useState(100);
    const uploadInputRef = useRef<HTMLInputElement | null>(null);

    const rf = useReactFlow(); // ReactFlowInstance (has getInternalNode, getIntersectingNodes, etc.) :contentReference[oaicite:4]{index=4}
    const panelClass =
        "border border-border bg-panel text-panel-foreground shadow backdrop-blur";
    const destinationItems = useMemo<ComboboxItem<number>[]>(
        () => destinations.map((d) => ({ value: d.id, label: d.name })),
        [destinations]
    );

    useEffect(() => {
        let cancelled = false;

        async function loadDestinations() {
            try {
                setIsLoadingDestinations(true);
                const res = await fetch("/api/destination");
                const payload = await res.json().catch(() => null);
                if (!res.ok || !payload?.destinations || cancelled) return;

                const list = (payload.destinations as Array<{ id: unknown; name: unknown }>)
                    .map((d) => ({
                        id: Number(d.id),
                        name: String(d.name ?? ""),
                    }))
                    .filter((d) => Number.isInteger(d.id) && d.id > 0 && d.name.length > 0);

                setDestinations(list);
                setSelectedDestinationId((prev) => prev ?? (list[0]?.id ?? null));
            } finally {
                if (!cancelled) setIsLoadingDestinations(false);
            }
        }

        void loadDestinations();

        return () => {
            cancelled = true;
        };
    }, []);

    const onConnect = useCallback(
        (connection: Connection) =>
            setEdges((eds) =>
                addEdge(
                    {
                        ...connection,
                        type: "smoothstep",
                        zIndex: EDGE_Z_INDEX,
                        style: { stroke: "#0f172a", strokeWidth: 2 },
                    },
                    eds
                )
            ),
        [setEdges]
    );

    // Drag in/out of group on drop
    const onNodeDragStop = useCallback(
        (_evt: any, node: AppNode) => {
            if (node.type === "group") return;

            const internal = rf.getInternalNode(node.id);
            if (!internal) return;

            const abs = internal.internals.positionAbsolute; // <-- v12 way :contentReference[oaicite:5]{index=5}

            // Use id-only form (works well with controlled nodes)
            const hits = rf
                .getIntersectingNodes({ id: node.id }, true)
                .filter((n) => n.type === "group");

            if (hits.length > 0) {
                const groupId = hits[0].id;

                // If already inside this group, do nothing
                if (node.parentId === groupId) return;

                const parentInternal = rf.getInternalNode(groupId);
                if (!parentInternal) return;

                const parentAbs = parentInternal.internals.positionAbsolute;

                // Convert absolute -> parent-relative, because child position is relative to parent
                const relative = { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y };

                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === node.id
                            ? {
                                ...n,
                                parentId: groupId,
                                position: relative,
                                // IMPORTANT:
                                // If you set extent: 'parent', you CANNOT drag out.
                                // For drag-in/out behavior, leave it undefined.
                                extent: undefined,
                            }
                            : n
                    )
                );
            } else {
                // Detach to the main canvas (position should be absolute)
                if (!node.parentId) return;

                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === node.id
                            ? {
                                ...n,
                                parentId: undefined,
                                extent: undefined,
                                position: { x: abs.x, y: abs.y },
                            }
                            : n
                    )
                );
            }
        },
        [rf, setNodes]
    );

    const onAddNode = useCallback(() => {
        const id = String(Date.now());
        setNodes((nds) => [
            ...nds,
            {
                id,
                position: { x: 60, y: 260 },
                data: { label: "N", kind: "generic" },
                style: smallNodeStyle("generic"),
                zIndex: 20,
            },
        ]);
    }, [setNodes]);

    const onAddGroup = useCallback(() => {
        const id = `floor-${Date.now()}`;
        setNodes((nds) => [
            ...nds,
            {
                id,
                type: "group",
                position: { x: 300, y: 200 },
                data: { label: `Floor ${id}` },
                style: groupNodeStyle(),
                zIndex: 0,
            },
        ]);
        setSelectedGroupId(id);
    }, [setNodes]);

    useEffect(() => {
        if (!selectedGroupId) return;
        const selected = nodes.find((n) => n.id === selectedGroupId && n.type === "group");
        if (!selected) return;

        const width = typeof selected.style?.width === "number" ? selected.style.width : BASE_GROUP_WIDTH;
        const nextPercent = clamp(
            Math.round((width / BASE_GROUP_WIDTH) * 100),
            MIN_SCALE_PERCENT,
            MAX_SCALE_PERCENT
        );
        setScalePercent(nextPercent);
    }, [nodes, selectedGroupId]);

    const resizeSelectedGroup = useCallback(
        (nextPercentInput: number) => {
            if (!selectedGroupId) return;

            const nextPercent = clamp(
                Math.round(nextPercentInput),
                MIN_SCALE_PERCENT,
                MAX_SCALE_PERCENT
            );
            const nextWidth = Math.round((BASE_GROUP_WIDTH * nextPercent) / 100);
            const nextHeight = Math.round((BASE_GROUP_HEIGHT * nextPercent) / 100);

            setNodes((nds) =>
                nds.map((n) =>
                    n.id === selectedGroupId && n.type === "group"
                        ? {
                            ...n,
                            style: {
                                ...(n.style ?? {}),
                                width: nextWidth,
                                height: nextHeight,
                            },
                        }
                        : n
                )
            );
            setScalePercent(nextPercent);
        },
        [selectedGroupId, setNodes]
    );

    const onPickFloorplan = useCallback(() => {
        if (!selectedDestinationId) {
            window.alert("Select a destination first.");
            return;
        }
        if (!selectedGroupId) {
            window.alert("Select a floor group first.");
            return;
        }
        uploadInputRef.current?.click();
    }, [selectedDestinationId, selectedGroupId]);

    const onUploadFloorplan = useCallback(
        async (evt: ChangeEvent<HTMLInputElement>) => {
            const file = evt.target.files?.[0];
            evt.target.value = "";
            if (!file) return;

            if (!selectedGroupId) {
                window.alert("Select a floor group first.");
                return;
            }
            if (!selectedDestinationId) {
                window.alert("Select a destination first.");
                return;
            }

            try {
                setIsUploading(true);

                const form = new FormData();
                form.append("file", file);
                form.append("destinationId", String(selectedDestinationId));

                const res = await fetch("/api/destination/floorplan", {
                    method: "POST",
                    body: form,
                });
                const payload = await res.json().catch(() => null);

                if (!res.ok || !payload?.url) {
                    window.alert(payload?.error ?? "Upload failed.");
                    return;
                }

                const floorplanUrl = String(payload.url);
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === selectedGroupId && n.type === "group"
                            ? {
                                ...n,
                                style: {
                                    ...groupNodeStyle(floorplanUrl),
                                    ...(n.style ?? {}),
                                    backgroundImage: `url(${floorplanUrl})`,
                                    backgroundSize: "contain",
                                    backgroundPosition: "center",
                                    backgroundRepeat: "no-repeat",
                                },
                            }
                            : n
                    )
                );
            } catch {
                window.alert("Upload failed.");
            } finally {
                setIsUploading(false);
            }
        },
        [selectedDestinationId, selectedGroupId, setNodes]
    );

    const onAddStairs = useCallback(() => {
        const id = `stairs-${Date.now()}`;
        setNodes((nds) => [
            ...nds,
            {
                id,
                position: { x: 70, y: 300 },
                data: { label: "S", kind: "stairs" },
                style: smallNodeStyle("stairs"),
                zIndex: 20,
            },
        ]);
    }, [setNodes]);

    const onAddElevator = useCallback(() => {
        const id = `elevator-${Date.now()}`;
        setNodes((nds) => [
            ...nds,
            {
                id,
                position: { x: 100, y: 300 },
                data: { label: "E", kind: "elevator" },
                style: smallNodeStyle("elevator"),
                zIndex: 20,
            },
        ]);
    }, [setNodes]);

    const onDelete = useCallback(() => {
        // TODO: wire up delete behavior
    }, []);

    return (
        <div className="relative h-screen w-full bg-background text-foreground">
            <div
                className={`absolute z-20 top-3 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${panelClass}`}
            >
                <ComboboxSelect<number>
                    label="Destination"
                    placeholder={isLoadingDestinations ? "Loading..." : "Select destination..."}
                    items={destinationItems}
                    value={selectedDestinationId}
                    onChange={(v) => setSelectedDestinationId(Number(v))}
                    widthClassName="w-[260px]"
                    searchPlaceholder="Search destination..."
                    disabled={isLoadingDestinations || destinationItems.length === 0}
                />
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground"
                    onClick={onAddNode}
                >
                    Add Node
                </button>
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground"
                    onClick={onAddGroup}
                >
                    Add Floor
                </button>
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
                    onClick={onPickFloorplan}
                    disabled={isUploading}
                >
                    {isUploading ? "Uploading..." : "Upload Floorplan"}
                </button>
                <span className="text-xs opacity-80">
                    Selected: {selectedGroupId ?? "none"}
                </span>
                <div className="mx-1 w-px h-5 bg-border" />
                <span className="text-xs opacity-80">Scale: {scalePercent}%</span>
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
                    onClick={() => resizeSelectedGroup(scalePercent - 10)}
                    disabled={!selectedGroupId}
                >
                    -
                </button>
                <input
                    className="w-28 accent-foreground disabled:opacity-60"
                    type="range"
                    min={MIN_SCALE_PERCENT}
                    max={MAX_SCALE_PERCENT}
                    step={5}
                    value={scalePercent}
                    disabled={!selectedGroupId}
                    onChange={(e) => resizeSelectedGroup(Number(e.target.value))}
                />
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-60"
                    onClick={() => resizeSelectedGroup(scalePercent + 10)}
                    disabled={!selectedGroupId}
                >
                    +
                </button>
                <div className="mx-1 w-px h-5 bg-border" />
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground"
                    onClick={onAddStairs}
                >
                    Add Stairs
                </button>
                <button
                    className="px-2 py-1 rounded bg-secondary text-secondary-foreground"
                    onClick={onAddElevator}
                >
                    Add Elevator
                </button>
                <div className="mx-1 w-px h-5 bg-border" />
                <button
                    className="px-2 py-1 rounded bg-destructive text-white"
                    onClick={onDelete}
                >
                    Delete
                </button>
            </div>
            <div
                className={`absolute z-20 top-28 left-3 rounded-xl px-3 py-3 w-44 ${panelClass}`}
            >
                <div className="text-xs font-semibold mb-2">Legend</div>
                {(["door", "stairs", "elevator", "generic"] as NodeKind[]).map((kind) => (
                    <div key={kind} className="flex items-center gap-2 mb-1 last:mb-0">
                        <span
                            className="inline-flex items-center justify-center rounded-full border border-slate-900 text-[10px] font-bold"
                            style={{
                                width: 16,
                                height: 16,
                                backgroundColor: NODE_KIND_META[kind].color,
                                color: "#0f172a",
                            }}
                        >
                            {NODE_KIND_META[kind].text}
                        </span>
                        <span className="text-xs">{NODE_KIND_META[kind].label}</span>
                    </div>
                ))}
            </div>

            <ReactFlow<AppNode, AppEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                defaultEdgeOptions={{
                    type: "smoothstep",
                    zIndex: EDGE_Z_INDEX,
                    style: { stroke: "#0f172a", strokeWidth: 2 },
                }}
                connectOnClick
                connectionRadius={24}
                zIndexMode="manual"
                elevateNodesOnSelect={false}
                onNodeClick={(_evt, node) => {
                    if (node.type === "group") setSelectedGroupId(node.id);
                }}
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
    );
}

export default function FloorPlan() {
    return (
        <ReactFlowProvider>
            <FloorPlanInner />
        </ReactFlowProvider>
    );
}
