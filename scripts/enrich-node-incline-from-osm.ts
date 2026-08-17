/**
 * Enrich node_outside.incline from live OSM (numeric incline tags only).
 *
 * OSM `incline=8%` is percent grade (rise/run×100) → converted to degrees.
 * Ways tagged as ramps without a numeric incline stay at 0 (per product rule).
 *
 * Usage: npx tsx scripts/enrich-node-incline-from-osm.ts [--dry-run]
 */
import { pool } from "@/db";
import { calcDistance } from "@/lib/geo";
import { CAMPUS_BOUNDS } from "@/lib/map-constants";
import {
  fetchOverpassJson,
  parseOsmInclineDegrees,
  type CampusBBox,
} from "@/lib/osm-import";

const SNAP_METERS = 12;

function campusBBox(): CampusBBox {
  const [[west, south], [east, north]] = CAMPUS_BOUNDS;
  return { south, west, north, east };
}

function rampInclineQuery(bbox: CampusBBox): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:120];
(
  way["highway"]["incline"](${south},${west},${north},${east});
  way["footway"="ramp"](${south},${west},${north},${east});
  way["ramp"="yes"](${south},${west},${north},${east});
  way["ramp:wheelchair"](${south},${west},${north},${east});
);
out body;
>;
out body qt;
`.trim();
}

type OsmNodePos = { id: number; lat: number; lng: number };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const bbox = campusBBox();

  console.log("Fetching Overpass ramp / incline ways…");
  const osm = await fetchOverpassJson(rampInclineQuery(bbox));

  const nodePos = new Map<number, OsmNodePos>();
  for (const el of osm.elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    nodePos.set(el.id, { id: el.id, lat: el.lat, lng: el.lon });
  }

  /** osm node id → incline degrees from incident ways with numeric incline */
  const inclineByOsmNode = new Map<number, number>();
  let waysWithNumeric = 0;
  let waysRampNoNumber = 0;

  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    const degrees = parseOsmInclineDegrees(tags.incline);
    const isRampTagged =
      tags.footway === "ramp" ||
      tags.ramp === "yes" ||
      tags["ramp:wheelchair"] === "yes" ||
      /\bramp\b/i.test(tags.name ?? "");

    if (degrees <= 0) {
      if (isRampTagged) waysRampNoNumber += 1;
      continue;
    }
    waysWithNumeric += 1;
    for (const nid of el.nodes ?? []) {
      const prev = inclineByOsmNode.get(nid) ?? 0;
      inclineByOsmNode.set(nid, Math.max(prev, degrees));
    }
  }

  const samples: Array<{ lat: number; lng: number; incline: number }> = [];
  for (const [osmId, incline] of inclineByOsmNode) {
    const pos = nodePos.get(osmId);
    if (!pos) continue;
    samples.push({ lat: pos.lat, lng: pos.lng, incline });
  }

  console.log({
    osmElements: osm.elements.length,
    waysWithNumericIncline: waysWithNumeric,
    rampWaysWithoutNumeric: waysRampNoNumber,
    osmNodesWithIncline: samples.length,
    dryRun,
  });

  const { rows: dbNodes } = await pool.query<{
    id: number;
    lat: number;
    lng: number;
    incline: number;
  }>(`SELECT id, lat, lng, incline FROM node_outside`);

  let updated = 0;
  let matched = 0;
  const client = await pool.connect();
  try {
    if (!dryRun) await client.query("BEGIN");
    for (const sample of samples) {
      let bestId: number | null = null;
      let bestDist = SNAP_METERS;
      for (const n of dbNodes) {
        const d = calcDistance(sample.lat, sample.lng, n.lat, n.lng);
        if (d < bestDist) {
          bestDist = d;
          bestId = n.id;
        }
      }
      if (bestId == null) continue;
      matched += 1;
      const cur = dbNodes.find((n) => n.id === bestId)!;
      const next = Math.max(cur.incline ?? 0, sample.incline);
      if (next <= (cur.incline ?? 0)) continue;
      cur.incline = next;
      if (!dryRun) {
        await client.query(`UPDATE node_outside SET incline = $2 WHERE id = $1`, [
          bestId,
          next,
        ]);
      }
      updated += 1;
    }
    if (!dryRun) await client.query("COMMIT");
  } catch (err) {
    if (!dryRun) await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log({ matchedOsmToDb: matched, nodesInclineRaised: updated });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
