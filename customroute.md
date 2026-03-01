# Custom Route – context and migration summary

This file summarizes the plan to migrate the shareable-routes (custom route) feature from legacy backend proxy to Drizzle + PostgreSQL.

---

## Goal

- **Routes** = shareable “events”; **destinations** = where we guide people.
- One main destination per route (for now); later: ordered series of destinations.
- Support **closest parking lots** (by distance to main destination) and **dedicated parking** (user can set a parking destination for an event).

---

## Data model (already in db/schema.ts)

- **route**: `id`, `name`, `user_id`, `description` (unique on `user_id` + `name`).
- **route_destination**: `order`, `destination_id`, `route_id` (join: one route → many destinations in order). No composite PK; leave as is.
- **destination**: `id`, `lat`, `lng`, `name`, `polygon`, `is_parking_lot`, `open_time`, `close_time`.
- **destinationNode**: links `destination_id` to `node_outside_id` (nodes to show for a destination on the map).

---

## Deprecated calls → replacements

### Building/destination (use existing APIs)

| Deprecated            | Replacement |
|-----------------------|------------|
| **getAllBuildings**   | **GET /api/destination** → `{ destinations }` with `id`, `name`, `lat`, `lng`, `polygon`, `isParkingLot`, etc. Call once; use for dropdown and for “get one building” by id. |
| **getBuildingPos**    | Find destination by id in the `destinations` array from GET /api/destination (polygon, lat, lng, name). Optional: add GET /api/destination?id=... for single fetch. |
| **getAllBuildingNodes** | **GET /api/destination/outsideNode?id=destinationId** → `{ nodes: number[] }` (node_outside ids). To get `{ id, lng, lat }[]` for map circles: (A) then GET /api/map/node with no query → `{ rows }`, filter by node ids; or (B) add endpoint e.g. outsideNode?id=X&coords=true returning `{ nodes: { id, lat, lng }[] }`. |

Reference: app/page.tsx (getBuildings, outsideNode), app/destination-editor/page.tsx, app/route-editor/page.tsx, app/api/destination/route.ts, app/api/destination/outsideNode/route.tsx, app/api/map/node/route.ts.

### Route-related (to implement with Drizzle)

| Deprecated            | Replacement |
|-----------------------|------------|
| **getAllUserRoutes**  | **GET /api/shareableroute/all?userId=...** – list routes with ordered destinations (names, isParkingLot). |
| **AddRoute**          | **POST /api/shareableroute** – body `{ userId, name, description?, destinationIds: number[] }`, insert route + route_destination rows. |
| **EditRoute**         | **PUT /api/shareableroute** – body `{ routeId, name?, description?, destinationIds? }`, update route and replace route_destinations. |
| **DeleteRoute**       | **DELETE /api/shareableroute** – body `{ routeId }`, delete route (cascade). |

Implement in app/api/shareableroute/route.ts and app/api/shareableroute/all/route.ts; remove BACKEND_URL proxy; use db + schema only.

---

## Decisions (from user)

1. **Multi-destination UI**: Start with **one destination per route**; add multiple ordered destinations later.
2. **Parking**: (a) **Main destination** = single point to route to. (b) **Closest parking lots** = show destinations with `is_parking_lot = true` ordered by distance to main destination. (c) **Dedicated parking** = user can set a dedicated parking lot for an event/route (e.g. `route.dedicated_parking_destination_id` or second row in route_destination; to refine when implementing).
3. **Navigation**: **Single-destination** only for now; use first/only destination when calling RouteNavigate(routeId, ...). No multi-stop.
4. **route_destination**: No composite primary key; leave table as is.

---

## Parking: closest + dedicated

- **Main destination**: The one destination per route = main point to route to.
- **Closest parking**: Filter destinations with `is_parking_lot = true`; order by distance from main destination (API or front end using GET /api/destination).
- **Dedicated parking**: User sets which destination is the dedicated parking for this route/event. Implementation TBD: e.g. `route.dedicated_parking_destination_id` FK or second route_destination row.

---

## Files to touch

- **db/schema.ts** – add Drizzle relations for route ↔ route_destination ↔ destination; export RouteDestination type if missing.
- **app/api/shareableroute/route.ts**, **app/api/shareableroute/all/route.ts** – replace proxy with Drizzle CRUD.
- **app/customRoute/page.tsx** – replace legacy calls with fetch to GET /api/destination, GET /api/shareableroute/all, POST/PUT/DELETE /api/shareableroute, GET /api/destination/outsideNode (+ resolve node coords); align types; keep share link `/route/${route.id}` and QR flow.
- Optional: GET /api/destination?id=... or GET /api/destination/outsideNode?coords=true for building nodes with lat/lng in one call.

---

## Public route page app/route/[id]/page.tsx

- Uses RouteNavigate(routeId, userLat, userLng, navMode). Keep single-destination navigation (first/only destination). No schema change needed for this page.
