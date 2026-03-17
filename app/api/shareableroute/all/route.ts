import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, asc, inArray } from "drizzle-orm";
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

    const routeIds = routeRows.map((r) => r.id);
    if (routeIds.length === 0) {
      return NextResponse.json({ routes: [] }, { status: 200 });
    }

    const destRows = await db
      .select({
        route_id: route_destination.route_id,
        order: route_destination.order,
        id: destination.id,
        name: destination.name,
        is_parking_lot: destination.is_parking_lot,
      })
      .from(route_destination)
      .innerJoin(destination, eq(destination.id, route_destination.destination_id))
      .where(inArray(route_destination.route_id, routeIds))
      .orderBy(asc(route_destination.route_id), asc(route_destination.order));

    const destByRoute = new Map<number, Array<{ id: number; name: string; isParkingLot: boolean; order: number }>>();
    for (const d of destRows) {
      const list = destByRoute.get(d.route_id) ?? [];
      list.push({
        id: d.id,
        name: d.name,
        isParkingLot: d.is_parking_lot,
        order: d.order,
      });
      destByRoute.set(d.route_id, list);
    }

    const routes = routeRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      destinations: destByRoute.get(r.id) ?? [],
    }));

    return NextResponse.json({ routes }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch routes", 500, message);
  }
}
