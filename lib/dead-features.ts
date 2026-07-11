import { sql } from "drizzle-orm";

import { db } from "@/db";
import { withBasePath } from "@/lib/base-path";

export type DeadFeatureLists = {
  outsideIds: number[];
  insideIds: number[];
};

export function routeReportDeadTarget(
  report: {
    featureType: string | null;
    nodeOutsideId: number | null;
    nodeInsideId: number | null;
  },
  isIndoor: (featureType: string | null) => boolean,
): { scope: "outside" | "inside"; id: number } | null {
  if (isIndoor(report.featureType) && report.nodeInsideId != null) {
    return { scope: "inside", id: report.nodeInsideId };
  }
  if (report.nodeOutsideId != null) {
    return { scope: "outside", id: report.nodeOutsideId };
  }
  return null;
}

export async function markRouteReportFeatureDead(
  target: { scope: "outside" | "inside"; id: number },
  value = true,
): Promise<DeadFeatureLists | null> {
  const resp = await fetch(withBasePath("/api/map/dead-feature"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: target.scope,
      id: target.id,
      value,
    }),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as DeadFeatureLists;
}

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
