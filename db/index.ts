import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") globalThis.__pgPool = pool;

export const db = drizzle({ client: pool });
export { pool };
