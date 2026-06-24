import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  destination,
  destination_chain,
  destination_chain_stop,
} from "@/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { jsonError, isNonEmptyString, parseId } from "@/lib/utils";

const ROUTE = "/api/destination-chains";

const chainPostSchema = z.object({
  name: z.string().trim().min(1).max(256),
  destinationIds: z.array(z.coerce.number().int().positive()).min(1),
});

const chainPutSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(256).optional(),
  destinationIds: z.array(z.coerce.number().int().positive()).min(1).optional(),
});

async function validateDestinationIds(ids: number[]) {
  if (ids.length === 0) return false;
  const rows = await db
    .select({ id: destination.id })
    .from(destination)
    .where(inArray(destination.id, ids));
  return rows.length === ids.length;
}

async function loadChainsForUser(userId: string) {
  const chains = await db
    .select({
      id: destination_chain.id,
      name: destination_chain.name,
      createdAt: destination_chain.created_at,
    })
    .from(destination_chain)
    .where(eq(destination_chain.user_id, userId))
    .orderBy(asc(destination_chain.name));

  if (chains.length === 0) return [];

  const chainIds = chains.map((c) => c.id);
  const stopRows = await db
    .select({
      chainId: destination_chain_stop.chain_id,
      destinationId: destination_chain_stop.destination_id,
      sortOrder: destination_chain_stop.sort_order,
      name: destination.name,
    })
    .from(destination_chain_stop)
    .innerJoin(
      destination,
      eq(destination.id, destination_chain_stop.destination_id),
    )
    .where(inArray(destination_chain_stop.chain_id, chainIds))
    .orderBy(
      asc(destination_chain_stop.chain_id),
      asc(destination_chain_stop.sort_order),
    );

  const stopsByChain = new Map<
    number,
    Array<{ id: number; name: string; sortOrder: number }>
  >();
  for (const row of stopRows) {
    const list = stopsByChain.get(row.chainId) ?? [];
    list.push({
      id: row.destinationId,
      name: row.name,
      sortOrder: row.sortOrder,
    });
    stopsByChain.set(row.chainId, list);
  }

  return chains.map((chain) => {
    const stops = stopsByChain.get(chain.id) ?? [];
    return {
      id: chain.id,
      name: chain.name,
      createdAt: chain.createdAt,
      destinationIds: stops.map((s) => s.id),
      destinations: stops.map((s) => ({ id: s.id, name: s.name })),
    };
  });
}

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const chains = await loadChainsForUser(session!.user.id);
    return NextResponse.json({ chains }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch chains", 500, message);
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = chainPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, destinationIds } = parsed.data;
    if (!isNonEmptyString(name, 256)) {
      return jsonError("name must be a non-empty string (max 256 chars)", 400);
    }
    if (!(await validateDestinationIds(destinationIds))) {
      return jsonError("One or more destination IDs are invalid", 400);
    }

    const [inserted] = await db
      .insert(destination_chain)
      .values({
        user_id: session!.user.id,
        name: name.trim(),
      })
      .returning({ id: destination_chain.id });

    if (!inserted?.id) return jsonError("Insert failed", 500);

    await db.insert(destination_chain_stop).values(
      destinationIds.map((destination_id, index) => ({
        chain_id: inserted.id,
        destination_id,
        sort_order: index,
      })),
    );

    return NextResponse.json({ id: inserted.id }, { status: 201 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not create chain", 500, message);
  }
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = chainPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, name, destinationIds } = parsed.data;
    const [existing] = await db
      .select()
      .from(destination_chain)
      .where(eq(destination_chain.id, id))
      .limit(1);

    if (!existing) return jsonError("Chain not found", 404);
    if (existing.user_id !== session!.user.id) {
      return jsonError("Forbidden", 403);
    }

    if (name !== undefined) {
      if (!isNonEmptyString(name, 256)) {
        return jsonError("name must be a non-empty string (max 256 chars)", 400);
      }
      await db
        .update(destination_chain)
        .set({ name: name.trim() })
        .where(eq(destination_chain.id, id));
    }

    if (destinationIds !== undefined) {
      if (!(await validateDestinationIds(destinationIds))) {
        return jsonError("One or more destination IDs are invalid", 400);
      }
      await db
        .delete(destination_chain_stop)
        .where(eq(destination_chain_stop.chain_id, id));
      await db.insert(destination_chain_stop).values(
        destinationIds.map((destination_id, index) => ({
          chain_id: id,
          destination_id,
          sort_order: index,
        })),
      );
    }

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not update chain", 500, message);
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const chainId = parseId(searchParams.get("id"));
    if (!chainId) return jsonError("Missing or invalid id", 400);

    const [existing] = await db
      .select()
      .from(destination_chain)
      .where(eq(destination_chain.id, chainId))
      .limit(1);

    if (!existing) return jsonError("Chain not found", 404);
    if (existing.user_id !== session!.user.id) {
      return jsonError("Forbidden", 403);
    }

    await db.delete(destination_chain).where(eq(destination_chain.id, chainId));
    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not delete chain", 500, message);
  }
}
