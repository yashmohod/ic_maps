import { calcDistance } from "@/lib/geo";
import { CAMPUS_BOUNDS } from "@/lib/map-constants";

/** OpenStreetMap Overpass JSON element (subset). */
export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
};

export type OsmOverpassResponse = {
  elements: OsmElement[];
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

/** POST Overpass QL with mirror failover + retries (public Overpass often 504s). */
export async function fetchOverpassJson(
  query: string,
  options?: { timeoutMs?: number; attemptsPerEndpoint?: number },
): Promise<OsmOverpassResponse> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const attemptsPerEndpoint = options?.attemptsPerEndpoint ?? 2;
  const errors: string[] = [];

  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= attemptsPerEndpoint; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "ic-maps-import/1.0",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          errors.push(`${url} → HTTP ${res.status}`);
          // 429/5xx: try next attempt / mirror
          if (res.status === 429 || res.status >= 500) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          break;
        }
        return (await res.json()) as OsmOverpassResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${url} → ${msg}`);
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }

  throw new Error(
    `Overpass failed on all mirrors. Last errors: ${errors.slice(-4).join("; ")}`,
  );
}

export type OsmGraphNode = {
  osmId: number;
  lat: number;
  lng: number;
  isPedestrian: boolean;
  isVehicular: boolean;
  isStairs: boolean;
  /** Absolute slope angle in degrees (0 if unknown / untagged). */
  inclineDegrees: number;
};

export type OsmGraphEdge = {
  /** Travel from → to when !biDirectional; undirected endpoints when biDirectional. */
  osmA: number;
  osmB: number;
  biDirectional: boolean;
  /** Absolute slope angle in degrees (0 if unknown / untagged). Used while densifying; stamped onto nodes. */
  inclineDegrees: number;
};

/** Map oriented OSM endpoints → DB (min/max a/b + direction flag). */
export function toDbEdgePair(
  dbFrom: number,
  dbTo: number,
  biDirectional: boolean,
): {
  node_a_id: number;
  node_b_id: number;
  bi_directional: boolean;
  direction: boolean;
} {
  const node_a_id = Math.min(dbFrom, dbTo);
  const node_b_id = Math.max(dbFrom, dbTo);
  return {
    node_a_id,
    node_b_id,
    bi_directional: biDirectional,
    // Schema: !bi && direction → a→b; !bi && !direction → b→a
    direction: biDirectional || dbFrom === node_a_id,
  };
}

export type OsmGraph = {
  nodes: OsmGraphNode[];
  edges: OsmGraphEdge[];
};

const PEDESTRIAN_HIGHWAYS = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "cycleway",
  "bridleway",
  "corridor",
]);

const ROAD_HIGHWAYS = new Set([
  "residential",
  "living_street",
  "unclassified",
  "service",
  "tertiary",
  "secondary",
  "primary",
  "tertiary_link",
  "secondary_link",
  "primary_link",
]);

const IMPORT_HIGHWAYS = new Set([...PEDESTRIAN_HIGHWAYS, ...ROAD_HIGHWAYS]);

/** Max outdoor edge length after import densification (meters). */
export const DEFAULT_MAX_EDGE_METERS = 20;

/** OSM closed-way id: amenity=university, name=Ithaca College (reference only). */
export const ITHACA_COLLEGE_OSM_WAY_ID = 562486684;

export type CampusBBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type LngLatRing = Array<[number, number]>;

export function campusBBoxFromBounds(
  bounds: [[number, number], [number, number]] = CAMPUS_BOUNDS,
): CampusBBox {
  const [[swLng, swLat], [neLng, neLat]] = bounds;
  return { south: swLat, west: swLng, north: neLat, east: neLng };
}

export function bboxFromRing(ring: LngLatRing): CampusBBox {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lng, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/** Ray-cast point-in-polygon. Ring is [lng, lat][], optionally closed. */
export function pointInRing(
  lng: number,
  lat: number,
  ring: LngLatRing,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Overpass QL: walk/road ways in the import bbox (filtered to campus polygon after parse). */
export function buildCampusWalkwaysQuery(
  bbox: CampusBBox = campusBBoxFromBounds(),
): string {
  const { south, west, north, east } = bbox;
  const highwayRegex = [...IMPORT_HIGHWAYS].join("|");
  return `
