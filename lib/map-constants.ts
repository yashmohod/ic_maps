import type { StyleSpecification } from "maplibre-gl";

export const DEFAULT_CENTER = { lng: -76.494131, lat: 42.422108 } as const;
export const DEFAULT_ZOOM = 15.5;

/**
 * Self-hosted NYS Tompkins / Town of Ithaca spring 2023 12" ortho
 * (built by scripts/build-campus-ortho-tiles.py into public/tiles/satellite).
 * maxzoom 21 — native imagery is ~1 ft; z19–20 is true detail, z21 is mild oversample.
 */
export const SATELLITE_MAX_ZOOM = 21;

/** Tile URL path (appended after basePath). Overridden at runtime via withBasePath. */
export const SATELLITE_TILE_PATH = "/tiles/satellite/{z}/{x}/{y}.png";

export function buildSatelliteStyle(tileUrlTemplate: string): StyleSpecification {
  return {
    version: 8,
    name: "IC Maps Satellite (NYS Ortho 2023)",
    sources: {
      satellite: {
        type: "raster",
        tiles: [tileUrlTemplate],
        tileSize: 256,
        minzoom: 12,
        maxzoom: SATELLITE_MAX_ZOOM,
        attribution:
          "NYS Orthoimagery Program — Tompkins County / Town of Ithaca spring 2023 (12 in)",
        bounds: [-76.5075, 42.4095, -76.4825, 42.4295],
      },
    },
    layers: [
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        maxzoom: SATELLITE_MAX_ZOOM + 1,
      },
    ],
  };
}

/** @deprecated Prefer buildSatelliteStyle(withBasePath(...)) — kept for imports. */
export const SATELLITE_STYLE: StyleSpecification = buildSatelliteStyle(
  `/ic_maps${SATELLITE_TILE_PATH}`,
);

/** [[sw_lng, sw_lat], [ne_lng, ne_lat]] – compatible with maplibre LngLatBoundsLike */
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [-76.505098, 42.410851],
  [-76.483915, 42.427959],
];
