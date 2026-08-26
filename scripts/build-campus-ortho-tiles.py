#!/usr/bin/env python3
"""
Build Web Mercator PNG tiles from NYS Town of Ithaca 12\" ortho JP2s.

Usage:
  PYTHONPATH=.pydeps python3 scripts/build-campus-ortho-tiles.py
  PYTHONPATH=.pydeps python3 scripts/build-campus-ortho-tiles.py --maxzoom 21
"""
from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".pydeps"))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

WEST, SOUTH, EAST, NORTH = -76.5075, 42.4095, -76.4825, 42.4295

LON0 = math.radians(-76.58333333333333)
LAT0 = math.radians(40.0)
K0 = 0.9999375
FE_FT = 820208.3330000002
FN_FT = 0.0
FT_TO_M = 0.30480060960121924
A_EARTH = 6378137.0
F = 1 / 298.257222101
E2 = F * (2 - F)
EP2 = E2 / (1 - E2)

OPJ = Path("/tmp/openjpeg-v2.5.3-linux-x86_64/bin/opj_decompress")
OPJ_LIB = Path("/tmp/openjpeg-v2.5.3-linux-x86_64/lib")
MERC_MAX = 20037508.342789244


def forward_ny_central_ft(lat_deg: float, lon_deg: float) -> tuple[float, float]:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    tan_lat = math.tan(lat)
    N = A_EARTH / math.sqrt(1 - E2 * sin_lat * sin_lat)
    T = tan_lat * tan_lat
    C = EP2 * cos_lat * cos_lat
    Aa = (lon - LON0) * cos_lat
    M = A_EARTH * (
        (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2**3 / 256) * lat
        - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2**3 / 1024) * math.sin(2 * lat)
        + (15 * E2 * E2 / 256 + 45 * E2**3 / 1024) * math.sin(4 * lat)
        - (35 * E2**3 / 3072) * math.sin(6 * lat)
    )
    M0 = A_EARTH * (
        (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2**3 / 256) * LAT0
        - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2**3 / 1024) * math.sin(2 * LAT0)
        + (15 * E2 * E2 / 256 + 45 * E2**3 / 1024) * math.sin(4 * LAT0)
        - (35 * E2**3 / 3072) * math.sin(6 * LAT0)
    )
    x_m = (
        K0
        * N
        * (
            Aa
            + (1 - T + C) * Aa**3 / 6
            + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa**5 / 120
        )
        + FE_FT * FT_TO_M
    )
    y_m = (
        K0
        * (
            M
            - M0
            + N
            * tan_lat
            * (
                Aa**2 / 2
                + (5 - T + 9 * C + 4 * C * C) * Aa**4 / 24
                + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa**6 / 720
            )
        )
        + FN_FT * FT_TO_M
    )
    return x_m / FT_TO_M, y_m / FT_TO_M


def forward_ny_central_ft_vec(
    lat_deg: np.ndarray, lon_deg: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    sin_lat = np.sin(lat)
    cos_lat = np.cos(lat)
    tan_lat = np.tan(lat)
    N = A_EARTH / np.sqrt(1 - E2 * sin_lat * sin_lat)
    T = tan_lat * tan_lat
    C = EP2 * cos_lat * cos_lat
    Aa = (lon - LON0) * cos_lat
    M = A_EARTH * (
        (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2**3 / 256) * lat
        - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2**3 / 1024) * np.sin(2 * lat)
        + (15 * E2 * E2 / 256 + 45 * E2**3 / 1024) * np.sin(4 * lat)
        - (35 * E2**3 / 3072) * np.sin(6 * lat)
    )
    M0 = A_EARTH * (
        (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2**3 / 256) * LAT0
        - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2**3 / 1024) * math.sin(2 * LAT0)
        + (15 * E2 * E2 / 256 + 45 * E2**3 / 1024) * math.sin(4 * LAT0)
        - (35 * E2**3 / 3072) * math.sin(6 * LAT0)
    )
    x_m = (
        K0
        * N
        * (
            Aa
            + (1 - T + C) * Aa**3 / 6
            + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa**5 / 120
        )
        + FE_FT * FT_TO_M
    )
    y_m = (
        K0
        * (
            M
            - M0
            + N
            * tan_lat
            * (
                Aa**2 / 2
                + (5 - T + 9 * C + 4 * C * C) * Aa**4 / 24
                + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa**6 / 720
            )
        )
        + FN_FT * FT_TO_M
    )
    return x_m / FT_TO_M, y_m / FT_TO_M


def world_to_ll_vec(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lng = x * 180.0 / MERC_MAX
    lat = np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - math.pi / 2)
    return lng, lat


