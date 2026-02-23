# Floorplan Editor – How the Code Works

This doc explains how `page.tsx` works so you can follow the flow from UI to API and back.

---

## 1. What This Page Does

- You pick a **destination** (building) from a dropdown.
- The canvas shows that destination’s **floor plan**: **floors** (big rectangles), **nodes** (doors, stairs, elevators, ramps, generic points), and **edges** (connections between nodes).
- You can add/move/connect/delete nodes and floors, upload a floorplan image per floor, and for “door” nodes set entry/exit and see the door’s location on a map.

Everything is persisted through the **API** (`/api/destination/*`, `/api/destination/floorplan/*`, `/api/map/node`). The page keeps local React state in sync after each API call.

---

## 2. Tech Stack

- **React Flow** (`@xyflow/react`): canvas, nodes, edges, drag, connect, resize.
- **API**: REST (GET/POST/PUT/DELETE) for destinations, floorplan nodes, floorplan edges, floorplan image upload, and outside node position.
- **Map**: `@vis.gl/react-maplibre` + pmtiles for the bottom “door location” map.

---

## 3. File Structure (Top to Bottom)

| Section | What it is |
|--------|-------------|
| **Types** | `NodeKind`, `NodeData`, `AppNode`, `AppEdge`, `ApiNode`, `ApiEdge`, `DestinationOption` – shapes for UI and API. |
| **Constants** | `BASE_GROUP_WIDTH`, edge colors, `HANDLE_POSITIONS`, `NODE_KIND_META`, etc. |
| **getEdgeStyle** | Returns stroke color/width: cross-floor edges (different parent) are blue and thicker. |
| **FourHandles** | Renders 8 handles (4 source + 4 target) so edges can attach from any side. |
| **groupNodeStyle / smallNodeStyle** | Inline styles for floor rectangles and small circular nodes. |
| **Node components** | `SmallIconNode`, `RampNode`, `FloorGroupNode` – custom React Flow node types; they call `putNode` on resize/change. |
| **Helpers** | `insertNodeWithParent`, `sortNodesParentBeforeChild`, `moveNodeAfterParent` – keep parent-before-child order for React Flow. |
| **Context** | `FloorPlanContext` provides `putNode(id, payload)` so any node can persist updates. |
| **apiNodeToKind** | Maps API flags (`isStairs`, `isElevator`, `nodeOutsideId`, etc.) to `NodeKind`. |
| **FloorPlanInner** | Main component: state, loading, handlers, and JSX. |
| **FloorPlan** | Wraps `FloorPlanInner` in `ReactFlowProvider`. |

---

## 4. Data Flow

1. **Mount**  
   - `FloorPlanInner` runs.  
   - One effect loads **destinations** (GET `/api/destination`) and sets `selectedDestinationId` (e.g. first item).

2. **Destination selected**  
   - Another effect depends on `selectedDestinationId`.  
   - It fetches **nodes** (GET `/api/destination/floorplan/nodes?destinationId=...`) and **edges** (GET `.../edges?destinationId=...`).  
   - API nodes are converted to React Flow nodes:
     - `isGroup` → `type: "floor"`, `FloorGroupNode`.
     - `isRamp` → `type: "ramp"`, `RampNode`.
     - Else → `type: "smallIcon"`, `SmallIconNode` with `kind` from `apiNodeToKind`.
   - Nodes are sorted with `sortNodesParentBeforeChild` so that parents (floors) come before children (nodes on that floor).  
   - API edges are mapped to React Flow edges (source, target, handles, `getEdgeStyle` for same-floor vs cross-floor).  
   - `setNodes` and `setEdges` update state; React Flow re-renders.

3. **User actions**  
   - **Add node/floor/stairs/elevator/ramp**: POST to `/api/destination/floorplan/nodes` with position (and optional `parentNodeInsideId`), then append/insert the new node into `nodes` (using `insertNodeWithParent` for children).  
   - **Connect two nodes**: `onConnect` → POST to `.../edges`, then add the new edge to `edges` (or update handles if the same pair already had an edge).  
   - **Double-click edge**: DELETE edge by id, remove from `edges`.  
   - **Drag node**: `onNodeDragStop` computes which floor (if any) the node is over; updates `parentId` and position (relative inside floor, or absolute if not); then `putNode(id, { x, y, parentNodeInsideId, width, height })`.  
   - **Resize node** (handles on SmallIconNode/RampNode/FloorGroupNode): `onResizeEnd` → `putNode(id, { width, height, x, y })`.  
   - **Ramp slider**: updates local `data.rampValue` and `putNode(id, { incline })`.  
   - **Door entry/exit**: checkboxes call `putNode(id, { isEntry })` or `putNode(id, { isExit })`.  
   - **Upload floorplan**: file → POST to `/api/destination/floorplan`, then PUT node `imageUrl` for the selected floor group and update that node’s style.  
   - **Delete**: If something is selected on canvas, delete those nodes/edges (door nodes are only unparented). If a floor is selected in the dropdown, delete that floor and its non-door children; door children are unparented. All deletions go through DELETE endpoints, then local state is updated.

