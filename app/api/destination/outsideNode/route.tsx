import { NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/utils";
import { db, pool } from "@/db";
import { sql } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const { destId, nodeId } = body as { destId: number; nodeId: number };
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return jsonError("Invalid Ids", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destination_node (destination_id, node_outside_id) VALUES ($1, $2)`,
        [did, nid]
      );
      const result = await client.query(
        `INSERT INTO node_inside (destination_id, node_outside_id, x, y) VALUES ($1, $2, 0, 0) RETURNING id`,
        [did, nid]
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row?.id) return jsonError("Insert failed", 500);
      return NextResponse.json({ id: Number(row.id) }, { status: 200 });
    } catch (txErr: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (txErr as { code?: string })?.code;
      if (code === "23505") return jsonError("This node is already attached to the destination", 409);
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Node could not be added", 500, message);
  }
}


export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { destId, nodeId } = body as { destId: number; nodeId: number };
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return jsonError("Invalid id", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Find the inside node (door) linked to this outside node in this destination
      const insideRows = await client.query(
        `SELECT id FROM node_inside WHERE destination_id = $1 AND node_outside_id = $2`,
        [did, nid]
      );
      for (const row of insideRows.rows) {
        const insideId = row.id;
        await client.query(`DELETE FROM edge_inside WHERE node_a_id = $1 OR node_b_id = $1`, [
          insideId,
        ]);
        await client.query(`DELETE FROM node_inside WHERE id = $1`, [insideId]);
      }
      await client.query(
        `DELETE FROM destination_node WHERE destination_id = $1 AND node_outside_id = $2`,
        [did, nid]
      );
      await client.query("COMMIT");
    } catch (txErr: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Delete failed", 500, message);
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationId = searchParams.get("id");
    const did = parseId(destinationId);
    if (!did) return jsonError("Invalid Id", 400);

    const result = await db.execute(sql`
      SELECT node_outside_id FROM destination_node where destination_id=${did}; 
      `)

    const nodes = result.rows.map((row: { node_outside_id?: unknown }) => row.node_outside_id);

    return NextResponse.json({ nodes }, { status: 200 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch nodes", 500, message);
  }

}
