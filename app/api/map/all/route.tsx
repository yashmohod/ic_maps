import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";

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


const ROUTE = "/api/map/all";
export async function GET() {
  try {
    console.log(`[API ${ROUTE} GET] called`);
    const resultnode = await db.execute(sql<{
      id: number;
      lng: number;
      lat: number;
      is_blue_light: boolean;
      is_pedestrian: boolean;
      is_vehicular: boolean;
      is_elevator: boolean;
      is_stairs: boolean;
    }>`
    SELECT
      id,
      lng,
      lat,
      is_blue_light,
      is_pedestrian,
      is_vehicular,
      is_elevator,
      is_stairs
    FROM node_outside;
  `);

    const nodes = resultnode.rows.map((n) => {
      return {
        id: Number(n.id),
        lng: Number(n.lng),
        lat: Number(n.lat),
        isBlueLight: Boolean(n.is_blue_light),
        isPedestrian: Boolean(n.is_pedestrian),
        isVehicular: Boolean(n.is_vehicular),
        isElevator: Boolean(n.is_elevator),
        isStairs: Boolean(n.is_stairs),
      };
    });


    const resultedge = await db.execute(sql<{
      id: number;
      node_a_id: number;
      node_b_id: number;
      bi_directional: boolean;
      direction: boolean;
      incline: number;
    }>`
    SELECT
      id,
      node_a_id,
      node_b_id,
      bi_directional,
      direction,
      incline
    FROM edge_outside;
  `);

    const edges = resultedge.rows.map((curedge) => {
      const a = curedge.direction ? curedge.node_a_id : curedge.node_b_id;
      const b = curedge.direction ? curedge.node_b_id : curedge.node_a_id;
      return {
        id: Number(curedge.id),
        from: Number(a),
        to: Number(b),
        biDirectional: Boolean(curedge.bi_directional),
        incline: Number(curedge.incline),
      };
    });



    return NextResponse.json({ nodes, edges }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch nodes", 500, message);
  }
}
