/**
 * Link outdoor nodes near each destination polygon into destination_node.
 * Safe: ON CONFLICT DO NOTHING; does not clear MyMaps or other tables.
 *
 * Heuristic (OSM has almost no entrance=* on campus):
 * - outdoor nodes inside the building/parking polygon, OR
 * - within bufferMeters of the polygon boundary
 *
 * Usage:
 *   npx tsx scripts/link-nodes-near-buildings.ts [--dry-run] [--buffer-meters=8]
 */
import "dotenv/config";
import { pool } from "@/db";

function argNum(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const bufferMeters = argNum("buffer-meters", 8);

  const before = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM destination_node) AS destination_nodes,
      (SELECT count(*)::int FROM my_maps) AS my_maps,
      (SELECT count(*)::int FROM destination) AS destinations
  `);
  console.log({ dryRun, bufferMeters, before: before.rows[0] });

  const candidates = await pool.query<{
    destination_id: number;
    node_outside_id: number;
    name: string;
  }>(`
    WITH dest AS (
      SELECT
        d.id,
        d.name,
        ST_SetSRID(
          ST_GeomFromGeoJSON(
            CASE
              WHEN d.polygon::jsonb ->> 'type' = 'Feature'
                THEN (d.polygon::jsonb -> 'geometry')::text
              WHEN d.polygon::jsonb ->> 'type' = 'FeatureCollection'
                THEN (d.polygon::jsonb -> 'features' -> 0 -> 'geometry')::text
              ELSE d.polygon
            END
          ),
          4326
        ) AS geom
      FROM destination d
      WHERE d.polygon IS NOT NULL
        AND btrim(d.polygon) <> ''
        AND btrim(d.polygon) <> 'null'
    )
    SELECT DISTINCT
      dest.id AS destination_id,
      n.id AS node_outside_id,
      dest.name
    FROM dest
    JOIN node_outside n
      ON n.location IS NOT NULL
     AND (
       ST_Contains(dest.geom, n.location)
       OR ST_DWithin(
         dest.geom::geography,
         n.location::geography,
         ${bufferMeters}
       )
     )
    WHERE NOT EXISTS (
      SELECT 1
      FROM destination_node dn
      WHERE dn.destination_id = dest.id
        AND dn.node_outside_id = n.id
    )
    ORDER BY dest.name, n.id
  `);

  console.log({
    newCandidateLinks: candidates.rows.length,
    sample: candidates.rows.slice(0, 15),
  });

  if (dryRun) {
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const row of candidates.rows) {
      const r = await client.query(
        `INSERT INTO destination_node (destination_id, node_outside_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [row.destination_id, row.node_outside_id],
      );
      inserted += r.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const after = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM destination_node) AS destination_nodes,
      (SELECT count(*)::int FROM my_maps) AS my_maps,
      (SELECT count(*)::int FROM destination d
        WHERE NOT EXISTS (
          SELECT 1 FROM destination_node dn WHERE dn.destination_id = d.id
        )
        AND d.is_parking_lot = false
      ) AS buildings_still_unlinked
  `);

  console.log({ inserted, after: after.rows[0] });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
