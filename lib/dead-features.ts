import { sql } from "drizzle-orm";

import { db } from "@/db";

export type DeadFeatureLists = {
  outsideIds: number[];
  insideIds: number[];
};

export async function listDeadFeatures(): Promise<DeadFeatureLists> {
  const [outsideRes, insideRes] = await Promise.all([
    db.execute(sql`
      SELECT id FROM node_outside WHERE is_dead = true ORDER BY id
    `),
    db.execute(sql`
      SELECT id FROM node_inside WHERE is_dead = true ORDER BY id
    `),
  ]);

  return {
    outsideIds: outsideRes.rows.map((row) => Number(row.id)),
    insideIds: insideRes.rows.map((row) => Number(row.id)),
  };
}

export async function setOutsideNodeDead(
  outsideId: number,
  value: boolean,
): Promise<void> {
  await db.execute(sql`
    UPDATE node_outside
    SET is_dead = ${value}
    WHERE id = ${outsideId}
  `);
  await db.execute(sql`
    UPDATE node_inside
    SET is_dead = ${value}
    WHERE node_outside_id = ${outsideId}
  `);
}

export async function setInsideNodeDead(
  insideId: number,
  value: boolean,
): Promise<void> {
  const linked = await db.execute(sql<{
    node_outside_id: number | null;
  }>`
    SELECT node_outside_id
    FROM node_inside
    WHERE id = ${insideId}
    LIMIT 1
  `);

  await db.execute(sql`
    UPDATE node_inside
    SET is_dead = ${value}
    WHERE id = ${insideId}
  `);

  const outsideId = linked.rows[0]?.node_outside_id;
  if (outsideId != null) {
    await db.execute(sql`
      UPDATE node_outside
      SET is_dead = ${value}
      WHERE id = ${Number(outsideId)}
    `);
    await db.execute(sql`
      UPDATE node_inside
      SET is_dead = ${value}
      WHERE node_outside_id = ${Number(outsideId)}
    `);
  }
}
