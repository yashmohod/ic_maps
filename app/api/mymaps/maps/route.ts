import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMaps, myMapsCollaborator } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getErrorDetail, requireMapReadable } from "@/lib/mymaps-http";
import { parseId } from "@/lib/utils";

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

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

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
      return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String("Insert did not return a row") } : {}) }, { status: 500 });
    }

    return NextResponse.json({ map: inserted }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = mapPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, name, is_public_view } = parsed.data;
    const gate = await requireMapReadable(id, session!.user.id);
    if ("error" in gate) return gate.error;
    const { access } = gate;

    if (is_public_view !== undefined && !access.isOwner) {
      return NextResponse.json({ error: "Only the owner can change visibility" }, { status: 403 });
    }
    if (name !== undefined && !access.canEdit) {
      return NextResponse.json({ error: "User role lacks permissions" }, { status: 403 });
    }

    const updates: { name?: string; is_public_view?: boolean } = {};
    if (name !== undefined) updates.name = name;
    if (is_public_view !== undefined) updates.is_public_view = is_public_view;

    const [updated] = await db
      .update(myMaps)
      .set(updates)
      .where(eq(myMaps.id, id))
      .returning();

    return NextResponse.json({ map: updated }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return NextResponse.json({ error: "Update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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
    return NextResponse.json({ error: "Could not fetch MyMaps", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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

    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    // 404 when missing or not readable — do not leak existence via 403.
    const gate = await requireMapReadable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;
    if (!gate.access.isOwner) {
      return NextResponse.json({ error: "Only the owner can delete this map" }, { status: 403 });
    }

    await db.delete(myMaps).where(eq(myMaps.id, mapId));

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Could not delete map", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
