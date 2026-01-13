import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { schema } from "@/db/schema";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const rows = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        isAdmin: schema.user.isAdmin,
      })
      .from(schema.user)
      .where(eq(schema.user.id, id))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: rows[0] });
  } catch (error) {
    console.error("[users GET]", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = (await req.json()) as { isAdmin?: boolean; name?: string };
    const updates: { isAdmin?: boolean; name?: string } = {};

    if (typeof body.isAdmin === "boolean") {
      updates.isAdmin = body.isAdmin;
    }
    if (typeof body.name === "string") {
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

    const updated = await db
      .update(schema.user)
      .set(updates)
      .where(eq(schema.user.id, id))
      .run();

    const rows = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        isAdmin: schema.user.isAdmin,
      })
      .from(schema.user)
      .where(eq(schema.user.id, id))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (updated.changes === 0) {
      return NextResponse.json({ user: rows[0], unchanged: true });
    }

    return NextResponse.json({ user: rows[0] });
  } catch (error) {
    console.error("[users PATCH]", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const result = await db.delete(schema.user).where(eq(schema.user.id, id)).run();
    if (result.changes === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[users DELETE]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
