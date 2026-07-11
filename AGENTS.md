# IC Maps — Context for AI Agents

Use this file to onboard quickly. Do not edit the plan file (e.g. `codebase_refactor_plan_*.plan.md`); treat it as read-only reference.

---

## What this project is

**IC Maps** is an Ithaca College campus map app with:

- **Map**: MapLibre GL + `@vis.gl/react-maplibre`, PMTiles for raster tiles. Local style JSONs in `public/styles/osm-bright/` (light/dark themed blue–teal).
- **Routing**: Server-side A\* in `lib/navigation.ts`; graph is loaded from DB and cached; `reloadGraph()` refreshes after edits.
- **Auth**: `better-auth` with **PostgreSQL** (`provider: "pg"` in `lib/auth.ts`). API routes use `@/lib/auth-guards` (`requireSession` / `requireAdmin` / `getSession`), not raw `auth.api.getSession` in each handler.
- **Stack**: Next.js 16 (App Router), React 19, Drizzle ORM, Tailwind v4, shadcn/ui, **sonner** for toasts (not react-hot-toast).

---

## Key paths

| Path                                  | Purpose                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                        | Main map: destinations, navigate, compass, building polygon, NavModeMap.                                |
| `app/route-editor/page.tsx`           | Edit nodes/edges, building polygons, nav mode flags; server mutations call `reloadGraph()` after edits. |
| `app/route/[id]/page.tsx`             | Shareable route view; uses NavModeMap and nav conditions (includes `is_through_building`).              |
| `app/customRoute/page.tsx`            | Custom multi-destination route creation.                                                                |
| `app/destination-editor/page.tsx`     | Destinations list + map; `destination-editor/floorplan/` for indoor graph.                              |
| `app/mymaps/workspace.tsx`            | Personal maps editor (draw tools, collaborators).                                                       |
| `app/mymaps/[id]/view/page.tsx`       | Public/shared MyMaps view.                                                                              |
| `app/report/*`                        | Bug / accessibility / route report forms.                                                               |
| `app/admin/reports/page.tsx`          | Admin report inbox + dead-feature tools.                                                                |
| `app/account/*`                       | Login, signup, settings.                                                                                |
| `components/NavModeMap.tsx`           | Renders route path + nodes on map (no NavMode CRUD; modes are hardcoded).                               |
| `components/ComboboxSelect.tsx`       | Shared searchable select (shadcn Command + Popover).                                                    |
| `components/BuildingDrawControls.tsx` | MapLibre Draw styles (teal hot, lighter navy + white stroke cold).                                      |
| `components/AccuracyRingLayer.tsx`    | Reusable accuracy ring around user location.                                                            |
| `lib/navigation.ts`                   | A\* routing, `reloadGraph()`, `navigate()`. Uses DB types only (no `navMode` table).                    |
| `lib/auth.ts`                         | better-auth config; **must use `provider: "pg"`**.                                                      |
| `lib/auth-guards.ts`                  | Session/admin/Ithaca-edu guards + DEV_Mode bypass.                                                      |
| `lib/base-path.ts`                    | `withBasePath()` for client `fetch` / asset URLs under deploy basePath.                                 |
| `lib/floorplan-flow.ts`               | Shared floorplan React Flow types, layout constants, and helpers (editor + report previews).            |
| `db/schema.ts`                        | Drizzle schema (PostgreSQL). `route_destination` has composite PK `(route_id, destination_id)`.         |
| `app/api/mymaps/**`                   | MyMaps CRUD + collaborator APIs.                                                                        |
| `app/api/report/**`                   | Report submission + admin list endpoints.                                                               |
| `app/api/map/dead-feature`            | Mark outdoor/indoor nodes dead (admin).                                                                 |

---

## Shared modules (use these instead of duplicating)

- **Types**: `@/lib/types/map` — `LngLat`, `UserPos`, `MarkerNode`, `SimpleMarkerNode`, `EdgeIndexEntry`, `GeoJSONFeatureCollection`, `ViewStateLite`, `MapDestination`, `RouteLegMetrics`.
- **Map config**: `@/lib/map-constants` — `DEFAULT_CENTER`, `DEFAULT_ZOOM`, `CAMPUS_BOUNDS`.
- **Map style**: `@/hooks/use-map-style` — returns `{ isDark, mapStyle }` (no need to repeat `useAppTheme` + style path logic).
- **Geo**: `@/lib/geo` — `calcDistance`, `normBearing`, `bearingTo`, `makeCircleGeoJSON`.
- **Panel UI**: `@/lib/panel-classes` — `surfacePanelClass`, `borderMutedClass`, `panelClass`, `selectBaseClass`, `selectFocusClass`.
- **Spinner**: `@/components/ui/spinner` — use this instead of inline Spinner components.

