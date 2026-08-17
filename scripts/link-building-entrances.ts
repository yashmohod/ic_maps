/**
 * Safely link OSM building entrances → destination_node.
 * Does NOT clear map data, MyMaps, indoor graphs, or walk edges.
 *
 * - Inserts missing destinations by name (ON CONFLICT DO NOTHING)
 * - Snaps/creates outdoor nodes for OSM entrance=* tags
 * - Inserts destination_node links (ON CONFLICT DO NOTHING)
 *
 * Usage:
 *   npx tsx scripts/link-building-entrances.ts [--refresh] [--dry-run]
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/db";
import {
  bboxFromRing,
  buildCampusBuildingsQuery,
  fetchOverpassJson,
  findSnapTarget,
  parseOsmBuildingEntrances,
  parseOsmBuildings,
  type CampusBBox,
  type LngLatRing,
  type OsmOverpassResponse,
} from "@/lib/osm-import";

const ENTRANCE_SNAP_METERS = 12;
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

async function loadBuildingsOsm(
  refresh: boolean,
  bbox: CampusBBox,
): Promise<OsmOverpassResponse> {
  if (!refresh) {
    try {
      return JSON.parse(
        await readFile(BUILDINGS_CACHE, "utf8"),
      ) as OsmOverpassResponse;
    } catch {
      // fall through to fetch
    }
  }
  const json = await fetchOverpassJson(buildCampusBuildingsQuery(bbox));
  await writeFile(BUILDINGS_CACHE, JSON.stringify(json));
  return json;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");

  const campusRing = await loadCampusRing();
  const bbox = bboxFromRing(campusRing);
  const buildingsOsm = await loadBuildingsOsm(refresh, bbox);
  const areas = parseOsmBuildings(buildingsOsm, { bbox, campusRing });
  const entrances = parseOsmBuildingEntrances(buildingsOsm, areas);

  console.log({
    dryRun,
    refresh,
    areas: areas.length,
    parkingLots: areas.filter((a) => a.isParkingLot).length,
    osmEntrances: entrances.length,
  });

  if (dryRun) {
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let insertedDestinations = 0;
  let insertedNodes = 0;
  let linked = 0;
  let alreadyLinked = 0;

  try {
    await client.query("BEGIN");

    const osmToDest = new Map<number, number>();
    for (const b of areas) {
      const poly = {
        ...b.feature,
        properties: {
          ...b.feature.properties,
          name: b.name,
          isParkingLot: b.isParkingLot,
        } as Record<string, unknown>,
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
      } else {
        insertedDestinations += 1;
        poly.properties = { ...poly.properties, destId: id, name: b.name };
        await client.query(`UPDATE destination SET polygon = $2 WHERE id = $1`, [
          id,
          JSON.stringify(poly),
        ]);
      }
      if (id != null) osmToDest.set(b.osmId, id);
    }

    const existingRes = await client.query<{
      id: number;
      lat: number;
      lng: number;
    }>(`SELECT id, lat, lng FROM node_outside`);
    const existing = existingRes.rows;

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
        insertedNodes += 1;
      }

      const link = await client.query(
        `INSERT INTO destination_node (destination_id, node_outside_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [destId, nodeId],
      );
      if ((link.rowCount ?? 0) > 0) linked += 1;
      else alreadyLinked += 1;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const counts = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM destination) AS destinations,
      (SELECT count(*)::int FROM destination_node) AS destination_nodes,
      (SELECT count(*)::int FROM node_outside) AS outside_nodes,
      (SELECT count(*)::int FROM my_maps) AS my_maps
  `);

  console.log({
    insertedDestinations,
    insertedEntranceNodes: insertedNodes,
    newLinks: linked,
    alreadyLinked,
    totals: counts.rows[0],
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
