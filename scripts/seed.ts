import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db"; // adjust path alias if needed
import { createReadStream } from "node:fs";
import * as readline from "node:readline";
import path from "node:path";
import { calcDistance } from "@/lib/utils";

type node = {
  id: number;
  name: string;
  lat: number;
  lng: number;
};

type edge = {
  id: number;
  name: string;
  from: number;
  to: number;
};

async function main() {
  const csvPath = path.resolve(process.cwd(), "Dev/points.csv");
  const rl = readline.createInterface({
    input: createReadStream(csvPath, { encoding: "utf8" }),
    crlfDelay: Infinity, // handles \r\n vs \n nicely
  });

  let nodes: node[] = [];
  let t = false;
  for await (const line of rl) {
    // line is a string without the newline
    if (!t) {
      t = true;
      continue;
    }
    const row = line.split(",");
    nodes.push({
      id: Number(row[0]),
      name: row[1],
      lat: Number(row[2]),
      lng: Number(row[3]),
    });

    await db.execute(sql`INSERT INTO node_outside (id,lat, lng, location,is_pedestrian)
      VALUES (
      ${Number(row[0])},
        ${Number(row[2])},
        ${Number(row[3])},
        ST_SetSRID(ST_MakePoint(${Number(row[3])}, ${Number(row[2])}), 4326),
        ${true}
      );`);
  }

  // Sync sequence so next INSERT without id gets max(id)+1 (avoids duplicate key when app adds nodes)
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('node_outside', 'id'), COALESCE((SELECT MAX(id) FROM node_outside), 1))`,
  );

  const csvPath2 = path.resolve(process.cwd(), "Dev/edges.csv");
  const rl2 = readline.createInterface({
    input: createReadStream(csvPath2, { encoding: "utf8" }),
    crlfDelay: Infinity, // handles \r\n vs \n nicely
  });

  t = false;
  for await (const line of rl2) {
    // line is a string without the newline
    if (!t) {
      t = true;
      continue;
    }
    const row = line.split(",");
    const n1 = nodes.find((cur) => cur.name === row[1]);
    const n2 = nodes.find((cur) => cur.name === row[2]);
    if (!n1 || !n2) continue;
    const distance = calcDistance(n1?.lat, n1?.lng, n2?.lat, n2?.lng);
    const a = Math.min(n1.id, n2.id);
    const b = Math.max(n1.id, n2.id);
    await db.execute(sql`
      INSERT INTO edge_outside (node_a_id, node_b_id, bi_directional, direction, distance)
      VALUES (${a}, ${b}, ${true}, ${true}, ${distance});
    `);
  }

  console.log("✅ seed done");
}

main()
  .catch((e) => {
    console.error("❌ seed failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // node-postgres scripts should close the pool so the process exits
    await pool.end();
  });
