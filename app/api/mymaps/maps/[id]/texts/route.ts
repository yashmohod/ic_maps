import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsText } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { isValidLatLng, jsonError, parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };
const ROUTE = "/api/mymaps/maps/[id]/texts";

const postSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  lat: z.number(),
  lng: z.number(),
  font_size: z.coerce.number().int().min(10).max(48).optional().default(14),
});

const putSchema = z.object({
  textId: z.coerce.number().int().positive(),
  text: z.string().trim().min(1).max(2000).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  font_size: z.coerce.number().int().min(10).max(48).optional(),
});

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

export async function GET(_req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access || !access.canRead) return jsonError("Map not found", 404);
    const texts = await db
      .select()
      .from(myMapsText)
      .where(eq(myMapsText.my_maps_id, mapId));
    return NextResponse.json({ texts }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return jsonError("Could not fetch texts", 500, getDetail(err));
  }
}

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { text, lat, lng, font_size } = parsed.data;
    if (!isValidLatLng(lat, lng)) return jsonError("Invalid lat/lng", 400);

    const [inserted] = await db
      .insert(myMapsText)
      .values({
        my_maps_id: mapId,
        text,
        lat,
        lng,
        font_size: font_size ?? 14,
      })
      .returning();

    return NextResponse.json({ text: inserted }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return jsonError("Insert failed", 500, getDetail(err));
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { textId, text, lat, lng, font_size } = parsed.data;
    const [existing] = await db
      .select()
      .from(myMapsText)
      .where(and(eq(myMapsText.id, textId), eq(myMapsText.my_maps_id, mapId)))
      .limit(1);
    if (!existing) return jsonError("Text not found", 404);

    const nextLat = lat ?? existing.lat;
    const nextLng = lng ?? existing.lng;
    if (!isValidLatLng(nextLat, nextLng))
      return jsonError("Invalid lat/lng", 400);

    const updates: {
      text?: string;
      lat: number;
      lng: number;
      font_size?: number;
    } = { lat: nextLat, lng: nextLng };
    if (text !== undefined) updates.text = text;
    if (font_size !== undefined) updates.font_size = font_size;

    const [updated] = await db
      .update(myMapsText)
      .set(updates)
      .where(eq(myMapsText.id, textId))
      .returning();

    return NextResponse.json({ text: updated }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return jsonError("Update failed", 500, getDetail(err));
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return jsonError("Missing or invalid id", 400);
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.canEdit) return jsonError("User role lacks permissions", 403);

    const { searchParams } = new URL(req.url);
    let textId = parseId(searchParams.get("textId"));
    if (!textId) {
      const body = await req.json().catch(() => null);
      textId = parseId((body as { textId?: unknown } | null)?.textId);
    }
    if (!textId) return jsonError("Missing or invalid textId", 400);

    const result = await db
      .delete(myMapsText)
      .where(and(eq(myMapsText.id, textId), eq(myMapsText.my_maps_id, mapId)))
      .returning({ id: myMapsText.id });
    if (result.length === 0) return jsonError("Text not found", 404);
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Delete failed", 500, getDetail(err));
  }
}
