import type { StyleSpecification } from "maplibre-gl";

export const DEFAULT_CENTER = { lng: -76.494131, lat: 42.422108 } as const;
export const DEFAULT_ZOOM = 15.5;

/** Esri World Imagery — free public tiles; attribution required. */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: "IC Maps Satellite",
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
};

/** [[sw_lng, sw_lat], [ne_lng, ne_lat]] – compatible with maplibre LngLatBoundsLike */
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [-76.505098, 42.410851],
  [-76.483915, 42.427959],
];