[out:json][timeout:180];
(
  way["highway"~"^(${highwayRegex})$"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;
`.trim();
}

/**
 * Named buildings, parking areas, and entrance nodes in the import bbox.
 * Uses `out body` for child nodes so entrance=* tags are preserved.
 */
export function buildCampusBuildingsQuery(
  bbox: CampusBBox = campusBBoxFromBounds(),
): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:180];
(
  way["building"]["name"](${south},${west},${north},${east});
  way["amenity"="parking"](${south},${west},${north},${east});
  relation["amenity"="parking"](${south},${west},${north},${east});
  node["entrance"](${south},${west},${north},${east});
);
out body;
>;
out body qt;
`.trim();
}

/**
 * Parse OSM incline tag → absolute degrees for node_outside.incline.
 * Supports `5%` (percent grade), `5°`, bare numbers (treated as degrees).
 * up/down/yes → 0 (boolean presence only; no numeric slope).
 */
export function parseOsmInclineDegrees(raw: string | undefined): number {
  if (!raw) return 0;
  const v = raw.trim().toLowerCase();
  if (!v || v === "up" || v === "down" || v === "yes" || v === "no") return 0;
  const pct = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(v);
  if (pct) {
    const percent = Math.abs(Number(pct[1]));
    return (Math.atan(percent / 100) * 180) / Math.PI;
  }
  const deg = /^(-?\d+(?:\.\d+)?)\s*°?$/.exec(v);
  if (deg) return Math.abs(Number(deg[1]));
  return 0;
}

/** True when OSM marks an incline (including up/down without a number). */
export function osmHasInclineTag(tags: Record<string, string>): boolean {
  const v = (tags.incline ?? "").trim().toLowerCase();
  return v !== "" && v !== "no" && v !== "0" && v !== "0%" && v !== "0°";
}

/** Drop obvious non-college buildings that can still appear near campus. */
export function isLikelyCollegeBuilding(tags: Record<string, string>): boolean {
  const name = (tags.name ?? tags["name:en"] ?? "").trim();
  if (!name) return false;
  if (tags.amenity === "fire_station") return false;
  if (/city of ithaca/i.test(tags.operator ?? "")) return false;
  // Bare house numbers / address-only names (e.g. "1020", "111-113")
  if (/^\d+([-\s]\d+)?$/.test(name)) return false;
  return true;
}

export type OsmBuilding = {
  osmId: number;
  name: string;
  lat: number;
  lng: number;
  isParkingLot: boolean;
  feature: {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "Polygon";
      coordinates: number[][][];
    };
  };
};

export type OsmEntrance = {
  osmNodeId: number;
  buildingOsmId: number;
  lat: number;
  lng: number;
  kind: string;
};

