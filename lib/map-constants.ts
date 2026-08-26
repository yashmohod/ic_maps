import type { StyleSpecification } from "maplibre-gl";

export const DEFAULT_CENTER = { lng: -76.494131, lat: 42.422108 } as const;
export const DEFAULT_ZOOM = 15.5;

/**
 * Self-hosted NYS ortho:
 * - z ≤ 18: spring 2023 12" (`public/tiles/satellite`)
 * - z ≥ 19: spring 2012 6" / half-foot (`public/tiles/satellite-6in`)
 */
export const SATELLITE_MAX_ZOOM = 21;
/** First zoom that uses half-foot (6") tiles. Overview (12") shows below this. */
export const SATELLITE_DETAIL_MIN_ZOOM = 19;

/** Tile URL path (appended after basePath). Overridden at runtime via withBasePath. */
export const SATELLITE_TILE_PATH = "/tiles/satellite/{z}/{x}/{y}.png";
export const SATELLITE_DETAIL_TILE_PATH =
  "/tiles/satellite-6in/{z}/{x}/{y}.png";

const CAMPUS_ORTHO_BOUNDS: [number, number, number, number] = [
  -76.5075, 42.4095, -76.4825, 42.4295,
];

export function buildSatelliteStyle(
  overviewTileUrl: string,
  detailTileUrl: string = overviewTileUrl,
): StyleSpecification {
  return {
    version: 8,
    name: "IC Maps Satellite (NYS Ortho 12in + 6in)",
    sources: {
      "satellite-overview": {
        type: "raster",
        tiles: [overviewTileUrl],
        tileSize: 256,
        minzoom: 12,
        maxzoom: SATELLITE_DETAIL_MIN_ZOOM - 1,
        attribution:
          "NYS Orthoimagery Program — Tompkins / Town of Ithaca spring 2023 (12 in)",
        bounds: CAMPUS_ORTHO_BOUNDS,
      },
      "satellite-detail": {
        type: "raster",
        tiles: [detailTileUrl],
        tileSize: 256,
        minzoom: SATELLITE_DETAIL_MIN_ZOOM,
        maxzoom: SATELLITE_MAX_ZOOM,
        attribution:
          "NYS Orthoimagery Program — Tompkins / Town of Ithaca spring 2012 (6 in)",
        bounds: CAMPUS_ORTHO_BOUNDS,
      },
    },
    layers: [
      {
        id: "satellite-overview",
        type: "raster",
        source: "satellite-overview",
        maxzoom: SATELLITE_DETAIL_MIN_ZOOM,
      },
      {
        id: "satellite-detail",
        type: "raster",
        source: "satellite-detail",
        minzoom: SATELLITE_DETAIL_MIN_ZOOM,
        maxzoom: SATELLITE_MAX_ZOOM + 1,
      },
    ],
  };
}

/** @deprecated Prefer buildSatelliteStyle(withBasePath(...)) — kept for imports. */
export const SATELLITE_STYLE: StyleSpecification = buildSatelliteStyle(
  `/ic_maps${SATELLITE_TILE_PATH}`,
  `/ic_maps${SATELLITE_DETAIL_TILE_PATH}`,
);

/** [[sw_lng, sw_lat], [ne_lng, ne_lat]] – compatible with maplibre LngLatBoundsLike */
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [-76.505098, 42.410851],
  [-76.483915, 42.427959],
];
