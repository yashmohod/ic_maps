import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { route, route_destination, destination } from "@/db/schema";
import { jsonError, parseId, isNonEmptyString } from "@/lib/utils";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

const ROUTE = "/api/shareableroute";

/** GET: single route by id (unauthenticated, for share links) */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id") ?? searchParams.get("routeId");
    const routeId = parseId(idParam);
    console.log(`[API ${ROUTE} GET] called`, { idParam, routeId });
    if (!routeId) return jsonError("Missing or invalid id", 400);

    const routeRow = await db
      .select()
      .from(route)
      .where(eq(route.id, routeId))
      .limit(1);

    const r = routeRow[0];
    if (!r) return jsonError("Route not found", 404);

    const destRows = await db
      .select({
        order: route_destination.order,
        id: destination.id,
        name: destination.name,
        is_parking_lot: destination.is_parking_lot,
      })
      .from(route_destination)
      .innerJoin(destination, eq(destination.id, route_destination.destination_id))
      .where(eq(route_destination.route_id, routeId))
      .orderBy(asc(route_destination.order));

    const destinations = destRows.map((d) => ({
      id: d.id,
      name: d.name,
      isParkingLot: d.is_parking_lot,
      order: d.order,
    }));

    return NextResponse.json(
      {
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        destinations,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch route", 500, message);
  }
}

/** POST: create route (authenticated, user_id from session) */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { name, description, destinationIds } = body as {
      name: unknown;
      description?: unknown;
      destinationIds?: unknown;
    };

    console.log(`[API ${ROUTE} POST] called`, { name, description, destinationIds });

    if (!isNonEmptyString(name, 256))
      return jsonError("name must be a non-empty string (max 256 chars)", 400);

    const ids: number[] = Array.isArray(destinationIds)
      ? destinationIds.map((x: unknown) => parseId(x)).filter((n): n is number => n != null)
      : [];
    if (ids.length === 0) return jsonError("destinationIds must be a non-empty array of destination ids", 400);

    const [inserted] = await db
      .insert(route)
      .values({
        user_id: session.user.id,
        name: name.trim(),
        description:
          description != null && typeof description === "string"
            ? description
            : null,
      })
      .returning({ id: route.id });

    if (!inserted?.id) return jsonError("Insert failed", 500);

    await db.insert(route_destination).values(
      ids.map((destination_id, index) => ({
        route_id: inserted.id,
        destination_id,
        order: index,
      })),
    );

    return NextResponse.json(
      { id: inserted.id, message: "Route created" },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not create route", 500, message);
  }
}

/** PUT: update route (authenticated, must own route) */
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { routeId, name, description, destinationIds } = body as {
      routeId: unknown;
      name?: unknown;
      description?: unknown;
      destinationIds?: unknown;
    };

    console.log(`[API ${ROUTE} PUT] called`, { routeId, name, description, destinationIds });

    const rId = parseId(routeId);
    if (!rId) return jsonError("Invalid or missing routeId", 400);

    const [existing] = await db
      .select()
      .from(route)
      .where(eq(route.id, rId))
      .limit(1);

    if (!existing) return jsonError("Route not found", 404);
    if (existing.user_id !== session.user.id)
      return jsonError("Forbidden", 403);

    const updates: { name?: string; description?: string | null } = {};
    if (name !== undefined) {
      if (!isNonEmptyString(name, 256))
        return jsonError("name must be a non-empty string (max 256 chars)", 400);
      updates.name = (name as string).trim();
    }
    if (description !== undefined) {
      updates.description =
        description != null && typeof description === "string"
          ? description
          : null;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(route).set(updates).where(eq(route.id, rId));
    }

    if (Array.isArray(destinationIds)) {
      const ids = destinationIds
        .map((x: unknown) => parseId(x))
        .filter((n): n is number => n != null);
      await db.delete(route_destination).where(eq(route_destination.route_id, rId));
      if (ids.length > 0) {
        await db.insert(route_destination).values(
          ids.map((destination_id, index) => ({
            route_id: rId,
            destination_id,
            order: index,
          })),
        );
      }
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not update route", 500, message);
  }
}

/** DELETE: delete route (authenticated, must own route) */
export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { routeId } = body as { routeId: unknown };
    console.log(`[API ${ROUTE} DELETE] called`, { routeId });
    const rId = parseId(routeId);
    if (!rId) return jsonError("Invalid or missing routeId", 400);

    const [existing] = await db
      .select()
      .from(route)
      .where(eq(route.id, rId))
      .limit(1);

    if (!existing) return jsonError("Route not found", 404);
    if (existing.user_id !== session.user.id)
      return jsonError("Forbidden", 403);

    await db.delete(route).where(eq(route.id, rId));
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not delete route", 500, message);
  }
}
