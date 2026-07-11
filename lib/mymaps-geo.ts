import type { Feature, GeoJsonProperties, LineString, Polygon } from "geojson";

/** Parse a stored polygon JSON string into a Polygon Feature. */
export function parsePolygonFeature(
  raw: string,
): Feature<Polygon, GeoJsonProperties> | null {
  try {
    const obj = JSON.parse(raw);
    if (obj?.type === "Feature" && obj.geometry?.type === "Polygon") {
      return obj as Feature<Polygon, GeoJsonProperties>;
    }
    if (obj?.type === "Polygon") {
      return { type: "Feature", properties: {}, geometry: obj };
    }
    if (obj?.type === "FeatureCollection" && obj.features?.[0]) {
      const first = obj.features[0];
      if (first?.geometry?.type === "Polygon") {
        return first as Feature<Polygon, GeoJsonProperties>;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Parse a stored line JSON string into a LineString Feature. */
export function parseLineFeature(
  raw: string,
): Feature<LineString, GeoJsonProperties> | null {
  try {
    const obj = JSON.parse(raw);
    if (obj?.type === "Feature" && obj.geometry?.type === "LineString") {
      return obj as Feature<LineString, GeoJsonProperties>;
    }
    if (obj?.type === "LineString") {
      return { type: "Feature", properties: {}, geometry: obj };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function ringCentroid(
  ring: Array<[number, number]>,
): { lng: number; lat: number } | null {
  if (!ring.length) return null;
  const closed =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1];
  const n = closed ? ring.length - 1 : ring.length;
  if (n <= 0) return null;
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lng += ring[i]![0];
    lat += ring[i]![1];
  }
  return { lng: lng / n, lat: lat / n };
}

/** Approximate centroid / midpoint for move handles. */
export function featureCentroid(
  feature: Feature,
): { lng: number; lat: number } | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    return { lng: g.coordinates[0], lat: g.coordinates[1] };
  }
  if (g.type === "LineString") {
    const coords = g.coordinates as Array<[number, number]>;
    if (!coords.length) return null;
    if (coords.length >= 2) {
      const mid = Math.floor((coords.length - 1) / 2);
      const a = coords[mid]!;
      const b = coords[mid + 1] ?? a;
      return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
    }
    return { lng: coords[0]![0], lat: coords[0]![1] };
  }
  if (g.type === "Polygon") {
    return ringCentroid(g.coordinates[0] as Array<[number, number]>);
  }
  return null;
}

function translateCoords(coords: unknown, dLng: number, dLat: number): unknown {
  if (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return [coords[0] + dLng, coords[1] + dLat];
  }
  if (Array.isArray(coords)) {
    return coords.map((c) => translateCoords(c, dLng, dLat));
  }
  return coords;
}

/** Translate all coordinates of a Feature by delta lng/lat. */
export function translateFeature(
  feature: Feature,
  dLng: number,
  dLat: number,
): Feature {
  if (!feature.geometry) return feature;
  const geometry = feature.geometry as {
    type: string;
    coordinates: unknown;
  };
  return {
    ...feature,
    geometry: {
      type: geometry.type,
      coordinates: translateCoords(geometry.coordinates, dLng, dLat),
    } as Feature["geometry"],
  };
}