4. **putNode**  
   - `putNode(id, payload)` is the central “patch one node” call.  
   - It sends PUT to `/api/destination/floorplan/nodes` with `{ id: number, ...payload }`.  
   - Then it updates local `nodes`: same `id`, apply position, `parentId`, `style.width/height`, and data fields like `isEntry`, `isExit`, `rampValue`, so the UI stays in sync.

5. **Door + map**  
   - When the only selected node is a door (`nodeOutsideId != null`), `selectedDoorNode` is set.  
   - An effect fetches GET `/api/map/node?id=<nodeOutsideId>` to get lat/lng.  
   - The bottom map centers on that point and shows a marker.  
   - Entry/Exit toggles in the door panel call `putNode` as above.

---

## 5. Important Implementation Details

- **Parent–child order**  
  React Flow expects parents to appear **before** their children in the `nodes` array so that when you drag a floor, its children move with it. So we always `sortNodesParentBeforeChild` after loading, and `insertNodeWithParent` / `moveNodeAfterParent` when adding or reparenting.

- **onNodeDragStop**  
  After a drag, we need to know “is this node over a floor?” We use `getIntersectingNodes`; if that’s empty we fall back to point-in-rect using floor bounds and the node center. Then we update `parentId` and relative/absolute position and call `putNode`. We use `setTimeout(applyParentUpdate, 0)` so this runs after React Flow’s own `onNodesChange`, so our parent/position win.

- **Door nodes**  
  Door nodes are “inside” nodes linked to an “outside” node via `nodeOutsideId`. We never delete them; we only unparent them (PUT `parentNodeInsideId: null`) when deleting a floor or when they’re in the selection (so they stay on the map as standalone points).

- **Edge styling**  
  `getEdgeStyle(parentOf, sourceId, targetId)` checks whether source and target have the same parent. Same parent → default gray stroke; different parents → blue, thicker stroke (cross-floor).

- **Ids**  
  API uses numeric ids; React Flow uses string ids. We `String(row.id)` when building nodes/edges and `Number(id)` when calling the API.

---

## 6. API Endpoints Used

| Action | Method | Endpoint | Body/Query |
|--------|--------|----------|------------|
| List destinations | GET | `/api/destination` | – |
| List nodes | GET | `/api/destination/floorplan/nodes` | `destinationId` |
| List edges | GET | `/api/destination/floorplan/edges` | `destinationId` |
| Create node | POST | `/api/destination/floorplan/nodes` | `destinationId`, position, optional `parentNodeInsideId`, type flags, size |
| Update node | PUT | `/api/destination/floorplan/nodes` | `id`, and any of `x`, `y`, `width`, `height`, `parentNodeInsideId`, `imageUrl`, `incline`, `isEntry`, `isExit` |
| Delete node | DELETE | `/api/destination/floorplan/nodes` | `id` |
| Create edge | POST | `/api/destination/floorplan/edges` | `destinationId`, `from`, `to`, `biDirectional`, handles |
| Delete edge | DELETE | `/api/destination/floorplan/edges` | `id` |
| Upload floorplan image | POST | `/api/destination/floorplan` | `FormData`: `file`, `destinationId` |
| Outside node position | GET | `/api/map/node` | `id` (outside node id) |

---

## 7. State Summary

- **nodes / edges** – React Flow state (from `useNodesState` / `useEdgesState`).  
- **destinations** – list for the Building dropdown.  
- **selectedDestinationId** – which destination’s floorplan we’re editing.  
- **selectedGroupId** – which floor is “selected” (for upload and for “Add node here”).  
- **selectedOutsideNodePos** – lat/lng for the selected door’s outside node (for the map).  
- **isLoadingDestinations / isLoadingFloorplan / isUploading** – loading flags for UI.  
- **mapViewState** – map center/zoom; updated when a door is selected so the map pans to that door.

With the comments in `page.tsx` and this doc, you can trace any user action from the button/canvas through the handler to the API and back into state.
