import { NextResponse } from "next/server";
import { parseId } from "@/lib/utils";
import { db, pool } from "@/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { reloadGraph } from "@/lib/navigation";

const ROUTE = "/api/destination/outsideNode";

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { destId, nodeId } = body as { destId: number; nodeId: number };
    console.log(`[API ${ROUTE} POST] called`, { destId, nodeId });
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return NextResponse.json({ error: "Invalid Ids" }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destination_node (destination_id, node_outside_id) VALUES ($1, $2)`,
        [did, nid],
      );
      const result = await client.query(
        `INSERT INTO node_inside (destination_id, node_outside_id, x, y) VALUES ($1, $2, 0, 0) RETURNING id`,
        [did, nid],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row?.id) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      await reloadGraph().catch(console.error);
      return NextResponse.json({ id: Number(row.id) }, { status: 200 });
    } catch (txErr: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (txErr as { code?: string })?.code;
      if (code === "23505")
        return NextResponse.json({ error: "This node is already attached to the destination" }, { status: 409 });
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Node could not be added", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { destId, nodeId } = body as { destId: number; nodeId: number };
    console.log(`[API ${ROUTE} DELETE] called`, { destId, nodeId });
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Find the inside node (door) linked to this outside node in this destination
      const insideRows = await client.query(
        `SELECT id FROM node_inside WHERE destination_id = $1 AND node_outside_id = $2`,
        [did, nid],
      );
      for (const row of insideRows.rows) {
        const insideId = row.id;
        await client.query(
          `DELETE FROM edge_inside WHERE node_a_id = $1 OR node_b_id = $1`,
          [insideId],
        );
        await client.query(`DELETE FROM node_inside WHERE id = $1`, [insideId]);
      }
      await client.query(
        `DELETE FROM destination_node WHERE destination_id = $1 AND node_outside_id = $2`,
        [did, nid],
      );
      await client.query("COMMIT");
    } catch (txErr: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    await reloadGraph().catch(console.error);
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationId = searchParams.get("id");
    console.log(`[API ${ROUTE} GET] called`, { destinationId });
    const did = parseId(destinationId);
    if (!did) return NextResponse.json({ error: "Invalid Id" }, { status: 400 });

    const result = await db.execute(sql`
      SELECT dn.node_outside_id, no.lat, no.lng, ni.name
      FROM destination_node dn
      INNER JOIN node_outside no ON no.id = dn.node_outside_id
      LEFT JOIN node_inside ni
        ON ni.destination_id = dn.destination_id
       AND ni.node_outside_id = dn.node_outside_id
      WHERE dn.destination_id = ${did}
    `);

    const nodes = result.rows.map(
      (row: { node_outside_id?: unknown }) => row.node_outside_id,
    );
    const nodeDetails = result.rows.map(
      (row: {
        node_outside_id?: unknown;
        lat?: unknown;
        lng?: unknown;
        name?: unknown;
      }) => ({
        id: Number(row.node_outside_id),
        lat: Number(row.lat),
        lng: Number(row.lng),
        name:
          row.name != null && String(row.name).trim().length > 0
            ? String(row.name).trim()
            : null,
      }),
    );

    return NextResponse.json({ nodes, nodeDetails }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Could not fetch nodes", ...(process.env.NODE_ENV !== "production" ? { detail: String(message) } : {}) }, { status: 500 });
  }
}
