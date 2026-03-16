import type { GeoJSONFeatureCollection } from "@/lib/types/map";

export function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

export function normBearing(b: number) {
  return ((b % 360) + 360) % 360;
}

export function bearingTo(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
) {
  const φ1 = toRad(lat1),
    φ2 = toRad(lat2);
  const λ1 = toRad(lng1),
    λ2 = toRad(lng2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return normBearing(toDeg(Math.atan2(y, x)));
}

export function makeCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number,
  points = 64,
): GeoJSONFeatureCollection {
  const coords: Array<[number, number]> = [];
  const d = radiusMeters / 6378137;
  const [lon, latRad] = [toRad(lng), toRad(lat)];

  for (let i = 0; i <= points; i++) {
    const brng = (i * 2 * Math.PI) / points;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
        Math.cos(latRad) * Math.sin(d) * Math.cos(brng),
    );
    const lon2 =
      lon +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2),
      );
    coords.push([toDeg(lon2), toDeg(lat2)]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [coords] },
      },
    ],
  };
}
