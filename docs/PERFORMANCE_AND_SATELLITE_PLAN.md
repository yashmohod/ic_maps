# Performance optimizations & satellite basemap

Last updated: 2026-08-20

Living plan for map performance work and a satellite basemap toggle. Update status as items ship.

**Status legend:** `Done` · `Planned` · `Discussing` · `Won’t fix`

---

## Already shipped (2026-08-20)

| Item | Status | Notes |
|------|--------|--------|
| Public maps: path-only overlay | Done | Home + share route no longer draw the full outdoor graph. Route uses `RoutePathLayer` + navigate `geometry`. |
| Stop `/api/map/all` prefetch on public maps | Done | Full graph fetch stays on route editor only. |
| Remove `NavModeMap` | Done | Component deleted; was editor leftover used as a full-graph layer. |
| Uncontrolled map camera | Done | `initialViewState` + MapLibre `flyTo`/`easeTo`/`fitBounds` on home, share route, custom route, MyMaps view/workspace. Dropped `onMove` → React `setViewState` (major INP win). |
| Route editor keeps full graph | Done | Intentional; not a public-map concern. |

---

## Performance backlog

Ordered by expected impact.

### 1. Gate or remove 3D building extrusions — Planned

- **Where:** `app/page.tsx` `Layer` id `3d-buildings` (`fill-extrusion` on PMTiles `building` layer).
- **Why:** Heavy GPU cost under throttle / live nav; no OSM rebuild needed — style-only.
- **Options:** Remove always; or enable only when idle + zoomed; keep off during tracking / satellite mode.

### 2. Slim `GET /api/destination` for the home list — Planned

- **Where:** `app/api/destination/route.ts` (`SELECT *` includes every polygon JSON).
- **Why:** Search/list only needs `id`, `name`, `lat`, `lng` (and maybe parking flag). Polygons inflate first-load payload → LCP on slow networks.
- **Approach:** List endpoint returns light rows; fetch polygon when a building is selected (or dedicated `GET ?id=`).

### 3. Throttle GPS → React updates — Planned

- **Where:** `app/page.tsx` / `app/route/[id]/page.tsx` `watchPosition` → `setUserPos`.
- **Why:** Every fix re-renders the huge client page + `useNavigationProgress` polyline scans.
- **Approach:** Keep live position in a ref for camera / off-route; `setState` at ~1–2 Hz for marker/accuracy UI; throttle `aimCamera`.

### 4. Search / combobox responsiveness — Planned

- **Where:** `components/DestinationSearchCombobox.tsx` (688 ms pointer under 4× CPU in profiling).
- **Approach:** Pass light `{id,name}[]`; `startTransition` on filter; cap or virtualize list; isolate chrome so GPS updates don’t reconcile search.

### 5. Split map shell from HUD — Planned

- **Where:** `app/page.tsx` (~2k-line client component).
- **Approach:** Memoized map child vs sheet/search/favorites so unrelated state doesn’t invalidate the whole tree.

### 6. Style / glyph loading — Planned

- **Where:** `hooks/use-pmtiles-style.ts` (`cache: "no-store"`, deep `JSON` clone of style).
- **Approach:** Allow normal HTTP cache; avoid needless deep clones; consider hosting glyphs locally instead of `fonts.openmaptiles.org`.

### 7. Hide entrance dots while routing — Planned

- **Where:** `building-nodes-circle` on home map.
- **Approach:** Show for building preview; hide when `navigating` / route line is visible.

### 8. Faster first locate — Planned

- **Where:** `locateOnce` with `maximumAge: 0`.
- **Approach:** Accept a cached position first, then refine with high accuracy.

### 9. Bottom-sheet layout shift — Discussing

- Sheet / safe-area overlays showed up in layout-shift tooling. CLS is currently “good” overall — only chase if product care about it.

---

## Satellite basemap — Planned

### Goal

User toggle: **Map** (current OSM-Bright + local PMTiles) ↔ **Satellite**, without losing rotation, pitch, route overlays, or markers.

### Rotation / pitch

**Yes — same as today.** MapLibre rotates the camera (`bearing` / `pitch`). Raster satellite tiles work with the same `easeTo` / tracking heading already used in `aimCamera`. No special “rotatable satellite” tileset required.

### Free (or free-enough) imagery

| Source | Notes |
|--------|--------|
| **Esri World Imagery** XYZ | Best “looks like Google” for campus zoom; attribution required; verify terms for IC deploy. Example: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| **EOX Sentinel-2 cloudless** | Free; used in [MapLibre’s satellite example](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-satellite-map/); softer at building zoom. |
| **Self-host campus ortho (PMTiles)** | Best control/offline if IC has imagery; more pipeline work. |

### Implementation sketch

1. Add basemap mode: `"map" | "satellite"` (localStorage optional).
2. Satellite style = MapLibre style with a single `raster` source + layer (attribution in style or UI).
3. Toggle on home (and optionally share route / custom route): swap via `mapStyle` / `setStyle`, keep overlays (route, markers, polygons).
4. Disable 3D extrusions in satellite mode (extrusions look wrong on imagery).
5. Optional later: light labels/roads overlay on top of satellite.

### Performance note

Satellite tiles are heavier than local vector PMTiles. Keep **map** as default; load satellite only after the user toggles. Matters for 3G / LCP.

---

## Suggested ship order

1. Gate/remove 3D buildings  
2. Slim destination list API  
3. GPS throttle / isolate map updates  
4. Search list lightening  
5. Satellite toggle (Esri or EOX + attribution)  
6. Style/glyph caching and remaining polish  

---

## Related docs

- [AGENTS.md](./AGENTS.md) — stack and key paths  
- [AUDIT_WORKING_DOC.md](./AUDIT_WORKING_DOC.md) — broader audit tracker  
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) — launch backlog  