def tile_bounds_merc(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**z
    tile_size = 2 * MERC_MAX / n
    minx = -MERC_MAX + x * tile_size
    maxx = -MERC_MAX + (x + 1) * tile_size
    maxy = MERC_MAX - y * tile_size
    miny = MERC_MAX - (y + 1) * tile_size
    return minx, miny, maxx, maxy


def lonlat_to_tile(lng: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int(
        (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    )
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def read_j2w(path: Path) -> tuple[float, float, float, float]:
    lines = path.read_text().strip().splitlines()
    return float(lines[0]), float(lines[3]), float(lines[4]), float(lines[5])


def jp2_extent_ft(
    j2w: Path, width: int, height: int
) -> tuple[float, float, float, float]:
    A, D, C, F = read_j2w(j2w)
    minx = C - A / 2
    maxy = F - D / 2
    maxx = minx + width * A
    miny = maxy + height * D
    return minx, miny, maxx, maxy


def decompress(jp2: Path, out_png: Path) -> None:
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{OPJ_LIB}:{env.get('LD_LIBRARY_PATH', '')}"
    subprocess.run(
        [str(OPJ), "-i", str(jp2), "-o", str(out_png)],
        check=True,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def render_tile(
    mosaic: np.ndarray,
    cminx: float,
    cmaxy: float,
    z: int,
    tx: int,
    ty: int,
) -> Image.Image | None:
    tminx, tminy, tmaxx, tmaxy = tile_bounds_merc(z, tx, ty)
    xs = np.linspace(tminx, tmaxx, 256, endpoint=False) + (tmaxx - tminx) / 512.0
    ys = np.linspace(tmaxy, tminy, 256, endpoint=False) - (tmaxy - tminy) / 512.0
    mx, my = np.meshgrid(xs, ys)
    lng, lat = world_to_ll_vec(mx, my)
    sx, sy = forward_ny_central_ft_vec(lat, lng)
    u = np.floor(sx - cminx).astype(np.int32)
    v = np.floor(cmaxy - sy).astype(np.int32)
    h, w = mosaic.shape[:2]
    valid = (u >= 0) & (u < w) & (v >= 0) & (v < h)
    out = np.zeros((256, 256, 4), dtype=np.uint8)
    if not valid.any():
        return None
    uu = np.clip(u, 0, w - 1)
    vv = np.clip(v, 0, h - 1)
    sampled = mosaic[vv, uu]
    out[valid] = sampled[valid]
    if out[:, :, 3].max() == 0:
        return None
    return Image.fromarray(out, "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minzoom", type=int, default=12)
    ap.add_argument("--maxzoom", type=int, default=21)
    ap.add_argument("--src", type=Path, default=ROOT / "IC_sat" / "twn")
    ap.add_argument(
        "--out", type=Path, default=ROOT / "public" / "tiles" / "satellite"
    )
    ap.add_argument("--work", type=Path, default=ROOT / "IC_sat" / "work")
    ap.add_argument(
        "--no-clear",
        action="store_true",
        help="Do not delete existing tiles under --out (resume / add zooms)",
    )
    args = ap.parse_args()

    if not OPJ.exists():
        sys.exit(f"Missing OpenJPEG at {OPJ}")

    corners = [
        forward_ny_central_ft(SOUTH, WEST),
        forward_ny_central_ft(SOUTH, EAST),
        forward_ny_central_ft(NORTH, WEST),
        forward_ny_central_ft(NORTH, EAST),
    ]
    cminx = min(c[0] for c in corners) - 200
    cmaxx = max(c[0] for c in corners) + 200
    cminy = min(c[1] for c in corners) - 200
    cmaxy = max(c[1] for c in corners) + 200
    print(f"campus SP ft: {cminx:.0f},{cminy:.0f} → {cmaxx:.0f},{cmaxy:.0f}")

    jp2s = sorted(args.src.glob("*.jp2"))
    selected: list[tuple[Path, tuple[float, float, float, float]]] = []
    for jp2 in jp2s:
        j2w = jp2.with_suffix(".j2w")
        if not j2w.exists():
            continue
        ext = jp2_extent_ft(j2w, 3000, 2000)
        minx, miny, maxx, maxy = ext
        if maxx < cminx or minx > cmaxx or maxy < cminy or miny > cmaxy:
            continue
        selected.append((jp2, ext))

    print(f"selected {len(selected)} / {len(jp2s)} JP2s")
    if not selected:
        sys.exit("No tiles intersect campus")

    args.work.mkdir(parents=True, exist_ok=True)
    mosaic_w = int(math.ceil(cmaxx - cminx))
    mosaic_h = int(math.ceil(cmaxy - cminy))
    print(f"SP mosaic {mosaic_w}×{mosaic_h} px")
    mosaic_img = Image.new("RGBA", (mosaic_w, mosaic_h), (0, 0, 0, 0))

    for jp2, (rminx, rminy, rmaxx, rmaxy) in selected:
        png = args.work / f"{jp2.stem}.png"
        if not png.exists():
            print(f"  decode {jp2.name}")
            decompress(jp2, png)
        im = Image.open(png).convert("RGBA")
        r, g, b, _a = im.split()
        im = Image.merge("RGBA", (r, g, b, Image.new("L", im.size, 255)))
        left = int(round(rminx - cminx))
        top = int(round(cmaxy - rmaxy))
        mosaic_img.paste(im, (left, top))
        print(f"  paste {jp2.name} at ({left},{top})")

    mosaic_path = args.work / "campus_sp_mosaic.png"
    mosaic_img.save(mosaic_path)
    print(f"wrote {mosaic_path} ({mosaic_path.stat().st_size / 1e6:.1f} MB)")
    mosaic = np.asarray(mosaic_img)

    if args.out.exists() and not args.no_clear:
        for p in args.out.rglob("*.png"):
            p.unlink()

    total = 0
    for z in range(args.minzoom, args.maxzoom + 1):
        x0, y1 = lonlat_to_tile(WEST, SOUTH, z)
        x1, y0 = lonlat_to_tile(EAST, NORTH, z)
        x_lo, x_hi = min(x0, x1), max(x0, x1)
        y_lo, y_hi = min(y0, y1), max(y0, y1)
        count = 0
        for tx in range(x_lo, x_hi + 1):
            xdir = args.out / str(z) / str(tx)
            xdir.mkdir(parents=True, exist_ok=True)
            for ty in range(y_lo, y_hi + 1):
                tile = render_tile(mosaic, cminx, cmaxy, z, tx, ty)
                if tile is None:
                    continue
                tile.save(xdir / f"{ty}.png", optimize=True)
                count += 1
                total += 1
        print(f"z{z}: {count} tiles")

    print(f"done — {total} tiles → {args.out}")


if __name__ == "__main__":
    main()
