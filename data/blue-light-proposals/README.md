# Blue light density proposals

Three importable MyMaps JSON files for comparing OPS emergency-phone layouts.

| File | Density | Intent |
|------|---------|--------|
| `blue-light-sparse.json` | Sparse | Perimeter + main roads, thin central campus |
| `blue-light-medium.json` | Medium | Stronger road/perimeter coverage, some interior |
| `blue-light-dense.json` | Dense | Higher visibility, still road/perimeter weighted |

## Marker colors

| Color | Hex | Meaning |
|-------|-----|---------|
| Blue | `#1D4ED8` | Exact reuse of a pole from `Blurlight_old.json` (cheapest) |
| Dark green | `#15803D` | New mount on a building exterior wall |
| Dark orange | `#EA580C` | Brand-new freestanding pole |

Each file also has building name labels and a **Total Blue Lights** box with the
color breakdown.

## Method

1. **Placement first.** Greedy maximum-coverage over campus walkway/road demand,
   weighted up on main roads and the perimeter, down in the central quad.
2. **Then reuse.** Any chosen spot with an old pole within 30 m adopts that
   pole's exact coordinates (blue).
3. **Then build.** Remaining spots become wall mounts if they sit against a
   building footprint (dark green), else new freestanding poles (dark orange).

Pole coordinates come only from `Blurlight_old.json`. Road centerlines and
building footprints are geometry context (what the satellite basemap shows).

## How to load

1. Open **My Maps** → create a new map
2. Import the JSON (same format as `Blurlight_old.json`)
3. Compare on the **satellite** basemap
