import { NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/utils";
import { db } from "@/db";
import { sql } from "drizzle-orm";


export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const { destId, nodeId } = body as { destId: number; nodeId: number; }
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return jsonError("Invalid Ids", 400);

    const result = await db.execute(sql`
      INSERT INTO destination_node (destination_id,node_outside_id)
      VALUES(
        ${did},
        ${nid} 
      )
      `);

    return NextResponse.json({}, { status: 200 });

  } catch (err: any) {
    return jsonError("Node could not be added!", 500, err?.message ?? err);
  }


}


export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { destId, nodeId } = body as { destId: number, nodeId: number };
    const did = parseId(destId);
    const nid = parseId(nodeId);
    if (!did || !nid) return jsonError("Invalid id", 400);

    const result = await db.execute(sql`
      DELETE FROM destination_node 
      WHERE destination_id=${did} AND node_outside_id=${nid}
      `);


    return NextResponse.json({}, { status: 200 })
  } catch (err: any) {
    return jsonError("Node could not be added!", 500, err?.message ?? err);
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

    const nodes = result.rows.map((row) => {
      return row["node_outside_id"]
    })

    return NextResponse.json({ nodes }, { status: 200 })

  } catch (err: any) {
    return jsonError("Could not fetch nodes", 500, err?.message ?? err)
  }

}
