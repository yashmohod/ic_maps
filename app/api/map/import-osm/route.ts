import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, pool } from "@/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { calcDistance } from "@/lib/geo";
import { reloadGraphOr503 } from "@/lib/reload-graph-response";
import {
  bboxFromRing,
  buildCampusBuildingsQuery,
  buildCampusWalkwaysQuery,
  fetchOverpassJson,
  findSnapTarget,
  parseOsmBuildings,
  parseOsmWalkGraph,
  toDbEdgePair,
  type CampusBBox,
  type LngLatRing,
  type OsmGraphNode,
  type OsmOverpassResponse,
} from "@/lib/osm-import";

const ROUTE = "/api/map/import-osm";
const SNAP_METERS = 5;
const WALK_CACHE = path.join(process.cwd(), "data", "campus-osm.json");
const BUILDINGS_CACHE = path.join(
  process.cwd(),
  "data",
  "campus-osm-buildings.json",
);
const CAMPUS_RING_PATH = path.join(
  process.cwd(),
  "data",
  "ithaca-college-campus.json",
);

const bodySchema = z.object({
  /** Re-fetch Overpass instead of using cached JSON */
  refresh: z.boolean().optional().default(false),
  /** Count only; do not write */
  dryRun: z.boolean().optional().default(false),
  snapMeters: z.number().positive().max(50).optional().default(SNAP_METERS),
  /** walkways = outdoor graph; buildings = named destination polygons */
  mode: z.enum(["walkways", "buildings"]).optional().default("walkways"),
});

async function fetchOverpass(query: string): Promise<OsmOverpassResponse> {
  return fetchOverpassJson(query);
}

async function loadCampusRing(): Promise<LngLatRing> {
  const raw = JSON.parse(await readFile(CAMPUS_RING_PATH, "utf8")) as {
    geometry?: { coordinates?: LngLatRing[] };
  };
  const ring = raw.geometry?.coordinates?.[0];
  if (!ring || ring.length < 4) {
    throw new Error(`Invalid campus ring in ${CAMPUS_RING_PATH}`);
  }
  return ring;
}

async function loadCached(filePath: string): Promise<OsmOverpassResponse> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as OsmOverpassResponse;
}

async function loadWalkOsm(
  refresh: boolean,
  bbox: CampusBBox,
): Promise<OsmOverpassResponse> {
  if (!refresh) return loadCached(WALK_CACHE);
  const json = await fetchOverpass(buildCampusWalkwaysQuery(bbox));
  await writeFile(WALK_CACHE, JSON.stringify(json));
  return json;
}

async function loadBuildingsOsm(
  refresh: boolean,
  bbox: CampusBBox,
): Promise<OsmOverpassResponse> {
  if (!refresh) {
    try {
      return await loadCached(BUILDINGS_CACHE);
    } catch {
      // First-time: fetch even without refresh so buildings aren't skipped.
    }
  }
  const json = await fetchOverpass(buildCampusBuildingsQuery(bbox));
  await writeFile(BUILDINGS_CACHE, JSON.stringify(json));
  return json;
}

