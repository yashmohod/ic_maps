# IC Maps — Context for AI Agents

Use this file to onboard quickly. Do not edit the plan file (e.g. `codebase_refactor_plan_*.plan.md`); treat it as read-only reference.

---

## What this project is

**IC Maps** is an Ithaca College campus map app with:

- **Map**: MapLibre GL + `@vis.gl/react-maplibre`, PMTiles for raster tiles. Local style JSONs in `public/styles/osm-bright/` (light/dark themed blue–teal).
- **Routing**: Server-side A* in `lib/navigation.ts`; graph is loaded from DB and cached; `reloadGraph()` (or POST `/api/map/reload`) refreshes after edits.
- **Auth**: `better-auth` with **PostgreSQL** (`provider: "pg"` in `lib/auth.ts`). Session via `auth.api.getSession({ headers: await headers() })`.
- **Stack**: Next.js 16 (App Router), React 19, Drizzle ORM, Tailwind v4, shadcn/ui, **sonner** for toasts (not react-hot-toast).

---

## Key paths

| Path | Purpose |
|------|--------|
| `app/page.tsx` | Main map: destinations, navigate, compass, building polygon, NavModeMap. |
| `app/route-editor/page.tsx` | Edit nodes/edges, building polygons, nav mode flags; calls `invalidateNavGraph()` after mutations. |
| `app/route/[id]/page.tsx` | Shareable route view; uses NavModeMap and nav conditions (includes `is_through_building`). |
| `app/customRoute/page.tsx` | Custom multi-destination route creation. |
| `app/destination-editor/page.tsx` | Destinations list + map; `destination-editor/floorplan/` for indoor graph. |
| `app/account/*` | Login, signup, settings. |
| `components/NavMode.tsx` | Renders route path + nodes on map (no NavMode CRUD; modes are hardcoded). |
| `components/BuildingDrawControls.tsx` | MapLibre Draw styles (teal hot, lighter navy + white stroke cold). |
| `components/AccuracyRingLayer.tsx` | Reusable accuracy ring around user location. |
| `lib/navigation.ts` | A* routing, `reloadGraph()`, `navigate()`. Uses DB types only (no `navMode` table). |
| `lib/auth.ts` | better-auth config; **must use `provider: "pg"`**. |
| `lib/apiClient.ts` | Central API client for `fetch` to `/api/*`. |
| `db/schema.ts` | Drizzle schema (PostgreSQL). `route_destination` has composite PK `(route_id, destination_id)`. |

---

## Shared modules (use these instead of duplicating)

- **Types**: `@/lib/types/map` — `LngLat`, `UserPos`, `MarkerNode`, `SimpleMarkerNode`, `EdgeIndexEntry`, `GeoJSONFeatureCollection`, `ViewStateLite`, `MapDestination`.
- **Map config**: `@/lib/map-constants` — `DEFAULT_CENTER`, `DEFAULT_ZOOM`, `CAMPUS_BOUNDS`.
- **Map style**: `@/hooks/use-map-style` — returns `{ isDark, mapStyle }` (no need to repeat `useAppTheme` + style path logic).
- **Geo**: `@/lib/geo` — `toRad`, `toDeg`, `normBearing`, `bearingTo`, `makeCircleGeoJSON`.
- **Panel UI**: `@/lib/panel-classes` — `surfacePanelClass`, `borderMutedClass`, `panelClass`, `selectBaseClass`, `selectFocusClass`.
- **Spinner**: `@/components/ui/spinner` — use this instead of inline Spinner components.

---

## API and auth

- **Mutating routes** (POST/PUT/PATCH/DELETE) and sensitive GETs (e.g. user list) **must** check session and return 401 when unauthenticated. Pattern: `const session = await auth.api.getSession({ headers: await headers() }); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`
- **Input validation**: Use Zod on `/api/map/navigateTo`, `/api/map/edge`, `/api/users`, etc. Return 400 with error details on failure.
- **Graph invalidation**: After creating/updating/deleting nodes or edges in the route editor, the app calls `invalidateNavGraph()` (POST `/api/map/reload`) so navigation uses fresh data.

---

## Theming and accessibility

- **Brand**: IC Navy `#003c71`, IC Teal `#35D5A4`. Use `brand`, `brand-cta` (teal), `brand-cta-foreground` (navy on teal for contrast). Avoid yellow/gold for buttons and active states.
- **On-map elements**: Use **teal** for active/highlighted (route line, building polygon, on-path nodes); use **lighter navy + white outline** for static draw elements so they don’t blend with blue map tiles (WCAG non-text contrast).
- **Toasts**: Use `import { toast } from "sonner"` only.

---

## Removed / never add back

- **NavMode CRUD**: Removed; pedestrian/vehicular (and blue light as a flag) are hardcoded. Do not re-add `NavModeEditor` or a `nav_mode` table.
- **Bluelight page**: `app/bluelight/page.tsx` removed. Keep backend support: `is_blue_light` on `node_outside`, APIs that read/write it, and “Blue Light” in route-editor’s nav mode flags.
- **`lib/icmapsApi`**: Does not exist; do not add imports to it.

---

## Database and navigation

- **PostgreSQL** only; auth uses `provider: "pg"` in the Drizzle adapter.
- **Null incline**: In `lib/navigation.ts`, treat null incline as 0: `(n.incline ?? 0) <= nav.max_incline`.
- **Route destination**: Table has composite primary key on `(route_id, destination_id)`.

---

## Common gotchas

1. **API base path**: Use `apiClient.get("/api/...")` with a leading slash so it works from any route.
2. **Links**: Admin “building editor” link must point to `/destination-editor`, not `/building-editor`.
3. **State updates**: Use immutable updates (e.g. `setCurrentBuilding(prev => ({ ...prev, ... }))`); avoid mutating `prev` and returning it.
4. **Compass**: When disabling compass, remove `deviceorientation` / `deviceorientationabsolute` listeners to avoid leaks.
5. **Edge identity**: Use `id` for edge keys (e.g. `EdgeIndexEntry.id`); the codebase is normalized away from `key`.

---

## Running the app

- `npm run dev` — Next.js dev server.
- `npm run build` / `npm run start` — Production.
- Env: e.g. `BETTER_AUTH_URL`, DB connection for Drizzle. See `.env.example` or repo docs if present.
