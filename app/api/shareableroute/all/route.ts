import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { route, route_destination, destination } from "@/db/schema";
import { jsonError } from "@/lib/utils";

const ROUTE = "/api/shareableroute/all";

export async function GET() {
  try {
    console.log(`[API ${ROUTE} GET] called`);
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return jsonError("Unauthorized", 401);

    const routeRows = await db
      .select()
      .from(route)
      .where(eq(route.user_id, session.user.id));

    const routes: Array<{
      id: number;
      name: string;
      description?: string;
      destinations: Array<{ id: number; name: string; isParkingLot: boolean; order: number }>;
    }> = [];

    for (const r of routeRows) {
      const destRows = await db
        .select({
          order: route_destination.order,
          id: destination.id,
          name: destination.name,
          is_parking_lot: destination.is_parking_lot,
        })
        .from(route_destination)
        .innerJoin(destination, eq(destination.id, route_destination.destination_id))
        .where(eq(route_destination.route_id, r.id))
        .orderBy(asc(route_destination.order));

      routes.push({
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        destinations: destRows.map((d) => ({
          id: d.id,
          name: d.name,
          isParkingLot: d.is_parking_lot,
          order: d.order,
        })),
      });
    }

    return NextResponse.json({ routes }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch routes", 500, message);
  }
}