function countNewEdges(
  graphEdges: Array<{ osmA: number; osmB: number; biDirectional: boolean }>,
  osmToDb: Map<number, number>,
  existingEdgeKeys: Set<string>,
  newOsmIds: Set<number>,
): number {
  let count = 0;
  const seen = new Set<string>();
  for (const e of graphEdges) {
    const involvesNew = newOsmIds.has(e.osmA) || newOsmIds.has(e.osmB);
    const da = osmToDb.get(e.osmA);
    const dbB = osmToDb.get(e.osmB);
    if (!involvesNew) {
      if (da == null || dbB == null || da === dbB) continue;
      const key = `${Math.min(da, dbB)}:${Math.max(da, dbB)}`;
      if (existingEdgeKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      count += 1;
      continue;
    }
    const key = `${Math.min(e.osmA, e.osmB)}:${Math.max(e.osmA, e.osmB)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { refresh, dryRun, snapMeters, mode } = parsed.data;

    console.log(`[API ${ROUTE} POST]`, { refresh, dryRun, snapMeters, mode });

    const campusRing = await loadCampusRing();
    const importBbox = bboxFromRing(campusRing);

    if (mode === "buildings") {
      const buildingsOsm = await loadBuildingsOsm(refresh, importBbox);
      const buildings = parseOsmBuildings(buildingsOsm, {
        bbox: importBbox,
        campusRing,
      });
      const existingDestRes = await db.execute(sql<{ name: string }>`
        SELECT name FROM destination
      `);
      const existingDestNames = new Set(
        (existingDestRes.rows as Array<{ name: string }>).map((r) =>
          r.name.toLowerCase(),
        ),
      );
      const buildingsToInsert = buildings.filter(
        (b) => !existingDestNames.has(b.name.toLowerCase()),
      );

      if (dryRun) {
        return NextResponse.json({
          dryRun: true,
          mode: "buildings",
          osmBuildings: buildings.length,
          buildingsToInsert: buildingsToInsert.length,
          source: refresh ? "overpass" : "cache",
        });
      }

      const client = await pool.connect();
      let insertedBuildings = 0;
      try {
        await client.query("BEGIN");
        for (const b of buildingsToInsert) {
          const poly: {
            type: "Feature";
            properties: Record<string, unknown>;
            geometry: {
              type: "Polygon";
              coordinates: number[][][];
            };
          } = {
            ...b.feature,
            properties: { ...b.feature.properties, name: b.name },
          };
          const result = await client.query<{ id: number }>(
            `INSERT INTO destination (name, lat, lng, polygon, is_parking_lot)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (name) DO NOTHING
             RETURNING id`,
            [b.name, b.lat, b.lng, JSON.stringify(poly), b.isParkingLot],
          );
          const id = result.rows[0]?.id;
          if (id == null) continue;
          poly.properties = { ...poly.properties, destId: id, name: b.name };
          await client.query(
            `UPDATE destination SET polygon = $2 WHERE id = $1`,
            [id, JSON.stringify(poly)],
          );
          insertedBuildings += 1;
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return NextResponse.json({
        dryRun: false,
        mode: "buildings",
        osmBuildings: buildings.length,
        insertedBuildings,
        source: refresh ? "overpass" : "cache",
      });
    }

    const osm = await loadWalkOsm(refresh, importBbox);
    const graph = parseOsmWalkGraph(osm, {
      bbox: importBbox,
      campusRing,
    });

    const existingRes = await db.execute(sql<{
      id: number;
      lat: number;
      lng: number;
    }>`
      SELECT id, lat, lng FROM node_outside
    `);
    const existing = existingRes.rows as Array<{
      id: number;
      lat: number;
      lng: number;
    }>;

    const osmToDb = new Map<number, number>();
    const toInsert: OsmGraphNode[] = [];
    const snappedNodes: OsmGraphNode[] = [];
    const newOsmIds = new Set<number>();

    for (const n of graph.nodes) {
      const hit = findSnapTarget(n.lat, n.lng, existing, snapMeters);
      if (hit != null) {
        osmToDb.set(n.osmId, hit);
        snappedNodes.push(n);
      } else {
        toInsert.push(n);
        newOsmIds.add(n.osmId);
      }
    }

    const existingEdgeRes = await db.execute(sql<{
      node_a_id: number;
      node_b_id: number;
    }>`
      SELECT node_a_id, node_b_id FROM edge_outside
    `);
    const existingEdgeKeys = new Set(
      (
        existingEdgeRes.rows as Array<{
          node_a_id: number;
          node_b_id: number;
        }>
      ).map((e) => `${e.node_a_id}:${e.node_b_id}`),
    );

    const edgesToInsertEstimate = countNewEdges(
      graph.edges,
      osmToDb,
      existingEdgeKeys,
      newOsmIds,
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        mode: "walkways",
        osmNodes: graph.nodes.length,
        osmEdges: graph.edges.length,
        snappedToExisting: snappedNodes.length,
        nodesToInsert: toInsert.length,
        edgesToInsert: edgesToInsertEstimate,
        existingNodes: existing.length,
        source: refresh ? "overpass" : "cache",
      });
    }

    const client = await pool.connect();
    let insertedNodes = 0;
    let insertedEdges = 0;
    try {
      await client.query("BEGIN");

      for (const n of toInsert) {
        const pointWkt = `POINT(${n.lng} ${n.lat})`;
        const result = await client.query<{ id: number }>(
          `INSERT INTO node_outside
             (lat, lng, location, is_pedestrian, is_vehicular, is_stairs, is_ramp)
           VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7)
           RETURNING id`,
          [
            n.lat,
            n.lng,
            pointWkt,
            n.isPedestrian,
            n.isVehicular,
            n.isStairs,
            n.isRamp,
          ],
        );
        const id = result.rows[0]?.id;
        if (id == null) throw new Error("Node insert returned no id");
        osmToDb.set(n.osmId, id);
        existing.push({ id, lat: n.lat, lng: n.lng });
        insertedNodes += 1;
      }

      for (const n of snappedNodes) {
        const dbId = osmToDb.get(n.osmId);
        if (dbId == null) continue;
        await client.query(
          `UPDATE node_outside SET
             is_pedestrian = is_pedestrian OR $2,
             is_vehicular = is_vehicular OR $3,
             is_stairs = is_stairs OR $4,
             is_ramp = is_ramp OR $5
           WHERE id = $1`,
          [dbId, n.isPedestrian, n.isVehicular, n.isStairs, n.isRamp],
        );
      }

      const nodePos = new Map(existing.map((n) => [n.id, n]));

      for (const e of graph.edges) {
        const da = osmToDb.get(e.osmA);
        const dbB = osmToDb.get(e.osmB);
        if (da == null || dbB == null || da === dbB) continue;
        const pair = toDbEdgePair(da, dbB, e.biDirectional);
        const key = `${pair.node_a_id}:${pair.node_b_id}`;
        if (existingEdgeKeys.has(key)) continue;

        const na = nodePos.get(pair.node_a_id);
        const nb = nodePos.get(pair.node_b_id);
        const distance = calcDistance(
          na?.lat ?? 0,
          na?.lng ?? 0,
          nb?.lat ?? 0,
          nb?.lng ?? 0,
        );

        const result = await client.query<{ id: number }>(
          `INSERT INTO edge_outside
             (node_a_id, node_b_id, bi_directional, direction, distance, incline)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ON CONSTRAINT edge_outside_pair_unique DO NOTHING
           RETURNING id`,
          [
            pair.node_a_id,
            pair.node_b_id,
            pair.bi_directional,
            pair.direction,
            distance,
            e.inclineDegrees,
          ],
        );
        if (result.rows[0]?.id != null) {
          existingEdgeKeys.add(key);
          insertedEdges += 1;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const __reloadErr = await reloadGraphOr503();

    if (__reloadErr) return __reloadErr;

    return NextResponse.json({
      dryRun: false,
      mode: "walkways",
      osmNodes: graph.nodes.length,
      osmEdges: graph.edges.length,
      snappedToExisting: snappedNodes.length,
      insertedNodes,
      insertedEdges,
      source: refresh ? "overpass" : "cache",
    });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "OSM import failed",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
