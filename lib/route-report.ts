import { z } from "zod";

import type { GeoJSONFeatureCollection } from "@/lib/types/map";

export type RouteReportLocationType = "building" | "parking_lot" | "other";
export type RouteReportFeatureType =
  | "entrance"
  | "elevator"
  | "ramp"
  | "stairs"
  | "other";

export type RouteReportInsideNode = {
  id: number;
  nodeOutsideId: number | null;
  parentNodeInsideId: number | null;
  isElevator: boolean;
  isStairs: boolean;
  isRamp: boolean;
  isGroup: boolean;
  name?: string | null;
};

export type RouteReportEntranceNode = {
  id: number;
  lat: number;
  lng: number;
  name?: string | null;
};

export const LOCATION_TYPE_ITEMS = [
  { value: "building" as const, label: "Building" },
  { value: "parking_lot" as const, label: "Parking lot" },
  { value: "other" as const, label: "Other" },
];

export const FEATURE_TYPE_ITEMS = [
  { value: "entrance" as const, label: "Entrance" },
  { value: "elevator" as const, label: "Elevator" },
  { value: "ramp" as const, label: "Ramp" },
  { value: "stairs" as const, label: "Stairs" },
  { value: "other" as const, label: "Other" },
];

const optionalTextSchema = z
  .string()
  .trim()
  .max(5000, "Description must be at most 5000 characters")
  .optional()
  .or(z.literal(""));

const requiredTextSchema = z
  .string()
  .trim()
  .min(10, "Description must be at least 10 characters")
  .max(5000, "Description must be at most 5000 characters");

const pinSchema = z.object({
  pinLat: z.number().min(-90).max(90),
  pinLng: z.number().min(-180).max(180),
});

function campusLocationSchema(locationType: "building" | "parking_lot") {
  return z.discriminatedUnion("featureType", [
    z
      .object({
        locationType: z.literal(locationType),
        destinationId: z.number().int().positive(),
        featureType: z.literal("entrance"),
        nodeOutsideId: z.number().int().positive(),
        text: optionalTextSchema,
      })
      .strict(),
    z
      .object({
        locationType: z.literal(locationType),
        destinationId: z.number().int().positive(),
        featureType: z.enum(["elevator", "ramp", "stairs"]),
        nodeInsideId: z.number().int().positive(),
        text: optionalTextSchema,
      })
      .strict(),
    z
      .object({
        locationType: z.literal(locationType),
        destinationId: z.number().int().positive(),
        featureType: z.literal("other"),
        text: requiredTextSchema,
        pinLat: z.number().min(-90).max(90),
        pinLng: z.number().min(-180).max(180),
      })
      .strict(),
  ]);
}

export const routeReportPayloadSchema = z.union([
  z
    .object({
      locationType: z.literal("other"),
      text: requiredTextSchema,
      pinLat: z.number().min(-90).max(90),
      pinLng: z.number().min(-180).max(180),
    })
    .strict(),
  campusLocationSchema("building"),
  campusLocationSchema("parking_lot"),
]);

export type RouteReportPayload = z.infer<typeof routeReportPayloadSchema>;

export function filterInsideNodes(
  nodes: RouteReportInsideNode[],
  featureType: Exclude<RouteReportFeatureType, "entrance" | "other">,
): RouteReportInsideNode[] {
  return nodes.filter((node) => {
    if (node.isGroup) return false;
    if (featureType === "elevator") return node.isElevator;
    if (featureType === "stairs") return node.isStairs;
    if (featureType === "ramp") return node.isRamp;
    return false;
  });
}

function floorLabel(
  node: RouteReportInsideNode,
  allNodes: RouteReportInsideNode[],
): string {
  if (node.parentNodeInsideId == null) return "Floor unknown";
  const parent = allNodes.find((n) => n.id === node.parentNodeInsideId);
  if (!parent) return "Floor unknown";
  if (parent.isGroup) {
    return parent.name?.trim() || `Floor ${parent.id}`;
  }
  return floorLabel(parent, allNodes);
}

const FEATURE_LABEL: Record<
  Exclude<RouteReportFeatureType, "entrance" | "other">,
  string
> = {
  elevator: "Elevator",
  stairs: "Stairs",
  ramp: "Ramp",
};

export function insideNodeLabel(
  node: RouteReportInsideNode,
  allNodes: RouteReportInsideNode[],
  featureType: Exclude<RouteReportFeatureType, "entrance" | "other">,
  index: number,
): string {
  const floor = floorLabel(node, allNodes);
  if (node.name?.trim()) {
    return floor !== "Floor unknown"
      ? `${node.name.trim()} — ${floor}`
      : node.name.trim();
  }
  return `${FEATURE_LABEL[featureType]} — ${floor} (#${node.id})`;
}

export function entranceLabel(
  node: RouteReportEntranceNode,
  index: number,
): string {
  if (node.name?.trim()) return node.name.trim();
  return `Entrance ${index + 1}`;
}

export function featureTypeEmptyMessage(
  featureType: RouteReportFeatureType,
): string {
  switch (featureType) {
    case "entrance":
      return "No entrances recorded for this location.";
    case "elevator":
      return "No elevators recorded for this location.";
    case "ramp":
      return "No ramps recorded for this location.";
    case "stairs":
      return "No stairs recorded for this location";
    default:
      return "";
  }
}

