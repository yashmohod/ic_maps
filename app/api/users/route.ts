import { NextResponse } from "next/server";
import { asc, like, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { schema } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guards";

const ROUTE = "/api/users";

const usersGetSchema = z.object({
  search: z.string().trim().min(1).optional(),
});

export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const parsed = usersGetSchema.safeParse({
    search: searchParams.get("search") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { search } = parsed.data;
  const pattern = search ? `%${search}%` : null;

  console.log(`[API ${ROUTE} GET] called`, { search });

  try {
    const baseQuery = db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        isAdmin: schema.user.isAdmin,
      })
      .from(schema.user);

    const users = await (pattern
      ? baseQuery.where(
          or(like(schema.user.name, pattern), like(schema.user.email, pattern)),
        )
      : baseQuery
    ).orderBy(asc(schema.user.name));

    return NextResponse.json({ users });
  } catch (error) {
    console.error(`[API ${ROUTE} GET] error`, error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
