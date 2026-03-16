export const DEFAULT_CENTER = { lng: -76.494131, lat: 42.422108 } as const;
export const DEFAULT_ZOOM = 15.5;

/** [[sw_lng, sw_lat], [ne_lng, ne_lat]] – compatible with maplibre LngLatBoundsLike */
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [-76.505098, 42.410851],
  [-76.483915, 42.427959],
];
