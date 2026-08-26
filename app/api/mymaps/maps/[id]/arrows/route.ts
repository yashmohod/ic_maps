import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsArrow } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import { hexColorSchema } from "@/lib/mymaps-color";
import {
  getErrorDetail,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import {
  clampArrowSize,
  MYMAPS_ARROW_SIZE_DEFAULT,
  MYMAPS_ARROW_SIZE_MAX,
  MYMAPS_ARROW_SIZE_MIN,
  normArrowBearing,
} from "@/lib/mymaps-size";
import { isValidLatLng, parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };
const ROUTE = "/api/mymaps/maps/[id]/arrows";

const postSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  bearing: z.number().optional().default(0),
  color: hexColorSchema,
  size: z.coerce
    .number()
    .int()
    .min(MYMAPS_ARROW_SIZE_MIN)
    .max(MYMAPS_ARROW_SIZE_MAX)
    .optional()
    .default(MYMAPS_ARROW_SIZE_DEFAULT),
});

const putSchema = z.object({
  arrowId: z.coerce.number().int().positive(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  bearing: z.number().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  size: z.coerce
    .number()
    .int()
    .min(MYMAPS_ARROW_SIZE_MIN)
    .max(MYMAPS_ARROW_SIZE_MAX)
    .optional(),
});

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) {
      return NextResponse.json(
        { error: "Missing or invalid id" },
        { status: 400 },
      );
    }

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

    const arrows = await db
      .select()
      .from(myMapsArrow)
      .where(eq(myMapsArrow.my_maps_id, mapId));
    return NextResponse.json({ arrows }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json(
      {
        error: "Could not fetch arrows",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(getErrorDetail(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) {
      return NextResponse.json(
        { error: "Missing or invalid id" },
        { status: 400 },
      );
    }

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { lat, lng, bearing, color, size } = parsed.data;
    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(myMapsArrow)
      .values({
        my_maps_id: mapId,
        lat,
        lng,
        bearing: normArrowBearing(bearing ?? 0),
        color,
        size: clampArrowSize(size ?? MYMAPS_ARROW_SIZE_DEFAULT),
      })
      .returning();

    return NextResponse.json({ arrow: inserted }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json(
      {
        error: "Insert failed",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(getErrorDetail(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) {
      return NextResponse.json(
        { error: "Missing or invalid id" },
        { status: 400 },
      );
    }

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { arrowId, lat, lng, bearing, color, size } = parsed.data;

    const [existing] = await db
      .select()
      .from(myMapsArrow)
      .where(
        and(eq(myMapsArrow.id, arrowId), eq(myMapsArrow.my_maps_id, mapId)),
      )
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Arrow not found" }, { status: 404 });
    }

    const nextLat = lat ?? existing.lat;
    const nextLng = lng ?? existing.lng;
    if (!isValidLatLng(nextLat, nextLng)) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }

    const [updated] = await db
      .update(myMapsArrow)
      .set({
        lat: nextLat,
        lng: nextLng,
        ...(bearing !== undefined
          ? { bearing: normArrowBearing(bearing) }
          : {}),
        ...(color !== undefined ? { color } : {}),
        ...(size !== undefined ? { size: clampArrowSize(size) } : {}),
      })
      .where(eq(myMapsArrow.id, arrowId))
      .returning();

    return NextResponse.json({ arrow: updated }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return NextResponse.json(
      {
        error: "Update failed",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(getErrorDetail(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { session, error } = await requireSession();
  if (error) return error;
  try {
    const mapId = parseId((await params).id);
    if (!mapId) {
      return NextResponse.json(
        { error: "Missing or invalid id" },
        { status: 400 },
      );
    }

    const gate = await requireMapEditable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const url = new URL(req.url);
    const arrowId = parseId(url.searchParams.get("arrowId"));
    if (!arrowId) {
      return NextResponse.json(
        { error: "Missing or invalid arrowId" },
        { status: 400 },
      );
    }

    const deleted = await db
      .delete(myMapsArrow)
      .where(
        and(eq(myMapsArrow.id, arrowId), eq(myMapsArrow.my_maps_id, mapId)),
      )
      .returning({ id: myMapsArrow.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Arrow not found" }, { status: 404 });
    }
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json(
      {
        error: "Delete failed",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(getErrorDetail(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}
