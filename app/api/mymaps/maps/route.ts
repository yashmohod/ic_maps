import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMaps, myMapsCollaborator } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { jsonError, parseId } from "@/lib/utils";

const ROUTE = "/api/mymaps/maps";

const mapPostSchema = z.object({
  name: z.string().trim().min(1).max(256),
});

const mapPutSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(256).optional(),
    is_public_view: z.boolean().optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.is_public_view !== undefined,
    { message: "Provide at least one field to update" },
  );

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = mapPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const [inserted] = await db
      .insert(myMaps)
      .values({
        name: parsed.data.name,
        owner_id: session!.user.id,
      })
      .returning();

    if (!inserted) {
      return jsonError("Insert failed", 500, "Insert did not return a row");
    }

    return NextResponse.json({ map: inserted }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return jsonError("Insert failed", 500, getDetail(err));
  }
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = mapPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, name, is_public_view } = parsed.data;
    const access = await getMapAccess(id, session!.user.id);
    if (!access) return jsonError("Map not found", 404);

    if (is_public_view !== undefined && !access.isOwner) {
      return jsonError("Only the owner can change visibility", 403);
    }

    if (name !== undefined && !access.canEdit) {
      return jsonError("User role lacks permissions", 403);
    }

    if (!access.canEdit && is_public_view === undefined) {
      return jsonError("User role lacks permissions", 403);
    }

    const updates: { name?: string; is_public_view?: boolean } = {};
    if (name !== undefined) updates.name = name;
    if (is_public_view !== undefined) updates.is_public_view = is_public_view;

    await db.update(myMaps).set(updates).where(eq(myMaps.id, id));

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return jsonError("Update failed", 500, getDetail(err));
  }
}

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const userId = session!.user.id;

    const owned_maps = await db
      .select()
      .from(myMaps)
      .where(eq(myMaps.owner_id, userId))
      .orderBy(desc(myMaps.created_at));

    const collaboration_maps = await db
      .select({
        id: myMaps.id,
        name: myMaps.name,
        is_public_view: myMaps.is_public_view,
        owner_id: myMaps.owner_id,
        created_at: myMaps.created_at,
        role: myMapsCollaborator.role,
      })
      .from(myMaps)
      .innerJoin(
        myMapsCollaborator,
        eq(myMaps.id, myMapsCollaborator.my_maps_id),
      )
      .where(eq(myMapsCollaborator.collaborator_id, userId))
      .orderBy(desc(myMaps.created_at));

    return NextResponse.json(
      { owned_maps, collaboration_maps },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch MyMaps", 500, message);
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    let mapId = parseId(searchParams.get("id"));

    if (!mapId) {
      const body = await req.json().catch(() => null);
      if (body) {
        mapId = parseId((body as { id?: unknown }).id);
      }
    }

    if (!mapId) return jsonError("Missing or invalid id", 400);

    const [existing] = await db
      .select({ owner_id: myMaps.owner_id })
      .from(myMaps)
      .where(eq(myMaps.id, mapId))
      .limit(1);

    if (!existing) return jsonError("Map not found", 404);
    if (existing.owner_id !== session!.user.id) {
      return jsonError("Only the owner can delete this map", 403);
    }

    await db.delete(myMaps).where(eq(myMaps.id, mapId));

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Could not delete map", 500, getDetail(err));
  }
}
