#!/usr/bin/env python3
"""Generate sparse / medium / dense blue-light MyMaps proposals.

Order of operations (placement first, cost second):
  1. Pick the OPTIMAL locations by greedy weighted coverage of campus
     walkways/roads. Demand is weighted up on main roads and the campus
     perimeter, down in the central quad, so phones land where people are
     exposed rather than evenly.
  2. For each chosen location, if a pole from Blurlight_old.json sits within
     SNAP_M, reuse that pole's EXACT coordinates (blue -> cheapest).
  3. Otherwise, mount on a building exterior wall if the spot is against one
     (dark green), else stand a brand-new pole (dark orange).

The only source of blue-light poles is Blurlight_old.json. Campus road
centerlines and building footprints are used as geometry (what the satellite
basemap shows), never as pole locations.
"""
from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKUP = ROOT / "backups/ic_maps_2026-08-24T14-22-37-528Z"
OUT = ROOT / "data/blue-light-proposals"
OLD_EXPORT = ROOT / "Blurlight_old.json"
OSM = ROOT / "data/campus-osm.json"

EXISTING_COLOR = "#1D4ED8"  # blue - exact reuse of an old pole
WALL_COLOR = "#15803D"  # dark green - mounted on a building exterior wall
NEW_COLOR = "#EA580C"  # dark orange - brand-new freestanding pole

COUNT_LAT, COUNT_LNG = 42.42855, -76.50135
MAIN_HIGHWAYS = {"secondary", "tertiary", "unclassified", "residential"}

SNAP_M = 30.0  # reuse an old pole if it is this close to the optimal spot
ROAD_BAND_M = 30.0
PERIMETER_BAND_M = 55.0
CENTRAL_RADIUS_M = 320.0
WALL_OFFSET_M = 3.0  # stand just clear of the wall face
WALL_NEAR_PATH_M = 25.0  # a wall mount must still be reachable from a path
WALL_CONTACT_M = 6.0  # this close to a footprint => mountable on the wall
DEMAND_FOOTPRINT_M = 120.0  # ignore demand far outside the old-map extent

M_PER_LAT = 111_320.0
M_PER_LNG = 111_320.0 * math.cos(math.radians(42.42))


def hav(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371000.0
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(min(1.0, h)))


def load_csv(name: str) -> list[dict]:
    with open(BACKUP / name, newline="") as f:
        return list(csv.DictReader(f))


