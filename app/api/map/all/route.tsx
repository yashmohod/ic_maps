import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import type { NodeOutside, EdgeOutside } from "@/db/schema";

const includeDetail = process.env.NODE_ENV !== "production";
function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(includeDetail && detail != null ? { detail: String(detail) } : {}),
    },
    { status },
  );
}


export async function GET(req: Request) {
try {
  const resultnode = await db.execute(sql<NodeOutside>`
    SELECT
      id,
      lng,
      lat,
      is_blue_light AS "isBlueLight",
      is_pedestrian AS "isPedestrian",
      is_vehicular AS "isVehicular",
      is_elevator AS "isElevator",
      is_stairs AS "isStairs"
    FROM node_outside;
  `);

  let nodes = resultnode.rows.map((n) => {
    return {
      id: Number(n.id),
      lng: Number(n.lng),
      lat: Number(n.lat),
      isBlueLight: Boolean(n.isBlueLight),
      isPedestrian: Boolean(n.isPedestrian),
      isVehicular: Boolean(n.isVehicular),
      isElevator: Boolean(n.isElevator),
      isStairs: Boolean(n.isStairs),
    };
  });


  const resultedge = await db.execute(sql<EdgeOutside>`
    SELECT
      id,
      node_a_id AS "nodeAId",
      node_b_id AS "nodeBId",
      bi_directional AS "biDirectional",
      direction,
      incline
    FROM edge_outside;
  `);

  let edges = resultedge.rows.map((curedge) => {
    const a = curedge.direction ? curedge.nodeAId : curedge.nodeBId;
    const b = curedge.direction ? curedge.nodeBId : curedge.nodeAId;
    return {
      key: Number(curedge.id),
      from:Number(a) ,
      to: Number(b),
      biDirectional: Boolean(curedge.biDirectional),
      incline: Number(curedge.incline),
    };
  });



  return NextResponse.json({ nodes, edges }, { status: 200 });
  } catch (err: any) {
    return jsonError("Could not fetch nodes", 500, err?.message ?? err);
  }
}
