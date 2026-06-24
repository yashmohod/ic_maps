import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schema } from "@/db/schema";
import {
  requireAdmin,
  requireSelfOrAdmin,
  requireSession,
} from "@/lib/auth-guards";

const ROUTE = "/api/users/[id]";

const userSelect = {
  id: schema.user.id,
  name: schema.user.name,
  email: schema.user.email,
  isAdmin: schema.user.isAdmin,
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { error } = await requireSelfOrAdmin(id);
  if (error) return error;
  console.log(`[API ${ROUTE} GET] called`, { id });
  try {
    const [user] = await db
      .select(userSelect)
      .from(schema.user)
      .where(eq(schema.user.id, id))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error(`[API ${ROUTE} GET] error`, error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await context.params;
  try {
    const body = (await req.json()) as { isAdmin?: boolean; name?: string };
    console.log(`[API ${ROUTE} PATCH] called`, { id, body });
    const updates: { isAdmin?: boolean; name?: string } = {};

    if (typeof body.isAdmin === "boolean") {
      const { error: adminError } = await requireAdmin();
      if (adminError) return adminError;
      updates.isAdmin = body.isAdmin;
    }
    if (typeof body.name === "string") {
      if (session!.user.id !== id) {
        const { error: adminError } = await requireAdmin();
        if (adminError) return adminError;
      }
      const trimmed = body.name.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "name cannot be empty" },
          { status: 400 },
        );
      }
      updates.name = trimmed;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const [user] = await db
      .update(schema.user)
      .set(updates)
      .where(eq(schema.user.id, id))
      .returning(userSelect);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error(`[API ${ROUTE} PATCH] error`, error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await context.params;
  console.log(`[API ${ROUTE} DELETE] called`, { id });
  try {
    const [deleted] = await db
      .delete(schema.user)
      .where(eq(schema.user.id, id))
      .returning({ id: schema.user.id });

    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[API ${ROUTE} DELETE] error`, error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
