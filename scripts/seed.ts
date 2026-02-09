// scripts/seed.ts
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db"; // adjust path alias if needed

async function main() {

  const nodetypes = ["outside", "elevator","stairwell", "ramp"]

  await db.execute(sql`
    INSERT INTO node_type (id, name)
    VALUES (1, 'outside'), (2, 'outside')
    ON CONFLICT (id) DO NOTHING;
  `);

  await db.execute(sql`
    INSERT INTO nav_mode (id, name)
    VALUES (1, 'walk'), (2, 'accessible')
    ON CONFLICT (id) DO NOTHING;
  `);

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