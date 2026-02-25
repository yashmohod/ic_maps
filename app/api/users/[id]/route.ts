import { NextResponse } from "next/server";
import { deleteLocalUser, getLocalUser, upsertLocalUser } from "@/lib/local-users";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ user: getLocalUser(id) });
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
    const body = (await req.json()) as {
      isAdmin?: boolean;
      name?: string;
      email?: string;
    };
    const updates: { isAdmin?: boolean; name?: string; email?: string } = {};

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
    if (typeof body.email === "string") {
      const trimmed = body.email.trim();
      if (trimmed) updates.email = trimmed;
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
    const deleted = deleteLocalUser(id);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[users DELETE]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
