"use client";

import { useCallback } from "react";
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

type NodeData = { label: string };
type AppNode = Node<NodeData>; // includes group + normal nodes
type AppEdge = Edge;

const initialNodes: AppNode[] = [
    {
        id: "floor-1",
        type: "group",
        position: { x: 200, y: 80 },
        data: { label: "Floor 1" },
        // give the group a size so intersections work
        style: { width: 420, height: 280, border: "2px solid #999" },
    },
    { id: "n1", position: { x: 40, y: 40 }, data: { label: "Door 1" } },
    { id: "n2", position: { x: 40, y: 140 }, data: { label: "Stair 1" } },
];

const initialEdges: AppEdge[] = [{ id: "e1", source: "n1", target: "n2" }];

function FloorPlanInner() {
    const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(initialEdges);

    const rf = useReactFlow(); // ReactFlowInstance (has getInternalNode, getIntersectingNodes, etc.) :contentReference[oaicite:4]{index=4}
    const panelClass =
        "border border-border bg-panel text-panel-foreground shadow backdrop-blur";

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
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
            { id, position: { x: 60, y: 260 }, data: { label: `Node ${id}` } },
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
                style: { width: 420, height: 280, border: "2px solid #999" },
            },
        ]);
    }, [setNodes]);

    const onAddStairs = useCallback(() => {
        // TODO: wire up stairs creation
    }, []);

    const onAddElevator = useCallback(() => {
        // TODO: wire up elevator creation
    }, []);

    const onDelete = useCallback(() => {
        // TODO: wire up delete behavior
    }, []);

    return (
        <div className="relative h-screen w-full bg-background text-foreground">
            <div
                className={`absolute z-20 top-3 left-3 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${panelClass}`}
            >
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

            <ReactFlow<AppNode, AppEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                deleteKeyCode={["Backspace", "Delete"]}
                fitView
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
