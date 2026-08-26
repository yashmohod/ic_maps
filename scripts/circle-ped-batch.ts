/**
 * Circle Apartments pedestrian sidewalk batch (reversible).
 *
 * Adds ped-only sidewalk + door nodes for College Circle 141 / 151 (missing
 * entrances) based on Esri satellite layout: doors face the parking aisle on
 * the east side of the buildings; a sidewalk runs between doors and the aisle.
 *
 * Usage:
 *   npx tsx scripts/circle-ped-batch.ts           # apply (needs DB from Node)
 *   npx tsx scripts/circle-ped-batch.ts --rollback
 *   psql "$DATABASE_URL" -f data/circle-ped-work/rollback.sql   # preferred undo
 *
 * Prefer the SQL rollback file after apply — it deletes only this batch's
 * destination_node links, edges, and nodes. CSV snapshot also kept under
 * data/circle-ped-work/backup-*.
 */
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { pool } from "@/db";
import { calcDistance } from "@/lib/geo";

const MANIFEST = join(
  process.cwd(),
  "data/circle-ped-work/circle-ped-batch-manifest.json",
);

type Manifest = {
  appliedAt: string;
  note: string;
  nodeIds: number[];
  edgeIds: number[];
  destinationNodeLinks: Array<{ destination_id: number; node_outside_id: number }>;
};

/** Ped sidewalk + door points digitized from satellite / building polygons. */
const NEW_NODES: Array<{
  key: string;
  lat: number;
  lng: number;
  is_pedestrian: boolean;
  is_vehicular: boolean;
}> = [
  // --- 141 sidewalk (west of parking aisle, east of building) ---
  { key: "sw141_n", lat: 42.4122, lng: -76.5017, is_pedestrian: true, is_vehicular: false },
  { key: "sw141_m", lat: 42.41208, lng: -76.50171, is_pedestrian: true, is_vehicular: false },
  { key: "sw141_s", lat: 42.41195, lng: -76.50172, is_pedestrian: true, is_vehicular: false },
  // doors on east face of College Circle 141
  { key: "door141_n", lat: 42.41218, lng: -76.50176, is_pedestrian: true, is_vehicular: false },
  { key: "door141_s", lat: 42.41193, lng: -76.50178, is_pedestrian: true, is_vehicular: false },
  // --- 151 sidewalk ---
  { key: "sw151_n", lat: 42.41162, lng: -76.50169, is_pedestrian: true, is_vehicular: false },
  { key: "sw151_m", lat: 42.41145, lng: -76.50166, is_pedestrian: true, is_vehicular: false },
  { key: "sw151_s", lat: 42.41128, lng: -76.50162, is_pedestrian: true, is_vehicular: false },
  { key: "door151_n", lat: 42.4116, lng: -76.50178, is_pedestrian: true, is_vehicular: false },
  { key: "door151_m", lat: 42.41142, lng: -76.50172, is_pedestrian: true, is_vehicular: false },
  { key: "door151_s", lat: 42.41125, lng: -76.50166, is_pedestrian: true, is_vehicular: false },
];

/** Edges between new keys, and new key → existing node id. */
const NEW_EDGES: Array<[string | number, string | number]> = [
  // sidewalk chain 141
  ["sw141_n", "sw141_m"],
  ["sw141_m", "sw141_s"],
  // doors ↔ sidewalk
  ["door141_n", "sw141_n"],
  ["door141_s", "sw141_s"],
  // sidewalk ↔ existing parking aisle (dual-mode road nodes)
  ["sw141_n", 2043],
  ["sw141_m", 3925],
  ["sw141_s", 2044],
  // connect 141 sidewalk down toward 151 / existing west spur
  ["sw141_s", "sw151_n"],
  ["sw151_n", 2045],
  // sidewalk chain 151
  ["sw151_n", "sw151_m"],
  ["sw151_m", "sw151_s"],
  ["door151_n", "sw151_n"],
  ["door151_m", "sw151_m"],
  ["door151_s", "sw151_s"],
  ["sw151_m", 3928],
  ["sw151_s", 2047],
];

/** Building destination_id → new door keys. */
const DEST_LINKS: Array<{ destination_id: number; keys: string[] }> = [
  { destination_id: 140, keys: ["door141_n", "door141_s"] }, // College Circle 141
  { destination_id: 141, keys: ["door151_n", "door151_m", "door151_s"] }, // College Circle 151
];

