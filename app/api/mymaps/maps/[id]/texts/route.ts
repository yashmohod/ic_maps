import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsText } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { isValidLatLng, parseId } from "@/lib/utils";

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

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

    const texts = await db
      .select()
      .from(myMapsText)
      .where(eq(myMapsText.my_maps_id, mapId));
    return NextResponse.json({ texts }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch texts", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { text, lat, lng, font_size } = parsed.data;
    if (!isValidLatLng(lat, lng)) return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

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
    return NextResponse.json({ error: "Insert failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
    if (!existing) return NextResponse.json({ error: "Text not found" }, { status: 404 });

    const nextLat = lat ?? existing.lat;
    const nextLng = lng ?? existing.lng;
    if (!isValidLatLng(nextLat, nextLng))
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

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
    return NextResponse.json({ error: "Update failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const { searchParams } = new URL(req.url);
    let textId = parseId(searchParams.get("textId"));
    if (!textId) {
      const body = await req.json().catch(() => null);
      textId = parseId((body as { textId?: unknown } | null)?.textId);
    }
    if (!textId) return NextResponse.json({ error: "Missing or invalid textId" }, { status: 400 });

    const result = await db
      .delete(myMapsText)
      .where(and(eq(myMapsText.id, textId), eq(myMapsText.my_maps_id, mapId)))
      .returning({ id: myMapsText.id });
    if (result.length === 0) return NextResponse.json({ error: "Text not found" }, { status: 404 });
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
