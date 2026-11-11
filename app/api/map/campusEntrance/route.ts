import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { campus_entrance, nodeOutside } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guards";
import { isNonEmptyString, parseId } from "@/lib/utils";

const ROUTE = "/api/map/campusEntrance";

function entranceJson(row: {
  id: number;
  name: string;
  nodeId: number;
  lat: number;
  lng: number;
}) {
  return {
    id: row.id,
    name: row.name,
    nodeId: row.nodeId,
    lat: row.lat,
    lng: row.lng,
  };
}

async function readEntrance(id: number) {
  const [row] = await db
    .select({
      id: campus_entrance.id,
      name: campus_entrance.name,
      nodeId: campus_entrance.node_outside_id,
      lat: nodeOutside.lat,
      lng: nodeOutside.lng,
    })
    .from(campus_entrance)
    .innerJoin(nodeOutside, eq(nodeOutside.id, campus_entrance.node_outside_id))
    .where(eq(campus_entrance.id, id))
    .limit(1);
  return row ?? null;
}

export async function GET() {
  try {
    const rows = await db
      .select({
        id: campus_entrance.id,
        name: campus_entrance.name,
        nodeId: campus_entrance.node_outside_id,
        lat: nodeOutside.lat,
        lng: nodeOutside.lng,
      })
      .from(campus_entrance)
      .innerJoin(
        nodeOutside,
        eq(nodeOutside.id, campus_entrance.node_outside_id),
      );
    return NextResponse.json(
      { entrances: rows.map(entranceJson) },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Could not fetch campus entrances",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name, nodeId } = body as { name?: unknown; nodeId?: unknown };
    if (!isNonEmptyString(name, 256)) {
      return NextResponse.json(
        { error: "name must be a non-empty string (max 256 chars)" },
        { status: 400 },
      );
    }
    const nid = parseId(nodeId);
    if (!nid) {
      return NextResponse.json({ error: "Invalid nodeId" }, { status: 400 });
    }
    const [node] = await db
      .select({ id: nodeOutside.id })
      .from(nodeOutside)
      .where(eq(nodeOutside.id, nid))
      .limit(1);
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    const [inserted] = await db
      .insert(campus_entrance)
      .values({ name: name.trim(), node_outside_id: nid })
      .returning({ id: campus_entrance.id });
    if (!inserted?.id) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }
    const row = await readEntrance(inserted.id);
    return NextResponse.json(row ? entranceJson(row) : { id: inserted.id }, {
      status: 201,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "That node is already a campus entrance" },
        { status: 409 },
      );
    }
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Could not save campus entrance",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { id, name, nodeId } = body as {
      id?: unknown;
      name?: unknown;
      nodeId?: unknown;
    };
    const eid = parseId(id);
    if (!eid) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const updates: { name?: string; node_outside_id?: number } = {};
    if (name !== undefined) {
      if (!isNonEmptyString(name, 256)) {
        return NextResponse.json(
          { error: "name must be a non-empty string (max 256 chars)" },
          { status: 400 },
        );
      }
      updates.name = name.trim();
    }
    if (nodeId !== undefined) {
      const nid = parseId(nodeId);
      if (!nid) {
        return NextResponse.json({ error: "Invalid nodeId" }, { status: 400 });
      }
      updates.node_outside_id = nid;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const [updated] = await db
      .update(campus_entrance)
      .set(updates)
      .where(eq(campus_entrance.id, eid))
      .returning({ id: campus_entrance.id });
    if (!updated) {
      return NextResponse.json({ error: "Entrance not found" }, { status: 404 });
    }
    const row = await readEntrance(updated.id);
    return NextResponse.json(row ? entranceJson(row) : { id: updated.id }, {
      status: 200,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "That node is already a campus entrance" },
        { status: 409 },
      );
    }
    console.error(`[API ${ROUTE} PUT] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Could not update campus entrance",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const eid = parseId((body as { id?: unknown }).id);
    if (!eid) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await db.delete(campus_entrance).where(eq(campus_entrance.id, eid));
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Could not delete campus entrance",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
