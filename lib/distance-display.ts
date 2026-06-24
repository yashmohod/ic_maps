export type DistanceUnits = "imperial" | "metric";

export const DISTANCE_UNITS_STORAGE_KEY = "ic_maps_distance_units";

export function parseDistanceUnits(value: string | null): DistanceUnits {
  return value === "metric" ? "metric" : "imperial";
}

/** Format meters for display using user preference. */
export function formatDistanceMeters(
  distanceMeters: number,
  units: DistanceUnits,
): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "—";
  if (distanceMeters < 1) return units === "metric" ? "0 m" : "0 ft";

  if (units === "metric") {
    if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
    const km = distanceMeters / 1000;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }

  const feet = distanceMeters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const miles = distanceMeters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** Short label for live nav: "In 200 ft" / "In 60 m". */
export function formatDistanceAhead(
  distanceMeters: number,
  units: DistanceUnits,
): string {
  if (distanceMeters < 1) return "Now";
  return `In ${formatDistanceMeters(distanceMeters, units)}`;
}

export function formatRouteDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} hr ${rem} min` : `${hours} hr`;
}

/** Imperial distance for route ETA summaries (ft / mi). */
export function formatRouteDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "—";
  const feet = distanceMeters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const miles = distanceMeters / 1609.344;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function formatRouteEtaSummary(
  durationSeconds: number,
  distanceMeters: number,
): string {
  return `~${formatRouteDuration(durationSeconds)} · ${formatRouteDistance(distanceMeters)}`;
}
