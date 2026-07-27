import { withBasePath } from "@/lib/base-path";

export type DeadMapFeatureLists = {
  outsideIds: number[];
  insideIds: number[];
};

export function routeReportDeadMapTarget(
  report: {
    featureType: string | null;
    nodeOutsideId: number | null;
    nodeInsideId: number | null;
  },
  isIndoor: (featureType: string | null) => boolean,
): { scope: "outside" | "inside"; id: number } | null {
  if (isIndoor(report.featureType) && report.nodeInsideId != null) {
    return { scope: "inside", id: report.nodeInsideId };
  }
  if (report.nodeOutsideId != null) {
    return { scope: "outside", id: report.nodeOutsideId };
  }
  return null;
}

export async function markRouteReportMapFeatureDead(
  target: { scope: "outside" | "inside"; id: number },
  value = true,
): Promise<DeadMapFeatureLists | null> {
  const resp = await fetch(withBasePath("/api/map/dead-map-feature"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: target.scope,
      id: target.id,
      value,
    }),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as DeadMapFeatureLists;
}
