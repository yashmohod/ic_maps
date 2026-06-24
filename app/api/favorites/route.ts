import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  destination,
  user_favorite_destination,
} from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { jsonError, parseId } from "@/lib/utils";

const ROUTE = "/api/favorites";

const favoritePostSchema = z.object({
  destinationId: z.coerce.number().int().positive(),
});

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const rows = await db
      .select({
        id: destination.id,
        name: destination.name,
        lat: destination.lat,
        lng: destination.lng,
      })
      .from(user_favorite_destination)
      .innerJoin(
        destination,
        eq(destination.id, user_favorite_destination.destination_id),
      )
      .where(eq(user_favorite_destination.user_id, session!.user.id))
      .orderBy(asc(destination.name));

    return NextResponse.json({ favorites: rows }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch favorites", 500, message);
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = favoritePostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const destinationId = parsed.data.destinationId;
    const [dest] = await db
      .select({ id: destination.id })
      .from(destination)
      .where(eq(destination.id, destinationId))
      .limit(1);
    if (!dest) return jsonError("Destination not found", 404);

    await db
      .insert(user_favorite_destination)
      .values({
        user_id: session!.user.id,
        destination_id: destinationId,
      })
      .onConflictDoNothing();

    return NextResponse.json({ destinationId }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not add favorite", 500, message);
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const destinationId = parseId(searchParams.get("destinationId"));
    if (!destinationId) return jsonError("Missing or invalid destinationId", 400);

    await db
      .delete(user_favorite_destination)
      .where(
        and(
          eq(user_favorite_destination.user_id, session!.user.id),
          eq(user_favorite_destination.destination_id, destinationId),
        ),
      );

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not remove favorite", 500, message);
  }
}