---

## API and auth

- **Public (no login)**: Building/destination reads (`GET /api/destination`, `GET /api/destination/outsideNode`, floorplan reads), routing (`POST /api/map/navigateTo`), shareable route views (`GET /api/shareableroute?id=…`), and public MyMaps reads when `is_public_view`.
- **Session required**: Favorites (`/api/favorites`), favorite trips (`/api/destination-chains`), account profile updates (`PATCH /api/users/[id]` for self), shareable route management (`POST/PUT/DELETE /api/shareableroute`, `GET /api/shareableroute/all`), MyMaps mutations.
- **Admin required**: Map/destination mutations (nodes, edges, buildings), user list (`GET /api/users`), admin flag changes (`PATCH /api/users/[id]` `isAdmin`), user deletion (`DELETE /api/users/[id]`), report admin GETs, dead-feature mutations.
- **DEV Mode**: In development only, set `DEV_Mode=true` in `.env` to skip all page/API auth guards (`lib/dev-mode.ts`; client receives the flag via `DevModeProvider` in `app/layout.tsx`). Ignored when `NODE_ENV=production`.
- **Page guards**: `/account/setting` requires login; editor pages require admin. Login and signup stay public.
- **Pattern**: Prefer `lib/auth-guards`:
  ```ts
  const { session, error } = await requireSession(); // or requireAdmin()
  if (error) return error;
  ```
  Optional session (public maps / anonymous reports): `const session = await getSession();`
- **Input validation**: Use Zod on `/api/map/navigateTo`, `/api/map/edge`, `/api/users`, etc. Return 400 with error details on failure.
- **`POST /api/map/navigateTo`**: Session-optional for read-only routing (destId/lat/lng/viaDestIds). Guests on `/route/[id]` can start navigation without logging in.
- **Graph invalidation**: After creating/updating/deleting nodes or edges, API routes call `reloadGraph()` (via `await reloadGraph().catch(console.error)`) so navigation uses fresh data.

---

## Theming and accessibility

- **Brand**: IC Navy `#003c71`, IC Teal `#35D5A4`. Use `brand`, `brand-cta` (teal), `brand-cta-foreground` (navy on teal for contrast). Avoid yellow/gold for buttons and active states.
- **On-map elements**: Use **teal** for active/highlighted (route line, building polygon, on-path nodes); use **lighter navy + white outline** for static draw elements so they don’t blend with blue map tiles (WCAG non-text contrast).
- **Toasts**: Use `import { toast } from "sonner"` only.

---

## Removed / never add back

- **NavMode CRUD**: Removed; pedestrian/vehicular (and blue light as a flag) are hardcoded. Do not re-add `NavModeEditor` or a `nav_mode` table.
- **Bluelight page**: `app/bluelight/page.tsx` removed. Keep backend support: `is_blue_light` on `node_outside`, APIs that read/write it, and “Blue Light” in route-editor’s nav mode flags.
- **`lib/icmapsApi` / `lib/apiClient` / `jsonError`**: Do not re-add. Use `fetch(withBasePath(...))` and `NextResponse.json(...)`.

---

## Database and navigation

- **PostgreSQL** only; auth uses `provider: "pg"` in the Drizzle adapter.
- **Null incline**: In `lib/navigation.ts`, treat null incline as 0: `(n.incline ?? 0) <= nav.max_incline`.
- **Route destination**: Table has composite primary key on `(route_id, destination_id)`.
- **Migrations are hand-written**: SQL files live in `drizzle/*.sql` and are listed in `drizzle/meta/_journal.json`. Do **not** run `drizzle-kit generate` (meta snapshots after `0000` are intentionally stale). Apply with `npx drizzle-kit migrate`.

---

## Common gotchas

1. **API base path**: Use `fetch(withBasePath("/api/..."))` with a leading slash so it works from any route under the app basePath.
2. **Links**: Admin “building editor” link must point to `/destination-editor`, not `/building-editor`.
3. **State updates**: Use immutable updates (e.g. `setCurrentBuilding(prev => ({ ...prev, ... }))`); avoid mutating `prev` and returning it.
4. **Compass**: When disabling compass, remove `deviceorientation` / `deviceorientationabsolute` listeners to avoid leaks.
5. **Edge identity**: Use `id` for edge keys (e.g. `EdgeIndexEntry.id`); the codebase is normalized away from `key`.
6. **DB imports**: Use `from "@/db"` (not `@/db/index`).

---

## Running the app

- `npm run dev` — Next.js dev server.
- `npm run build` / `npm run start` — Production.
- Env: e.g. `BETTER_AUTH_URL`, `DATABASE_URL`, `NEXT_PUBLIC_BASE_PATH` (empty locally; `/ic_maps` in production). See `.env.example`.