def dist_point_seg(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    px, py = p[1] * M_PER_LNG, p[0] * M_PER_LAT
    ax, ay = a[1] * M_PER_LNG, a[0] * M_PER_LAT
    bx, by = b[1] * M_PER_LNG, b[0] * M_PER_LAT
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def convex_hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    raw = sorted({(lng, lat) for lat, lng in pts})
    if len(raw) <= 2:
        return [(lat, lng) for lng, lat in raw]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in raw:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(raw):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [(lat, lng) for lng, lat in hull]


class SegIndex:
    """Grid-bucketed segments so nearest-distance queries stay cheap.

    ponytail: uniform 60 m grid, no R-tree; fine for one campus.
    """

    CELL = 60.0

    def __init__(self, segs: list[tuple[tuple[float, float], tuple[float, float]]]):
        self.segs = segs
        self.grid: dict[tuple[int, int], list[int]] = {}
        for i, (a, b) in enumerate(segs):
            for lat, lng in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
                self.grid.setdefault(self._key(lat, lng), []).append(i)

    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        return (int(lat * M_PER_LAT // self.CELL), int(lng * M_PER_LNG // self.CELL))

    def distance(self, lat: float, lng: float, limit: float = 200.0) -> float:
        cr = int(limit // self.CELL) + 1
        cx, cy = self._key(lat, lng)
        best = 1e18
        seen: set[int] = set()
        for dx in range(-cr, cr + 1):
            for dy in range(-cr, cr + 1):
                for i in self.grid.get((cx + dx, cy + dy), []):
                    if i in seen:
                        continue
                    seen.add(i)
                    a, b = self.segs[i]
                    best = min(best, dist_point_seg((lat, lng), a, b))
        return best


class PointIndex:
    CELL = 40.0

    def __init__(self, pts: list[tuple[float, float]]):
        self.pts = pts
        self.grid: dict[tuple[int, int], list[int]] = {}
        for i, (lat, lng) in enumerate(pts):
            self.grid.setdefault(self._key(lat, lng), []).append(i)

    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        return (int(lat * M_PER_LAT // self.CELL), int(lng * M_PER_LNG // self.CELL))

    def within(self, lat: float, lng: float, radius: float) -> list[int]:
        cr = int(radius // self.CELL) + 1
        cx, cy = self._key(lat, lng)
        out: list[int] = []
        for dx in range(-cr, cr + 1):
            for dy in range(-cr, cr + 1):
                for i in self.grid.get((cx + dx, cy + dy), []):
                    if hav((lat, lng), self.pts[i]) <= radius:
                        out.append(i)
        return out

    def nearest(self, lat: float, lng: float, limit: float) -> tuple[int, float] | None:
        best, best_d = None, 1e18
        for i in self.within(lat, lng, limit):
            d = hav((lat, lng), self.pts[i])
            if d < best_d:
                best, best_d = i, d
        return None if best is None else (best, best_d)


def outward_wall_point(
    ring: list[list[float]], edge_i: int
) -> tuple[float, float] | None:
    """Midpoint of a footprint edge, pushed WALL_OFFSET_M away from the centroid."""
    a_lng, a_lat = ring[edge_i]
    b_lng, b_lat = ring[edge_i + 1]
    mid_lat, mid_lng = (a_lat + b_lat) / 2, (a_lng + b_lng) / 2
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    c_lng, c_lat = sum(xs) / len(xs), sum(ys) / len(ys)
    dx = (mid_lng - c_lng) * M_PER_LNG
    dy = (mid_lat - c_lat) * M_PER_LAT
    n = math.hypot(dx, dy)
    if n < 1e-6:
        return None
    return (
        mid_lat + (dy / n * WALL_OFFSET_M) / M_PER_LAT,
        mid_lng + (dx / n * WALL_OFFSET_M) / M_PER_LNG,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- The only blue-light source: the user's old map -------------------
    old_json = json.loads(OLD_EXPORT.read_text())
    old_poles = [
        {"id": n["id"], "lat": float(n["lat"]), "lng": float(n["lng"])}
        for n in old_json["nodes"]
    ]
    old_index = PointIndex([(p["lat"], p["lng"]) for p in old_poles])
    building_texts = [
        {
            "text": t["text"],
            "lat": t["lat"],
            "lng": t["lng"],
            "font_size": int(t.get("font_size") or 12),
        }
        for t in old_json.get("texts", [])
        if t.get("text")
        and "Total Blue" not in t["text"]
        and "density" not in t["text"].lower()
    ]

    # ---- Campus geometry (roads + footprints; matches satellite imagery) --
    osm = json.loads(OSM.read_text())["elements"]
    osm_nodes = {e["id"]: (e["lat"], e["lon"]) for e in osm if e["type"] == "node"}
    road_segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for e in osm:
        if e["type"] != "way":
            continue
        if (e.get("tags") or {}).get("highway") not in MAIN_HIGHWAYS:
            continue
        pts = [osm_nodes[r] for r in e.get("nodes", []) if r in osm_nodes]
        road_segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    roads = SegIndex(road_segs)

    buildings: list[dict] = []
    wall_segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for d in load_csv("destination.csv"):
        if (d.get("is_parking_lot") or "").lower() in ("t", "true", "1"):
            continue
        poly = json.loads(d["polygon"])
        geom = poly["geometry"] if poly.get("type") == "Feature" else poly
        coords = geom["coordinates"]
        ring = coords[0] if geom["type"] == "Polygon" else coords[0][0]
        buildings.append({"name": d["name"], "ring": ring})
        for i in range(len(ring) - 1):
            wall_segs.append(
                ((ring[i][1], ring[i][0]), (ring[i + 1][1], ring[i + 1][0]))
            )
    walls = SegIndex(wall_segs)

    path_pts: list[tuple[float, float]] = []
    for n in load_csv("node_outside.csv"):
        if (n.get("is_dead") or "").lower() in ("t", "true", "1"):
            continue
        walkable = (n.get("is_pedestrian") or "").lower() in ("t", "true", "1")
        drivable = (n.get("is_vehicular") or "").lower() in ("t", "true", "1")
        if not (walkable or drivable):
            continue
        path_pts.append((float(n["lat"]), float(n["lng"])))

    hull = convex_hull([(p["lat"], p["lng"]) for p in old_poles])
    perimeter = SegIndex(
        [(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull))]
    )
    centroid = (
        sum(p["lat"] for p in old_poles) / len(old_poles),
        sum(p["lng"] for p in old_poles) / len(old_poles),
    )

    # ---- Step 1: where SHOULD phones go? ---------------------------------
    def demand_weight(lat: float, lng: float) -> float:
        d_road = roads.distance(lat, lng)
        d_peri = perimeter.distance(lat, lng)
        d_center = hav((lat, lng), centroid)
        w = 1.0
        if d_road <= ROAD_BAND_M:
            w += 1.2
        if d_peri <= PERIMETER_BAND_M:
            w += 0.8
        if d_center < CENTRAL_RADIUS_M and d_road > ROAD_BAND_M:
            # central quad is well-travelled but low-risk; keep it thin
            w *= 0.35
        return w

    demand: list[tuple[float, float]] = []
    weights: list[float] = []
    for lat, lng in path_pts[::2]:
        if perimeter.distance(lat, lng, 400.0) > DEMAND_FOOTPRINT_M and hav(
            (lat, lng), centroid
        ) > CENTRAL_RADIUS_M:
            # outside the campus extent implied by the old map
            if old_index.nearest(lat, lng, 150.0) is None:
                continue
        demand.append((lat, lng))
        weights.append(demand_weight(lat, lng))
    demand_index = PointIndex(demand)

    # Candidate optimal spots: thinned path nodes + building wall faces
    candidates: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for lat, lng in path_pts:
        key = (int(lat * M_PER_LAT // 25), int(lng * M_PER_LNG // 25))
        if key in seen:
            continue
        seen.add(key)
        candidates.append({"lat": lat, "lng": lng, "wall": False})
    for b in buildings:
        n_edges = len(b["ring"]) - 1
        for ei in range(0, n_edges, max(1, n_edges // 6)):
            pt = outward_wall_point(b["ring"], ei)
            if pt is None:
                continue
            lat, lng = pt
            if not demand_index.within(lat, lng, WALL_NEAR_PATH_M):
                continue
            candidates.append(
                {"lat": lat, "lng": lng, "wall": True, "building": b["name"]}
            )

    for c in candidates:
        c["reuse"] = old_index.nearest(c["lat"], c["lng"], SNAP_M) is not None
        c["central"] = hav((c["lat"], c["lng"]), centroid) < CENTRAL_RADIUS_M

    print(
        f"old={len(old_poles)} candidates={len(candidates)} "
        f"(wall={sum(1 for c in candidates if c['wall'])}) demand={len(demand)} "
        f"roads={len(road_segs)} buildings={len(buildings)}"
    )

    def select(
        cover_r: float, spacing: float, central_spacing: float, max_poles: int
    ) -> list[dict]:
        """Greedy max weighted coverage; reuse only breaks ties."""
        chosen: list[dict] = []
        uncovered = set(range(len(demand)))

        def spacing_at(lat: float, lng: float) -> float:
            return central_spacing if hav((lat, lng), centroid) < CENTRAL_RADIUS_M else spacing

        while uncovered and len(chosen) < max_poles:
            best, best_key = None, None
            for c in candidates:
                sp = spacing_at(c["lat"], c["lng"])
                if any(
                    hav((c["lat"], c["lng"]), (s["lat"], s["lng"])) < sp for s in chosen
                ):
                    continue
                covered = [
                    i for i in demand_index.within(c["lat"], c["lng"], cover_r)
                    if i in uncovered
                ]
                if not covered:
                    continue
                gain = sum(weights[i] for i in covered)
                # cost tie-breakers: reuse an old pole, else a wall mount
                key = (round(gain, 3), c["reuse"], c["wall"])
                if best_key is None or key > best_key:
                    best, best_key = c, key
            if best is None:
                break
            chosen.append(best)
            for i in demand_index.within(best["lat"], best["lng"], cover_r):
                uncovered.discard(i)
        return chosen

    def resolve(chosen: list[dict], spacing: float) -> list[dict]:
        """Step 2/3: snap to an exact old pole when one is near, else new/wall."""
        final: list[dict] = []
        used_old: set[int] = set()
        for c in chosen:
            hit = None
            for i in sorted(
                old_index.within(c["lat"], c["lng"], SNAP_M),
                key=lambda i: hav((c["lat"], c["lng"]), (old_poles[i]["lat"], old_poles[i]["lng"])),
            ):
                if i not in used_old:
                    hit = i
                    break
            if hit is not None:
                pole = old_poles[hit]
                pt = {
                    "lat": pole["lat"],
                    "lng": pole["lng"],
                    "kind": "existing",
                    "src": f"old#{pole['id']}",
                }
            else:
                on_wall = c["wall"] or walls.distance(c["lat"], c["lng"]) <= WALL_CONTACT_M
                pt = {
                    "lat": c["lat"],
                    "lng": c["lng"],
                    "kind": "wall" if on_wall else "new",
                    "src": c.get("building", ""),
                }
            # snapping can pull two picks together; drop the redundant one
            if any(
                hav((pt["lat"], pt["lng"]), (f["lat"], f["lng"])) < spacing * 0.55
                for f in final
            ):
                continue
            if hit is not None:
                used_old.add(hit)
            final.append(pt)
        return final

    def coverage(sel: list[dict], cover_r: float) -> float:
        total = sum(weights)
        hit = 0.0
        for i, d in enumerate(demand):
            if any(hav(d, (s["lat"], s["lng"])) <= cover_r for s in sel):
                hit += weights[i]
        return hit / total if total else 0.0

    configs = [
        {
            "key": "sparse",
            "title": "Blue Light — Sparse (perimeter / main roads)",
            "cover_r": 130.0,
            "spacing": 115.0,
            "central_spacing": 175.0,
            "max_poles": 42,
            "file": "blue-light-sparse.json",
        },
        {
            "key": "medium",
            "title": "Blue Light — Medium density",
            "cover_r": 95.0,
            "spacing": 80.0,
            "central_spacing": 120.0,
            "max_poles": 68,
            "file": "blue-light-medium.json",
        },
        {
            "key": "dense",
            "title": "Blue Light — Dense (high visibility)",
            "cover_r": 70.0,
            "spacing": 55.0,
            "central_spacing": 85.0,
            "max_poles": 98,
            "file": "blue-light-dense.json",
        },
    ]

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    summary = []

    for cfg in configs:
        chosen = select(
            cfg["cover_r"], cfg["spacing"], cfg["central_spacing"], cfg["max_poles"]
        )
        placed = resolve(chosen, cfg["spacing"])
        frac = coverage(placed, cfg["cover_r"])

        nodes = []
        n_exist = n_wall = n_new = 0
        for i, p in enumerate(placed, start=1):
            if p["kind"] == "existing":
                n_exist += 1
                color, name = EXISTING_COLOR, f"Blue Light {i} (existing pole · {p['src']})"
            elif p["kind"] == "wall":
                n_wall += 1
                label = f" · {p['src']}" if p["src"] else ""
                color, name = WALL_COLOR, f"Blue Light {i} (building wall{label})"
            else:
                n_new += 1
                color, name = NEW_COLOR, f"Blue Light {i} (new pole)"
            nodes.append(
                {"id": i, "lat": p["lat"], "lng": p["lng"], "name": name, "color": color}
            )

        exact_old = {(p["lat"], p["lng"]) for p in old_poles}
        reused_ids = [n["name"].split("old#")[1].rstrip(")") for n in nodes
                      if n["color"] == EXISTING_COLOR]
        assert all(
            (n["lat"], n["lng"]) in exact_old
            for n in nodes
            if n["color"] == EXISTING_COLOR
        ), "blue node is not an exact Blurlight_old.json coordinate"
        assert len(reused_ids) == len(set(reused_ids)), "old pole reused twice"
        assert all(
            walls.distance(n["lat"], n["lng"]) <= WALL_CONTACT_M
            for n in nodes
            if n["color"] == WALL_COLOR
        ), "green node is not against a building wall"

        count = len(nodes)
        texts = list(building_texts) + [
            {
                "text": (
                    f"Total Blue Lights: {count}\n"
                    f"({cfg['key'].title()} · ~{int(cfg['cover_r'])}m reach)\n"
                    f"Blue = {n_exist} reused · Green = {n_wall} wall · "
                    f"Orange = {n_new} new"
                ),
                "lat": COUNT_LAT,
                "lng": COUNT_LNG,
                "font_size": 16,
            }
        ]
        out_path = OUT / cfg["file"]
        out_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "exportedAt": now,
                    "mapName": cfg["title"],
                    "nodes": nodes,
                    "edges": [],
                    "polygons": [],
                    "lines": [],
                    "points": [],
                    "texts": texts,
                },
                indent=2,
            )
            + "\n"
        )

        nns = sorted(
            min(
                hav((a["lat"], a["lng"]), (b["lat"], b["lng"]))
                for j, b in enumerate(nodes)
                if i != j
            )
            for i, a in enumerate(nodes)
        )
        nn_med = nns[len(nns) // 2] if len(nns) >= 2 else 0.0

        summary.append(
            {
                "density": cfg["key"],
                "file": str(out_path.relative_to(ROOT)),
                "count": count,
                "reused_existing": n_exist,
                "building_wall": n_wall,
                "new_freestanding": n_new,
                "weighted_coverage": round(frac, 3),
                "cover_radius_m": cfg["cover_r"],
                "min_spacing_m": cfg["spacing"],
                "central_spacing_m": cfg["central_spacing"],
                "median_nn_m": round(nn_med, 1),
            }
        )
        print(
            f"{cfg['key']}: {count} poles (blue={n_exist} green={n_wall} "
            f"orange={n_new}) coverage={frac:.1%} median NN={nn_med:.0f}m"
        )

    (OUT / "summary.json").write_text(
        json.dumps(
            {
                "generatedAt": now,
                "source": {"file": "Blurlight_old.json", "poles": len(old_poles)},
                "snap_radius_m": SNAP_M,
                "colors": {
                    "existing": EXISTING_COLOR,
                    "building_wall": WALL_COLOR,
                    "new_freestanding": NEW_COLOR,
                },
                "variants": summary,
            },
            indent=2,
        )
        + "\n"
    )

    (OUT / "README.md").write_text(
        """# Blue light density proposals

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
"""
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
