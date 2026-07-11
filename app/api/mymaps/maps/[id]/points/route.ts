import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsPoint } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { isValidLatLng, parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };
const ROUTE = "/api/mymaps/maps/[id]/points";

const postSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().max(256).optional().default(""),
});

const putSchema = z.object({
  pointId: z.coerce.number().int().positive(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  name: z.string().max(256).optional(),
});

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

    const points = await db
      .select()
      .from(myMapsPoint)
      .where(eq(myMapsPoint.my_maps_id, mapId));
    return NextResponse.json({ points }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch points", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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
    const { lat, lng, name } = parsed.data;
    if (!isValidLatLng(lat, lng)) return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

    const [inserted] = await db
      .insert(myMapsPoint)
      .values({ my_maps_id: mapId, lat, lng, name: name ?? "" })
      .returning();

    return NextResponse.json({ point: inserted }, { status: 201 });
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

    const { pointId, lat, lng, name } = parsed.data;
    const [existing] = await db
      .select()
      .from(myMapsPoint)
      .where(
        and(eq(myMapsPoint.id, pointId), eq(myMapsPoint.my_maps_id, mapId)),
      )
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Point not found" }, { status: 404 });

    const nextLat = lat ?? existing.lat;
    const nextLng = lng ?? existing.lng;
    if (!isValidLatLng(nextLat, nextLng))
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });

    const updates: { lat: number; lng: number; name?: string } = {
      lat: nextLat,
      lng: nextLng,
    };
    if (name !== undefined) updates.name = name;

    const [updated] = await db
      .update(myMapsPoint)
      .set(updates)
      .where(eq(myMapsPoint.id, pointId))
      .returning();

    return NextResponse.json({ point: updated }, { status: 200 });
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
    let pointId = parseId(searchParams.get("pointId"));
    if (!pointId) {
      const body = await req.json().catch(() => null);
      pointId = parseId((body as { pointId?: unknown } | null)?.pointId);
    }
    if (!pointId) return NextResponse.json({ error: "Missing or invalid pointId" }, { status: 400 });

    const result = await db
      .delete(myMapsPoint)
      .where(
        and(eq(myMapsPoint.id, pointId), eq(myMapsPoint.my_maps_id, mapId)),
      )
      .returning({ id: myMapsPoint.id });
    if (result.length === 0) return NextResponse.json({ error: "Point not found" }, { status: 404 });
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
