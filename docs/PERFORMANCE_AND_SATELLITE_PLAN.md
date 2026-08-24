# Performance optimizations & satellite basemap

Last updated: 2026-08-24

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

### 1. Gate or remove 3D building extrusions — Done

- Removed. No `fill-extrusion` layer on the home map.

### 2. Slim `GET /api/destination` for the home list — Done

- Default list omits `polygon`. `?id=` and `?include=polygon` return polygons. Home / customRoute / route-editor fetch polygon on select; destination-editor uses `?include=polygon`.

### 3. Throttle GPS → React updates — Done

- Home + share route: live GPS stays in a ref for camera/off-route; React `userPos` publishes at ~2 Hz (`shouldPublishGpsUi`). Full map/HUD tree split deferred — throttle + slim list cover most of the cost.

### 4. Search / combobox responsiveness — Won’t fix (for now)

- Mostly covered by #2 + #3. Revisit only if search still feels slow after those land.

### 5. Split map shell from HUD — Won’t fix (for now)

- Same as #3: GPS throttle is the smaller fix. Revisit if INP is still bad.

### 6. Style / glyph loading — Done (style cache)

- `use-pmtiles-style`: skip refetch when cached; drop `cache: "no-store"`; clone style into cache so MapLibre mutations don’t poison it. Glyphs still from `fonts.openmaptiles.org` (local hosting later if needed).

### 7. Hide entrance dots while routing — Done

- Home: `building-nodes-circle` hidden while `navigating`.

### 8. Faster first locate — Done

- Cached `getCurrentPosition` (`maximumAge: 60s`) then high-accuracy refine on home + share route.

### 9. Bottom-sheet layout shift — Discussing

- Sheet / safe-area overlays showed up in layout-shift tooling. CLS is currently “good” overall — only chase if product care about it.

---

## Satellite basemap — Done

### Goal

User toggle: **Map** (current OSM-Bright + local PMTiles) ↔ **Satellite**, without losing rotation, pitch, route overlays, or markers.

### Shipped

- `SATELLITE_STYLE` (Esri World Imagery) in `lib/map-constants.ts`
- `useBasemap` / `useBasemapStyle` + `BasemapToggle` on home, share route, route editor, destination editor, and My Maps (workspace + public view); preference in `localStorage`
- Satellite loads only after toggle; 3D extrusions are gone entirely
- 2026-08-24: Esri registration of 86 building footprints found **no systematic campus-wide offset** (median ~1.5 m east, only ~10% of buildings agree). Outdoor node/edge coordinates left unchanged; editors can now visually snap against satellite.

### Free (or free-enough) imagery

| Source | Notes |
|--------|--------|
| **Esri World Imagery** XYZ | Shipped default. Attribution required; verify terms for IC deploy. |
| **EOX Sentinel-2 cloudless** | Free; softer at building zoom. |
| **Self-host campus ortho (PMTiles)** | Best control/offline if IC has imagery; more pipeline work. |

---

## Suggested ship order (historical)

1. Gate/remove 3D buildings — Done
2. Slim destination list API — Done
3. GPS throttle — Done
4. Search list lightening — deferred (#2+#3)
5. Satellite toggle — Done
6. Style/glyph caching and remaining polish — Done (style); glyphs CDN still OK

---

## Related docs

- [AGENTS.md](./AGENTS.md) — stack and key paths
- [AUDIT_WORKING_DOC.md](./AUDIT_WORKING_DOC.md) — broader audit tracker
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) — launch backlog
