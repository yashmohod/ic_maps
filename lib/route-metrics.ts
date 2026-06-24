import { calcDistance } from "@/lib/geo";
import type { NavConditions } from "@/lib/navigation-graph";

/** ~5 km/h — campus walking pace */
export const PEDESTRIAN_SPEED_MPS = 1.4;

/** ~13.4 mph — conservative campus driving average */
export const VEHICULAR_SPEED_MPS = 6;

/** Treat stair segments as ~35% longer (slower effective pace). */
export const STAIR_DISTANCE_FACTOR = 1.35;

export function speedMpsForNav(nav: NavConditions): number {
  return nav.is_vehicular && !nav.is_pedestrian
    ? VEHICULAR_SPEED_MPS
    : PEDESTRIAN_SPEED_MPS;
}

export function durationSecondsFromDistance(
  distanceMeters: number,
  nav: NavConditions,
): number {
  if (distanceMeters <= 0) return 0;
  const speed = speedMpsForNav(nav);
  return Math.max(1, Math.round(distanceMeters / speed));
}

export function lineStringLengthMeters(
  coordinates: Array<[number, number]>,
): number {
  if (coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lng0, lat0] = coordinates[i - 1]!;
    const [lng1, lat1] = coordinates[i]!;
    total += calcDistance(lat0, lng0, lat1, lng1);
  }
  return total;
}
