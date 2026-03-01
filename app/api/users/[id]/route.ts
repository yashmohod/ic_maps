import { NextResponse } from "next/server";
import { deleteLocalUser, getLocalUser, upsertLocalUser } from "@/lib/local-users";

const ROUTE = "/api/users/[id]";
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  console.log(`[API ${ROUTE} GET] called`, { id });
  try {
    return NextResponse.json({ user: getLocalUser(id) });
  } catch (error) {
    console.error(`[API ${ROUTE} GET] error`, error);
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
    console.log(`[API ${ROUTE} PATCH] called`, { id, body });
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

    const user = upsertLocalUser(id, updates);
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
  const { id } = await context.params;
  console.log(`[API ${ROUTE} DELETE] called`, { id });
  try {
    const deleted = deleteLocalUser(id);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[API ${ROUTE} DELETE] error`, error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
