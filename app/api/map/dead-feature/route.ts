import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth-guards";
import {
  listDeadFeatures,
  setInsideNodeDead,
  setOutsideNodeDead,
} from "@/lib/dead-features";
import { refreshNavGraphAfterMutation } from "@/lib/nav-graph-refresh";
import { jsonError, parseBoolean, parseId } from "@/lib/utils";

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
    return jsonError(
      "Failed to fetch dead features",
      500,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const id = parseId(body.id);
    const value = parseBoolean(body.value);
    if (!id) return jsonError("Invalid id", 400);
    if (value == null) return jsonError("Invalid value (must be boolean)", 400);

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

    await refreshNavGraphAfterMutation();
    const lists = await listDeadFeatures();
    return NextResponse.json(lists);
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    return jsonError(
      "Failed to update dead feature",
      500,
      err instanceof Error ? err.message : String(err),
    );
  }
}
