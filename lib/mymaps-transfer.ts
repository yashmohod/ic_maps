import { z } from "zod";

import { hexColorSchema, MYMAPS_DEFAULT_COLOR } from "@/lib/mymaps-color";

const transferNodeSchema = z.object({
  id: z.number().int().positive(),
  lat: z.number(),
  lng: z.number(),
  name: z.string().max(256).optional().default(""),
  color: hexColorSchema,
});

const transferEdgeSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  biDirectional: z.boolean().optional().default(true),
  incline: z.number().optional().default(0),
  color: hexColorSchema,
});

const transferPolygonSchema = z.object({
  name: z.string().max(256).optional().default(""),
  polygon: z.unknown(),
  color: hexColorSchema,
});

const transferLineSchema = z.object({
  name: z.string().max(256).optional().default(""),
  geometry: z.unknown(),
});

const transferPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().max(256).optional().default(""),
});

const transferTextSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  lat: z.number(),
  lng: z.number(),
  font_size: z.coerce.number().int().min(10).max(48).optional().default(14),
});

export const myMapsTransferSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  mapName: z.string().optional(),
  nodes: z.array(transferNodeSchema).max(5000).default([]),
  edges: z.array(transferEdgeSchema).max(10000).default([]),
  polygons: z.array(transferPolygonSchema).max(2000).default([]),
  lines: z.array(transferLineSchema).max(2000).default([]),
  points: z.array(transferPointSchema).max(5000).default([]),
  texts: z.array(transferTextSchema).max(2000).default([]),
});

export type MyMapsTransfer = z.infer<typeof myMapsTransferSchema>;

export const myMapsImportBodySchema = z.object({
  mode: z.enum(["merge", "replace"]),
  payload: myMapsTransferSchema,
});

export type RemappedEdge = {
  from: number;
  to: number;
  biDirectional: boolean;
  incline: number;
  color: string;
};

/** Remap edge endpoints via old→new node id map; drop edges with missing or equal ends. */
export function remapEdgeEndpoints(
  edges: Array<{
    from: number;
    to: number;
    biDirectional?: boolean;
    incline?: number;
    color?: string;
  }>,
  idMap: Map<number, number>,
): RemappedEdge[] {
  const out: RemappedEdge[] = [];
  for (const e of edges) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (from == null || to == null || from === to) continue;
    out.push({
      from,
      to,
      biDirectional: e.biDirectional ?? true,
      incline: e.incline ?? 0,
      color: e.color ?? MYMAPS_DEFAULT_COLOR,
    });
  }
  return out;
}

/** Normalize line geometry (Feature or LineString, string or object) to a Feature JSON string. */
export function toStoredLineGeometry(input: unknown): string | null {
  try {
    const obj =
      typeof input === "string"
        ? JSON.parse(input)
        : typeof input === "object" && input != null
          ? input
          : null;
    if (!obj || typeof obj !== "object") return null;
    const record = obj as Record<string, unknown>;

    if (record.type === "Feature") {
      const g = record.geometry as { type?: string } | undefined;
      if (g?.type !== "LineString") return null;
      if (!record.properties || typeof record.properties !== "object") {
        record.properties = {};
      }
      return JSON.stringify(record);
    }

    if (record.type === "LineString") {
      return JSON.stringify({
        type: "Feature",
        properties: {},
        geometry: record,
      });
    }

    return null;
  } catch {
    return null;
  }
}

export function buildTransferPayload(input: {
  mapName?: string;
  nodes: Array<{
    id: number;
    lat: number;
    lng: number;
    name?: string;
    color?: string;
  }>;
  edges: Array<{
    from: number;
    to: number;
    biDirectional?: boolean;
    incline?: number;
    color?: string;
  }>;
  polygons: Array<{ name?: string; polygon: string; color?: string }>;
  lines: Array<{ name?: string; geometry: string }>;
  points: Array<{ lat: number; lng: number; name?: string }>;
  texts: Array<{
    text: string;
    lat: number;
    lng: number;
    font_size?: number;
  }>;
}): MyMapsTransfer {
  return myMapsTransferSchema.parse({
    version: 1,
    exportedAt: new Date().toISOString(),
    mapName: input.mapName,
    nodes: input.nodes.map((n) => ({
      id: n.id,
      lat: n.lat,
      lng: n.lng,
      name: n.name ?? "",
      color: n.color ?? MYMAPS_DEFAULT_COLOR,
    })),
    edges: input.edges.map((e) => ({
      from: e.from,
      to: e.to,
      biDirectional: e.biDirectional ?? true,
      incline: e.incline ?? 0,
      color: e.color ?? MYMAPS_DEFAULT_COLOR,
    })),
    polygons: input.polygons.map((p) => ({
      name: p.name ?? "",
      polygon: p.polygon,
      color: p.color ?? MYMAPS_DEFAULT_COLOR,
    })),
    lines: input.lines.map((l) => ({
      name: l.name ?? "",
      geometry: l.geometry,
    })),
    points: input.points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      name: p.name ?? "",
    })),
    texts: input.texts.map((t) => ({
      text: t.text,
      lat: t.lat,
      lng: t.lng,
      font_size: t.font_size ?? 14,
    })),
  });
}

export function transferDownloadFilename(
  mapId: number,
  mapName?: string,
): string {
  const slug = (mapName ?? "map")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `mymap-${mapId}-${slug || "map"}.json`;
}
