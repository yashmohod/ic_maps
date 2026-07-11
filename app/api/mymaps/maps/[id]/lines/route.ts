import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsLine } from "@/db/schema";
import { getSession, requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapEditable,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { parseId } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };
const ROUTE = "/api/mymaps/maps/[id]/lines";

const postSchema = z.object({
  name: z.string().max(256).optional().default(""),
  geometry: z.unknown(),
});

const putSchema = z.object({
  lineId: z.coerce.number().int().positive(),
  name: z.string().max(256).optional(),
  geometry: z.unknown().optional(),
});

function parseLineGeometry(input: unknown): string | null {
  try {
    const obj =
      typeof input === "string"
        ? JSON.parse(input)
        : typeof input === "object" && input != null
          ? input
          : null;
    if (!obj || typeof obj !== "object") return null;
    const record = obj as Record<string, unknown>;

    if (record.type === "Feature") {
      const g = record.geometry as { type?: string } | undefined;
      if (g?.type !== "LineString") return null;
      if (!record.properties || typeof record.properties !== "object") {
        record.properties = {};
      }
      return JSON.stringify(record);
    }

    if (record.type === "LineString") {
      return JSON.stringify({
        type: "Feature",
        properties: {},
        geometry: record,
      });
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const mapId = parseId((await params).id);
    if (!mapId) return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });

    const session = await getSession();
    const userId = session?.user?.id ?? null;
    const gate = await requireMapReadable(mapId, userId);
    if ("error" in gate) return gate.error;

    const lines = await db
      .select()
      .from(myMapsLine)
      .where(eq(myMapsLine.my_maps_id, mapId));
    return NextResponse.json({ lines }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch lines", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
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

    const geomStr = parseLineGeometry(parsed.data.geometry);
    if (!geomStr) return NextResponse.json({ error: "Invalid LineString geometry" }, { status: 400 });

    const name = parsed.data.name ?? "";
    const obj = JSON.parse(geomStr) as {
      properties?: Record<string, unknown>;
    };
    obj.properties = { ...(obj.properties ?? {}), name, myMapsId: mapId };

    const [inserted] = await db
      .insert(myMapsLine)
      .values({
        my_maps_id: mapId,
        name,
        geometry: JSON.stringify(obj),
      })
      .returning();

    if (!inserted) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    obj.properties = { ...obj.properties, lineId: inserted.id };
    const [updated] = await db
      .update(myMapsLine)
      .set({ geometry: JSON.stringify(obj) })
      .where(eq(myMapsLine.id, inserted.id))
      .returning();

    return NextResponse.json({ line: updated }, { status: 201 });
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

    const { lineId, name, geometry } = parsed.data;
    const [existing] = await db
      .select()
      .from(myMapsLine)
      .where(and(eq(myMapsLine.id, lineId), eq(myMapsLine.my_maps_id, mapId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Line not found" }, { status: 404 });

    const updates: { name?: string; geometry?: string } = {};
    if (name !== undefined) updates.name = name;
    if (geometry !== undefined) {
      const geomStr = parseLineGeometry(geometry);
      if (!geomStr) return NextResponse.json({ error: "Invalid LineString geometry" }, { status: 400 });
      const obj = JSON.parse(geomStr) as {
        properties?: Record<string, unknown>;
      };
      obj.properties = {
        ...(obj.properties ?? {}),
        name: name ?? existing.name,
        myMapsId: mapId,
        lineId,
      };
      updates.geometry = JSON.stringify(obj);
    }

    const [updated] = await db
      .update(myMapsLine)
      .set(updates)
      .where(eq(myMapsLine.id, lineId))
      .returning();

    return NextResponse.json({ line: updated }, { status: 200 });
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
    let lineId = parseId(searchParams.get("lineId"));
    if (!lineId) {
      const body = await req.json().catch(() => null);
      lineId = parseId((body as { lineId?: unknown } | null)?.lineId);
    }
    if (!lineId) return NextResponse.json({ error: "Missing or invalid lineId" }, { status: 400 });

    const result = await db
      .delete(myMapsLine)
      .where(and(eq(myMapsLine.id, lineId), eq(myMapsLine.my_maps_id, mapId)))
      .returning({ id: myMapsLine.id });
    if (result.length === 0) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Delete failed", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