export function requiresDescription(
  locationType: RouteReportLocationType | null,
  featureType: RouteReportFeatureType | null,
): boolean {
  if (locationType === "other") return true;
  if (featureType === "other") return true;
  return false;
}

export function requiresPin(
  locationType: RouteReportLocationType | null,
  featureType: RouteReportFeatureType | null,
): boolean {
  if (locationType === "other") return true;
  if (featureType === "other") return true;
  return false;
}

export function showsMap(
  locationType: RouteReportLocationType | null,
  featureType: RouteReportFeatureType | null,
): boolean {
  if (locationType === "other") return true;
  if (featureType === "entrance" || featureType === "other") return true;
  return false;
}

export function mapMode(
  locationType: RouteReportLocationType | null,
  featureType: RouteReportFeatureType | null,
): "freePin" | "entrance" {
  if (featureType === "entrance") return "entrance";
  return "freePin";
}

export function isIndoorRouteReport(
  featureType: RouteReportFeatureType | string | null | undefined,
): boolean {
  return (
    featureType === "elevator" ||
    featureType === "ramp" ||
    featureType === "stairs"
  );
}

export function isEntranceRouteReport(
  featureType: RouteReportFeatureType | string | null | undefined,
): boolean {
  return featureType === "entrance";
}

/** Group key for admin route reports: one group per specific map feature. */
export function routeReportFeatureGroupKey(report: {
  featureType: string | null;
  nodeOutsideId: number | null;
  nodeInsideId: number | null;
  pinLat: number | null;
  pinLng: number | null;
  id: number;
}): string {
  if (isIndoorRouteReport(report.featureType) && report.nodeInsideId != null) {
    return `inside:${report.nodeInsideId}`;
  }
  if (report.nodeOutsideId != null) {
    return `outside:${report.nodeOutsideId}`;
  }
  if (report.pinLat != null && report.pinLng != null) {
    return `pin:${report.pinLat.toFixed(5)},${report.pinLng.toFixed(5)}`;
  }
  return `report:${report.id}`;
}

/** Human-readable label for a grouped feature (outside = node id, inside = name). */
export function routeReportFeatureGroupLabel(report: {
  featureType: string | null;
  nodeOutsideId: number | null;
  nodeInsideId: number | null;
  nodeInsideName?: string | null;
  pinLat: number | null;
  pinLng: number | null;
  id: number;
}): string {
  const typeLabel =
    FEATURE_TYPE_ITEMS.find((item) => item.value === report.featureType)
      ?.label ?? "Other";

  if (isIndoorRouteReport(report.featureType) && report.nodeInsideId != null) {
    const name = report.nodeInsideName?.trim();
    if (name) return `${typeLabel} — ${name}`;
    return `${typeLabel} — inside #${report.nodeInsideId}`;
  }

  if (report.nodeOutsideId != null) {
    return `${typeLabel} — outside node #${report.nodeOutsideId}`;
  }

  if (report.pinLat != null && report.pinLng != null) {
    return `${typeLabel} — map pin`;
  }

  return `${typeLabel} — report #${report.id}`;
}

export function buildRouteReportPayload(input: {
  locationType: RouteReportLocationType;
  destinationId: number | null;
  featureType: RouteReportFeatureType | null;
  selectedOutsideNodeId: number | null;
  selectedInsideNodeId: number | null;
  pin: { lat: number; lng: number } | null;
  text: string;
}): RouteReportPayload | null {
  const trimmedText = input.text.trim();

  if (input.locationType === "other") {
    if (!input.pin) return null;
    const parsed = routeReportPayloadSchema.safeParse({
      locationType: "other",
      text: trimmedText,
      pinLat: input.pin.lat,
      pinLng: input.pin.lng,
    });
    return parsed.success ? parsed.data : null;
  }

  if (!input.destinationId || !input.featureType) return null;

  if (input.featureType === "entrance") {
    if (!input.selectedOutsideNodeId) return null;
    const parsed = routeReportPayloadSchema.safeParse({
      locationType: input.locationType,
      destinationId: input.destinationId,
      featureType: "entrance",
      nodeOutsideId: input.selectedOutsideNodeId,
      text: trimmedText || undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  if (
    input.featureType === "elevator" ||
    input.featureType === "ramp" ||
    input.featureType === "stairs"
  ) {
    if (!input.selectedInsideNodeId) return null;
    const parsed = routeReportPayloadSchema.safeParse({
      locationType: input.locationType,
      destinationId: input.destinationId,
      featureType: input.featureType,
      nodeInsideId: input.selectedInsideNodeId,
      text: trimmedText || undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  if (input.featureType === "other") {
    if (!input.pin) return null;
    const parsed = routeReportPayloadSchema.safeParse({
      locationType: input.locationType,
      destinationId: input.destinationId,
      featureType: "other",
      text: trimmedText,
      pinLat: input.pin.lat,
      pinLng: input.pin.lng,
    });
    return parsed.success ? parsed.data : null;
  }

  return null;
}

export function parsePolygon(
  polygon: string | null | undefined,
): GeoJSONFeatureCollection | null {
  if (!polygon) return null;
  try {
    const parsed = JSON.parse(polygon) as GeoJSONFeatureCollection;
    if (parsed?.type === "FeatureCollection") return parsed;
    return null;
  } catch {
    return null;
  }
}

export { pinSchema, requiredTextSchema, optionalTextSchema };