function ringCentroid(ring: number[][]): { lat: number; lng: number } {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (pts.length === 0) return { lat: 0, lng: 0 };
  let lng = 0;
  let lat = 0;
  for (const p of pts) {
    lng += p[0]!;
    lat += p[1]!;
  }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

/**
 * Parse named OSM buildings + parking areas into destination-ready polygons.
 * Skips open rings, non-college building tags, and features outside campusRing.
 */
export function parseOsmBuildings(
  osm: OsmOverpassResponse,
  options?: { bbox?: CampusBBox; campusRing?: LngLatRing },
): OsmBuilding[] {
  const bbox = options?.bbox;
  const campusRing = options?.campusRing;
  const nodeById = new Map<number, { lat: number; lng: number }>();
  for (const el of osm.elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    if (
      bbox &&
      (el.lat < bbox.south ||
        el.lat > bbox.north ||
        el.lon < bbox.west ||
        el.lon > bbox.east)
    ) {
      continue;
    }
    nodeById.set(el.id, { lat: el.lat, lng: el.lon });
  }

  const buildings: OsmBuilding[] = [];
  const usedNames = new Set<string>();

  const pushArea = (
    osmId: number,
    name: string,
    ring: number[][],
    isParkingLot: boolean,
  ) => {
    const { lat, lng } = ringCentroid(ring);
    if (campusRing && !pointInRing(lng, lat, campusRing)) return;

    let destName = name.slice(0, 256);
    if (usedNames.has(destName.toLowerCase())) {
      destName = `${name} (OSM ${osmId})`.slice(0, 256);
    }
    usedNames.add(destName.toLowerCase());

    buildings.push({
      osmId,
      name: destName,
      lat,
      lng,
      isParkingLot,
      feature: {
        type: "Feature",
        properties: {
          name: destName,
          osmId,
          isParkingLot,
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    });
  };

  const ringFromWayNodes = (wayNodes: number[]): number[][] | null => {
    if (wayNodes.length < 3) return null;
    const ring: number[][] = [];
    for (const nid of wayNodes) {
      const pos = nodeById.get(nid);
      if (!pos) return null;
      ring.push([pos.lng, pos.lat]);
    }
    if (ring.length < 3) return null;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0]!, first[1]!]);
    }
    return ring.length >= 4 ? ring : null;
  };

  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    const ring = ringFromWayNodes(el.nodes ?? []);
    if (!ring) continue;

    if (tags.amenity === "parking") {
      const name = (
        tags.name ??
        tags["name:en"] ??
        tags.ref ??
        `Parking ${el.id}`
      ).trim();
      pushArea(el.id, name, ring, true);
      continue;
    }

    if (!tags.building) continue;
    if (!isLikelyCollegeBuilding(tags)) continue;
    const name = (tags.name ?? tags["name:en"] ?? "").trim();
    if (!name) continue;
    pushArea(el.id, name, ring, false);
  }

  return buildings;
}

/**
 * Entrances for imported buildings: outline nodes with entrance=*, plus
 * standalone entrance nodes that fall inside a building polygon.
 */
