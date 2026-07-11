import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsCollaborator, user } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import {
  getErrorDetail,
  requireMapOwner,
  requireMapReadable,
} from "@/lib/mymaps-http";
import { parseId } from "@/lib/utils";

const ROUTE = "/api/mymaps/maps/collaborator";

const roleSchema = z.enum(["viewer", "editor"]);

const postSchema = z
  .object({
    mapId: z.coerce.number().int().positive(),
    collaboratorId: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: roleSchema.default("viewer"),
  })
  .refine((b) => Boolean(b.collaboratorId || b.email), {
    message: "Provide collaboratorId or email",
  });

const putSchema = z.object({
  mapId: z.coerce.number().int().positive(),
  collaboratorId: z.string().min(1),
  role: roleSchema,
});

async function resolveUserId(opts: {
  collaboratorId?: string;
  email?: string;
}): Promise<{ id: string; name: string; email: string } | null> {
  if (opts.collaboratorId) {
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, opts.collaboratorId))
      .limit(1);
    return row ?? null;
  }
  if (opts.email) {
    const email = opts.email.trim();
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, email.toLowerCase()))
      .limit(1);
    if (row) return row;
    const [row2] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    return row2 ?? null;
  }
  return null;
}

export async function GET(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const mapId = parseId(new URL(req.url).searchParams.get("mapId"));
    if (!mapId) return NextResponse.json({ error: "Missing or invalid mapId" }, { status: 400 });

    const gate = await requireMapOwner(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const rows = await db
      .select({
        collaborator_id: myMapsCollaborator.collaborator_id,
        role: myMapsCollaborator.role,
        name: user.name,
        email: user.email,
      })
      .from(myMapsCollaborator)
      .innerJoin(user, eq(user.id, myMapsCollaborator.collaborator_id))
      .where(eq(myMapsCollaborator.my_maps_id, mapId));

    return NextResponse.json({ collaborators: rows }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Could not fetch collaborators", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { mapId, collaboratorId, email, role } = parsed.data;
    const gate = await requireMapOwner(mapId, session!.user.id);
    if ("error" in gate) return gate.error;
    const { access } = gate;

    const target = await resolveUserId({ collaboratorId, email });
    // Avoid email enumeration: same response whether user exists or not.
    if (!target) {
      return NextResponse.json(
        { ok: true, message: "If that user exists, they were invited." },
        { status: 200 },
      );
    }
    if (target.id === session!.user.id) {
      return NextResponse.json({ error: "Cannot add yourself as a collaborator" }, { status: 400 });
    }
    if (target.id === access.map.owner_id) {
      return NextResponse.json({ error: "Owner is already the map owner" }, { status: 400 });
    }

    await db
      .insert(myMapsCollaborator)
      .values({
        my_maps_id: mapId,
        collaborator_id: target.id,
        role,
      })
      .onConflictDoUpdate({
        target: [
          myMapsCollaborator.my_maps_id,
          myMapsCollaborator.collaborator_id,
        ],
        set: { role },
      });

    return NextResponse.json(
      {
        collaborator: {
          collaborator_id: target.id,
          name: target.name,
          email: target.email,
          role,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json({ error: "Could not add collaborator", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { mapId, collaboratorId, role } = parsed.data;
    const gate = await requireMapOwner(mapId, session!.user.id);
    if ("error" in gate) return gate.error;

    const result = await db
      .update(myMapsCollaborator)
      .set({ role })
      .where(
        and(
          eq(myMapsCollaborator.my_maps_id, mapId),
          eq(myMapsCollaborator.collaborator_id, collaboratorId),
        ),
      )
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });
    }

    return NextResponse.json(
      { collaborator: { collaborator_id: collaboratorId, role } },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return NextResponse.json({ error: "Could not update collaborator", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const mapId = parseId(searchParams.get("mapId"));
    const collaboratorId = searchParams.get("collaboratorId");
    if (!mapId || !collaboratorId) {
      return NextResponse.json({ error: "Missing or invalid mapId/collaboratorId" }, { status: 400 });
    }

    const gate = await requireMapReadable(mapId, session!.user.id);
    if ("error" in gate) return gate.error;
    const { access } = gate;

    const isSelf = collaboratorId === session!.user.id;
    if (!access.isOwner && !isSelf) {
      return NextResponse.json({ error: "Only the owner can remove collaborators" }, { status: 403 });
    }

    const result = await db
      .delete(myMapsCollaborator)
      .where(
        and(
          eq(myMapsCollaborator.my_maps_id, mapId),
          eq(myMapsCollaborator.collaborator_id, collaboratorId),
        ),
      )
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return NextResponse.json({ error: "Could not remove collaborator", ...(process.env.NODE_ENV !== "production" ? { detail: String(getErrorDetail(err)) } : {}) }, { status: 500 });
  }
}
