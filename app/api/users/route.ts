import { NextResponse } from "next/server";
import { asc, like, or } from "drizzle-orm";

import { db } from "@/db";
import { schema } from "@/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const pattern = search ? `%${search}%` : null;

  let query = db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      isAdmin: schema.user.isAdmin,
    })
    .from(schema.user);

  if (pattern) {
    query = query.where(
      or(like(schema.user.name, pattern), like(schema.user.email, pattern)),
    );
  }

  const users = await query.orderBy(asc(schema.user.name));

  return NextResponse.json({ users });
}