export function parseOsmBuildingEntrances(
  osm: OsmOverpassResponse,
  buildings: OsmBuilding[],
): OsmEntrance[] {
  const buildingByOsm = new Map(buildings.map((b) => [b.osmId, b]));
  const nodeMeta = new Map<
    number,
    { lat: number; lng: number; entrance?: string }
  >();
  for (const el of osm.elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const entrance = el.tags?.entrance;
    nodeMeta.set(el.id, {
      lat: el.lat,
      lng: el.lon,
      entrance: entrance?.trim() || undefined,
    });
  }

  const out: OsmEntrance[] = [];
  const seen = new Set<string>();

  const add = (
    osmNodeId: number,
    buildingOsmId: number,
    lat: number,
    lng: number,
    kind: string,
  ) => {
    const key = `${buildingOsmId}:${osmNodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ osmNodeId, buildingOsmId, lat, lng, kind });
  };

  for (const el of osm.elements) {
    if (el.type !== "way" || !buildingByOsm.has(el.id)) continue;
    for (const nid of el.nodes ?? []) {
      const meta = nodeMeta.get(nid);
      if (!meta?.entrance) continue;
      add(nid, el.id, meta.lat, meta.lng, meta.entrance);
    }
  }

  // Standalone entrance nodes inside a building polygon
  for (const el of osm.elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const kind = el.tags?.entrance?.trim();
    if (!kind) continue;
    for (const b of buildings) {
      if (b.isParkingLot) continue;
      const ring = b.feature.geometry.coordinates[0] as LngLatRing;
      if (!pointInRing(el.lon, el.lat, ring)) continue;
      add(el.id, b.osmId, el.lat, el.lon, kind);
      break;
    }
  }

  return out;
}

function flagsForHighway(highway: string, tags: Record<string, string>) {
  const isStairs =
    highway === "steps" || tags.footway === "steps" || tags.stairs === "yes";
  // Accessibility / named ramps (numeric incline stamped separately when tagged).
  const name = tags.name ?? "";
  const isRampWay =
    !isStairs &&
    (tags.ramp === "yes" ||
      tags["ramp:wheelchair"] === "yes" ||
      tags.footway === "ramp" ||
      osmHasInclineTag(tags) ||
      /\bramp\b/i.test(name));
  const footNo = tags.foot === "no" || tags.access === "no";
  const isPedestrian =
    !footNo &&
    (PEDESTRIAN_HIGHWAYS.has(highway) ||
      ROAD_HIGHWAYS.has(highway) ||
      isStairs ||
      isRampWay);
  const isVehicular = ROAD_HIGHWAYS.has(highway) && tags.motor_vehicle !== "no";
  return { isPedestrian, isVehicular, isStairs };
}

/**
 * OSM travel restriction along way node order.
 * - forward: along way nodes
 * - reverse: against way nodes
 * - both: bidirectional
 */
export function onewayAlongWay(
  tags: Record<string, string>,
): "forward" | "reverse" | "both" {
  const foot = (tags["oneway:foot"] ?? "").toLowerCase();
  if (foot === "yes" || foot === "1" || foot === "true") return "forward";
  if (foot === "-1" || foot === "reverse") return "reverse";
  if (foot === "no" || foot === "0" || foot === "false") return "both";

  const junction = (tags.junction ?? "").toLowerCase();
  if (junction === "roundabout" || junction === "circular") return "forward";

  const ow = (tags.oneway ?? "").toLowerCase();
  if (ow === "yes" || ow === "1" || ow === "true") return "forward";
  if (ow === "-1" || ow === "reverse") return "reverse";
  return "both";
}

function mergeEdgeDirection(
  prev: OsmGraphEdge,
  next: OsmGraphEdge,
): OsmGraphEdge {
  const inclineDegrees = Math.max(prev.inclineDegrees, next.inclineDegrees);
  if (prev.biDirectional || next.biDirectional) {
    return { ...prev, biDirectional: true, inclineDegrees };
  }
  // Same undirected pair, opposite one-ways → open both ways
  if (prev.osmA === next.osmB && prev.osmB === next.osmA) {
    return {
      osmA: prev.osmA,
      osmB: prev.osmB,
      biDirectional: true,
      inclineDegrees,
    };
  }
  // Same orientation
  return { ...prev, inclineDegrees };
}

/**
 * Split edges longer than maxMeters by inserting intermediate nodes so every
 * resulting edge is ≤ maxMeters. Synthetic node ids are negative.
 */
export function densifyOsmGraph(
  graph: OsmGraph,
  maxMeters: number = DEFAULT_MAX_EDGE_METERS,
): OsmGraph {
  if (!(maxMeters > 0)) return graph;

  const nodeById = new Map(graph.nodes.map((n) => [n.osmId, n]));
  const nodes = [...graph.nodes];
  const edges: OsmGraphEdge[] = [];
  let nextSynthetic = -1;

  for (const e of graph.edges) {
    const a = nodeById.get(e.osmA);
    const b = nodeById.get(e.osmB);
    if (!a || !b) continue;

    const dist = calcDistance(a.lat, a.lng, b.lat, b.lng);
    if (dist <= maxMeters) {
      edges.push(e);
      continue;
    }

    const segments = Math.ceil(dist / maxMeters);
    let prevId = a.osmId;
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const mid: OsmGraphNode = {
        osmId: nextSynthetic--,
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        isPedestrian: a.isPedestrian || b.isPedestrian,
        isVehicular: a.isVehicular || b.isVehicular,
        isStairs: a.isStairs || b.isStairs,
        inclineDegrees: Math.max(a.inclineDegrees, b.inclineDegrees, e.inclineDegrees),
      };
      nodes.push(mid);
      nodeById.set(mid.osmId, mid);
      edges.push({
        osmA: prevId,
        osmB: mid.osmId,
        biDirectional: e.biDirectional,
        inclineDegrees: e.inclineDegrees,
      });
      prevId = mid.osmId;
    }
    edges.push({
      osmA: prevId,
      osmB: b.osmId,
      biDirectional: e.biDirectional,
      inclineDegrees: e.inclineDegrees,
    });
  }

  return { nodes, edges };
}

/**
 * Parse Overpass JSON into outdoor graph nodes/edges.
 * Node flags are OR'd across all incident imported ways.
 * Edge direction follows OSM oneway / roundabout (and oneway:foot).
 * Long edges are densified so none exceed maxEdgeMeters (default 20).
 * When campusRing is set, only nodes inside the college outline are kept.
 */
export function parseOsmWalkGraph(
  osm: OsmOverpassResponse,
  options?: {
    bbox?: CampusBBox;
    maxEdgeMeters?: number;
    campusRing?: LngLatRing;
  },
): OsmGraph {
  const bbox = options?.bbox;
  const maxEdgeMeters = options?.maxEdgeMeters ?? DEFAULT_MAX_EDGE_METERS;
  const campusRing = options?.campusRing;
  const nodeById = new Map<number, { lat: number; lng: number }>();
  for (const el of osm.elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    if (
      bbox &&
      (el.lat < bbox.south ||
        el.lat > bbox.north ||
        el.lon < bbox.west ||
        el.lon > bbox.east)
    ) {
      continue;
    }
    if (campusRing && !pointInRing(el.lon, el.lat, campusRing)) continue;
    nodeById.set(el.id, { lat: el.lat, lng: el.lon });
  }

  const flagByOsm = new Map<
    number,
    {
      isPedestrian: boolean;
      isVehicular: boolean;
      isStairs: boolean;
      inclineDegrees: number;
    }
  >();
  const edgeByKey = new Map<string, OsmGraphEdge>();

  const touchFlags = (
    osmId: number,
    next: {
      isPedestrian: boolean;
      isVehicular: boolean;
      isStairs: boolean;
      inclineDegrees: number;
    },
  ) => {
    const prev = flagByOsm.get(osmId);
    if (!prev) {
      flagByOsm.set(osmId, { ...next });
      return;
    }
    prev.isPedestrian ||= next.isPedestrian;
    prev.isVehicular ||= next.isVehicular;
    prev.isStairs ||= next.isStairs;
    prev.inclineDegrees = Math.max(prev.inclineDegrees, next.inclineDegrees);
  };

  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    const highway = tags.highway;
    if (!highway || !IMPORT_HIGHWAYS.has(highway)) continue;
    const flags = flagsForHighway(highway, tags);
    if (!flags.isPedestrian && !flags.isVehicular) continue;

    const inclineDegrees = parseOsmInclineDegrees(tags.incline);
    const wayNodes = el.nodes ?? [];
    for (const osmId of wayNodes) {
      if (!nodeById.has(osmId)) continue;
      touchFlags(osmId, { ...flags, inclineDegrees });
    }

    const oneway = onewayAlongWay(tags);
    for (let i = 0; i < wayNodes.length - 1; i++) {
      const a = wayNodes[i]!;
      const b = wayNodes[i + 1]!;
      if (!nodeById.has(a) || !nodeById.has(b) || a === b) continue;

      let osmA = a;
      let osmB = b;
      let biDirectional = oneway === "both";
      if (oneway === "reverse") {
        osmA = b;
        osmB = a;
      }

      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}:${hi}`;
      const nextEdge: OsmGraphEdge = {
        osmA,
        osmB,
        biDirectional,
        inclineDegrees,
      };
      const prev = edgeByKey.get(key);
      edgeByKey.set(key, prev ? mergeEdgeDirection(prev, nextEdge) : nextEdge);
    }
  }

  const nodes: OsmGraphNode[] = [];
  for (const [osmId, flags] of flagByOsm) {
    const pos = nodeById.get(osmId);
    if (!pos) continue;
    nodes.push({
      osmId,
      lat: pos.lat,
      lng: pos.lng,
      isPedestrian: flags.isPedestrian,
      isVehicular: flags.isVehicular,
      isStairs: flags.isStairs,
      inclineDegrees: flags.inclineDegrees,
    });
  }

  const used = new Set(nodes.map((n) => n.osmId));
  const filteredEdges = [...edgeByKey.values()].filter(
    (e) => used.has(e.osmA) && used.has(e.osmB),
  );

  return densifyOsmGraph({ nodes, edges: filteredEdges }, maxEdgeMeters);
}

/** Find nearest existing node within snapMeters, else null. */
export function findSnapTarget(
  lat: number,
  lng: number,
  existing: Array<{ id: number; lat: number; lng: number }>,
  snapMeters: number,
): number | null {
  let bestId: number | null = null;
  let bestD = snapMeters;
  for (const n of existing) {
    const d = calcDistance(lat, lng, n.lat, n.lng);
    if (d <= bestD) {
      bestD = d;
      bestId = n.id;
    }
  }
  return bestId;
}
