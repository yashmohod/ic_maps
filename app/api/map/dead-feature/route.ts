import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth-guards";
import {
  listDeadFeatures,
  setInsideNodeDead,
  setOutsideNodeDead,
} from "@/lib/dead-features";
import { reloadGraph } from "@/lib/navigation";
import { parseBoolean, parseId } from "@/lib/utils";

const ROUTE = "/api/map/dead-feature";

const deadFeatureBodySchema = z.object({
  scope: z.enum(["outside", "inside"]),
  id: z.number().int().positive(),
  value: z.boolean(),
});

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const lists = await listDeadFeatures();
    return NextResponse.json(lists);
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    return NextResponse.json({ error: "Failed to fetch dead features", ...(process.env.NODE_ENV !== "production" ? { detail: String(err instanceof Error ? err.message : String(err)) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const id = parseId(body.id);
    const value = parseBoolean(body.value);
    if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (value == null) return NextResponse.json({ error: "Invalid value (must be boolean)" }, { status: 400 });

    const parsed = deadFeatureBodySchema.safeParse({
      scope: body.scope,
      id,
      value,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { scope, id: nodeId, value: isDead } = parsed.data;

    if (scope === "outside") {
      await setOutsideNodeDead(nodeId, isDead);
    } else {
      await setInsideNodeDead(nodeId, isDead);
    }

    await reloadGraph().catch(console.error);
    const lists = await listDeadFeatures();
    return NextResponse.json(lists);
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return NextResponse.json({ error: "Failed to update dead feature", ...(process.env.NODE_ENV !== "production" ? { detail: String(err instanceof Error ? err.message : String(err)) } : {}) }, { status: 500 });
  }
}
