import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { myMapsCollaborator, user } from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { getMapAccess } from "@/lib/mymaps-access";
import { jsonError, parseId } from "@/lib/utils";

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

function getDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error)
    return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

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
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, opts.email.trim().toLowerCase()))
      .limit(1);
    if (row) return row;
    // try exact email match without lowercasing if stored mixed-case
    const [row2] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, opts.email.trim()))
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
    if (!mapId) return jsonError("Missing or invalid mapId", 400);

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.isOwner) {
      return jsonError("Only the owner can list collaborators", 403);
    }

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
    return jsonError("Could not fetch collaborators", 500, getDetail(err));
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { mapId, collaboratorId, email, role } = parsed.data;
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.isOwner) {
      return jsonError("Only the owner can add collaborators", 403);
    }

    const target = await resolveUserId({ collaboratorId, email });
    if (!target) return jsonError("User not found", 404);
    if (target.id === session!.user.id) {
      return jsonError("Cannot add yourself as a collaborator", 400);
    }
    if (target.id === access.map.owner_id) {
      return jsonError("Owner is already the map owner", 400);
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
    return jsonError("Could not add collaborator", 500, getDetail(err));
  }
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { mapId, collaboratorId, role } = parsed.data;
    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);
    if (!access.isOwner) {
      return jsonError("Only the owner can update collaborators", 403);
    }

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
      return jsonError("Collaborator not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    return jsonError("Could not update collaborator", 500, getDetail(err));
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
      return jsonError("Missing or invalid mapId/collaboratorId", 400);
    }

    const access = await getMapAccess(mapId, session!.user.id);
    if (!access) return jsonError("Map not found", 404);

    const isSelf = collaboratorId === session!.user.id;
    if (!access.isOwner && !isSelf) {
      return jsonError("Only the owner can remove collaborators", 403);
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
      return jsonError("Collaborator not found", 404);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    return jsonError("Could not remove collaborator", 500, getDetail(err));
  }
}
