/**
 * One-shot CLI: seed campus OSM walkways, buildings, parking, entrances.
 *
 * Usage:
 *   npx tsx scripts/import-osm.ts [--dry-run] [--refresh] [--clear]
 *   npx tsx scripts/import-osm.ts --buildings-only [--refresh] [--clear]
 *
 * Default: walk graph + destinations (buildings/parking) + entrance links.
 * --clear wipes outdoor edges/nodes and all destinations first (indoor graphs
 * on those destinations cascade-delete).
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/db";
import { calcDistance } from "@/lib/geo";
import {
  bboxFromRing,
  buildCampusBuildingsQuery,
  buildCampusWalkwaysQuery,
  fetchOverpassJson,
  findSnapTarget,
  parseOsmBuildingEntrances,
  parseOsmBuildings,
  parseOsmWalkGraph,
  toDbEdgePair,
  type CampusBBox,
  type LngLatRing,
  type OsmBuilding,
  type OsmGraphNode,
  type OsmOverpassResponse,
} from "@/lib/osm-import";

const SNAP_METERS = 5;
const ENTRANCE_SNAP_METERS = 12;
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

async function loadWalkOsm(
  refresh: boolean,
  bbox: CampusBBox,
): Promise<OsmOverpassResponse> {
  if (!refresh) {
    try {
      const raw = await readFile(WALK_CACHE, "utf8");
      return JSON.parse(raw) as OsmOverpassResponse;
    } catch {
      // fall through
    }
  }
  const json = await fetchOverpassJson(buildCampusWalkwaysQuery(bbox));
  await writeFile(WALK_CACHE, JSON.stringify(json));
  return json;
}

async function loadBuildingsOsm(
  refresh: boolean,
  bbox: CampusBBox,
): Promise<OsmOverpassResponse> {
  if (!refresh) {
    try {
      const raw = await readFile(BUILDINGS_CACHE, "utf8");
      const parsed = JSON.parse(raw) as OsmOverpassResponse;
      if (parsed.elements?.length) return parsed;
    } catch {
      // fall through
    }
  }
  const json = await fetchOverpassJson(buildCampusBuildingsQuery(bbox));
  await writeFile(BUILDINGS_CACHE, JSON.stringify(json));
  return json;
}

async function clearSeededMapData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const edges = await client.query(`DELETE FROM edge_outside`);
    const nodes = await client.query(`DELETE FROM node_outside`);
    const dests = await client.query(`DELETE FROM destination`);
    await client.query("COMMIT");
    console.log({
      cleared: true,
      edges: edges.rowCount,
      nodes: nodes.rowCount,
      destinations: dests.rowCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertDestinations(
  client: import("pg").PoolClient,
  areas: OsmBuilding[],
): Promise<Map<number, number>> {
  const osmToDest = new Map<number, number>();
  for (const b of areas) {
    const poly = {
      ...b.feature,
      properties: {
        ...b.feature.properties,
        name: b.name,
        isParkingLot: b.isParkingLot,
      },
    };
    const result = await client.query<{ id: number }>(
      `INSERT INTO destination (name, lat, lng, polygon, is_parking_lot)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [b.name, b.lat, b.lng, JSON.stringify(poly), b.isParkingLot],
    );
    let id = result.rows[0]?.id;
    if (id == null) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM destination WHERE lower(name) = lower($1)`,
        [b.name],
      );
      id = existing.rows[0]?.id;
      if (id == null) continue;
    } else {
      poly.properties = { ...poly.properties, destId: id, name: b.name };
      await client.query(`UPDATE destination SET polygon = $2 WHERE id = $1`, [
        id,
        JSON.stringify(poly),
      ]);
    }
    osmToDest.set(b.osmId, id);
  }
  return osmToDest;
}

async function linkEntrances(
  client: import("pg").PoolClient,
  buildingsOsm: OsmOverpassResponse,
  areas: OsmBuilding[],
  osmToDest: Map<number, number>,
): Promise<number> {
  const entrances = parseOsmBuildingEntrances(buildingsOsm, areas);
  const existingRes = await client.query<{
    id: number;
    lat: number;
    lng: number;
  }>(`SELECT id, lat, lng FROM node_outside`);
  const existing = existingRes.rows;
  let linked = 0;

  for (const ent of entrances) {
    const destId = osmToDest.get(ent.buildingOsmId);
    if (destId == null) continue;

    let nodeId = findSnapTarget(
      ent.lat,
      ent.lng,
      existing,
      ENTRANCE_SNAP_METERS,
    );
    if (nodeId == null) {
      const pointWkt = `POINT(${ent.lng} ${ent.lat})`;
      const result = await client.query<{ id: number }>(
        `INSERT INTO node_outside
           (lat, lng, location, is_pedestrian, is_vehicular)
         VALUES ($1, $2, ST_GeomFromText($3, 4326), true, false)
         RETURNING id`,
        [ent.lat, ent.lng, pointWkt],
      );
      nodeId = result.rows[0]!.id;
      existing.push({ id: nodeId, lat: ent.lat, lng: ent.lng });
    }

    const link = await client.query(
      `INSERT INTO destination_node (destination_id, node_outside_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [destId, nodeId],
    );
    if ((link.rowCount ?? 0) > 0) linked += 1;
  }
  return linked;
}

async function insertWalkGraph(
  client: import("pg").PoolClient,
  graph: ReturnType<typeof parseOsmWalkGraph>,
): Promise<{ insertedNodes: number; insertedEdges: number; snapped: number }> {
  const existingRes = await client.query<{
    id: number;
    lat: number;
    lng: number;
  }>(`SELECT id, lat, lng FROM node_outside`);
  const existing = existingRes.rows;

  const osmToDb = new Map<number, number>();
  const toInsert: OsmGraphNode[] = [];
  const snappedNodes: OsmGraphNode[] = [];

  for (const n of graph.nodes) {
    const hit = findSnapTarget(n.lat, n.lng, existing, SNAP_METERS);
    if (hit != null) {
      osmToDb.set(n.osmId, hit);
      snappedNodes.push(n);
    } else {
      toInsert.push(n);
    }
  }

  const edgeRes = await client.query<{ node_a_id: number; node_b_id: number }>(
    `SELECT node_a_id, node_b_id FROM edge_outside`,
  );
  const existingEdgeKeys = new Set(
    edgeRes.rows.map((e) => `${e.node_a_id}:${e.node_b_id}`),
  );

  let insertedNodes = 0;
  let insertedEdges = 0;

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
    const id = result.rows[0]!.id;
    osmToDb.set(n.osmId, id);
    existing.push({ id, lat: n.lat, lng: n.lng });
    insertedNodes += 1;
  }

  for (const n of snappedNodes) {
    const dbId = osmToDb.get(n.osmId)!;
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
    const na = nodePos.get(pair.node_a_id)!;
    const nb = nodePos.get(pair.node_b_id)!;
    const distance = calcDistance(na.lat, na.lng, nb.lat, nb.lng);
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

  return { insertedNodes, insertedEdges, snapped: snappedNodes.length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");
  const clear = process.argv.includes("--clear");
  const buildingsOnly = process.argv.includes("--buildings-only");
  const campusRing = await loadCampusRing();
  const importBbox = bboxFromRing(campusRing);

  if (clear && !dryRun) {
    await clearSeededMapData();
  } else if (clear && dryRun) {
    console.log({ cleared: "(dry-run skip)" });
  }

  const buildingsOsm = await loadBuildingsOsm(refresh, importBbox);
  const areas = parseOsmBuildings(buildingsOsm, {
    bbox: importBbox,
    campusRing,
  });
  const entrances = parseOsmBuildingEntrances(buildingsOsm, areas);
  const parkingCount = areas.filter((a) => a.isParkingLot).length;
  const buildingCount = areas.length - parkingCount;

  if (buildingsOnly) {
    console.log({
      mode: "buildings+parking+entrances",
      buildings: buildingCount,
      parkingLots: parkingCount,
      entrances: entrances.length,
      dryRun,
    });
    if (dryRun) {
      await pool.end();
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const osmToDest = await insertDestinations(client, areas);
      const linkedEntrances = await linkEntrances(
        client,
        buildingsOsm,
        areas,
        osmToDest,
      );
      await client.query("COMMIT");
      console.log({
        insertedDestinations: osmToDest.size,
        linkedEntrances,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await pool.end();
    return;
  }

  const walkOsm = await loadWalkOsm(refresh, importBbox);
  const graph = parseOsmWalkGraph(walkOsm, {
    bbox: importBbox,
    campusRing,
  });
  const inclinedEdges = graph.edges.filter((e) => e.inclineDegrees > 0).length;

  console.log({
    mode: "full",
    osmNodes: graph.nodes.length,
    osmEdges: graph.edges.length,
    inclinedEdges,
    buildings: buildingCount,
    parkingLots: parkingCount,
    entrances: entrances.length,
    dryRun,
  });

  if (dryRun) {
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const walk = await insertWalkGraph(client, graph);
    const osmToDest = await insertDestinations(client, areas);
    const linkedEntrances = await linkEntrances(
      client,
      buildingsOsm,
      areas,
      osmToDest,
    );
    await client.query("COMMIT");
    console.log({
      ...walk,
      insertedDestinations: osmToDest.size,
      linkedEntrances,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
