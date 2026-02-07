import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "./schema";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL!,
    // Good defaults for a single app instance:
    max: 10,                 // max connections in the pool
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // ssl: false, // typical for local/docker; set true only if your DB requires it
  });

if (process.env.NODE_ENV !== "production") globalThis.__pgPool = pool;

export const db = drizzle({ client: pool });

export async function getUser(userId: string) {
  const rows = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  return rows[0];
}