async function apply(dryRun: boolean) {
  if (existsSync(MANIFEST)) {
    const prev = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
    if (prev.nodeIds?.length) {
      throw new Error(
        `Manifest already exists with ${prev.nodeIds.length} nodes. Rollback first: npx tsx scripts/circle-ped-batch.ts --rollback`,
      );
    }
  }

  mkdirSync(join(process.cwd(), "data/circle-ped-work"), { recursive: true });

  if (dryRun) {
    console.log({ dryRun: true, nodes: NEW_NODES.length, edges: NEW_EDGES.length, destLinks: DEST_LINKS });
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const keyToId = new Map<string, number>();
  const nodeIds: number[] = [];
  const edgeIds: number[] = [];
  const destinationNodeLinks: Manifest["destinationNodeLinks"] = [];

  try {
    await client.query("BEGIN");

    for (const n of NEW_NODES) {
      const r = await client.query(
        `INSERT INTO node_outside (lat, lng, location, is_pedestrian, is_vehicular)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($2, $1), 4326), $3, $4)
         RETURNING id`,
        [n.lat, n.lng, n.is_pedestrian, n.is_vehicular],
      );
      const id = Number(r.rows[0].id);
      keyToId.set(n.key, id);
      nodeIds.push(id);
    }

    const resolve = (ref: string | number) =>
      typeof ref === "number" ? ref : keyToId.get(ref)!;

    for (const [from, to] of NEW_EDGES) {
      const aId = resolve(from);
      const bId = resolve(to);
      const a = Math.min(aId, bId);
      const b = Math.max(aId, bId);
      const pos = await client.query(
        `SELECT id, lat, lng FROM node_outside WHERE id = ANY($1::int[])`,
        [[a, b]],
      );
      const byId = new Map(
        pos.rows.map((row: { id: number; lat: number; lng: number }) => [Number(row.id), row]),
      );
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      const distance = calcDistance(
        Number(na.lat),
        Number(na.lng),
        Number(nb.lat),
        Number(nb.lng),
      );
      const r = await client.query(
        `INSERT INTO edge_outside (node_a_id, node_b_id, bi_directional, direction, distance)
         VALUES ($1, $2, true, true, $3)
         ON CONFLICT ON CONSTRAINT edge_outside_pair_unique DO NOTHING
         RETURNING id`,
        [a, b, distance],
      );
      if (r.rows[0]) edgeIds.push(Number(r.rows[0].id));
    }

    for (const link of DEST_LINKS) {
      for (const key of link.keys) {
        const nid = keyToId.get(key)!;
        await client.query(
          `INSERT INTO destination_node (destination_id, node_outside_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [link.destination_id, nid],
        );
        destinationNodeLinks.push({
          destination_id: link.destination_id,
          node_outside_id: nid,
        });
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const manifest: Manifest = {
    appliedAt: new Date().toISOString(),
    note: "Circle 141/151 ped sidewalk + door nodes from satellite; rollback-safe",
    nodeIds,
    edgeIds,
    destinationNodeLinks,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log("applied", manifest);
  console.log("Restart ic-maps (or reload graph) so navigation picks this up.");
  await pool.end();
}

async function rollback() {
  if (!existsSync(MANIFEST)) {
    console.log("No manifest at", MANIFEST);
    await pool.end();
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const link of manifest.destinationNodeLinks ?? []) {
      await client.query(
        `DELETE FROM destination_node
         WHERE destination_id = $1 AND node_outside_id = $2`,
        [link.destination_id, link.node_outside_id],
      );
    }
    if (manifest.edgeIds?.length) {
      await client.query(`DELETE FROM edge_outside WHERE id = ANY($1::int[])`, [
        manifest.edgeIds,
      ]);
    }
    if (manifest.nodeIds?.length) {
      // edges that reference these nodes (including any not in edgeIds) cascade
      await client.query(`DELETE FROM node_outside WHERE id = ANY($1::int[])`, [
        manifest.nodeIds,
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  writeFileSync(
    MANIFEST + ".rolled-back.json",
    JSON.stringify({ ...manifest, rolledBackAt: new Date().toISOString() }, null, 2),
  );
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        ...manifest,
        nodeIds: [],
        edgeIds: [],
        destinationNodeLinks: [],
        rolledBackAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("rolled back", {
    nodes: manifest.nodeIds?.length,
    edges: manifest.edgeIds?.length,
    links: manifest.destinationNodeLinks?.length,
  });
  console.log("Restart ic-maps (or reload graph) so navigation picks this up.");
  await pool.end();
}

const args = process.argv.slice(2);
if (args.includes("--rollback")) {
  rollback().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  apply(args.includes("--dry-run")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
