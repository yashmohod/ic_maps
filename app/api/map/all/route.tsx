import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { nodeOutside, edgeOutside } from "@/db/schema";
import type { NodeOutside, EdgeOutside } from "@/db/schema";

export async function GET(req: Request) {
  console.log(req.url);
  // Postgres-style result: { rows: [...] }
  const nodesResult = await db.execute(sql<NodeOutside>`SELECT * FROM ${nodeOutside}`);
  const edgesResult = await db.execute(sql<EdgeOutside>`SELECT * FROM ${edgeOutside}`);

  const nodes = nodesResult.rows;
  const edges = edgesResult.rows;

  return NextResponse.json({ nodes, edges }, { status: 200 });
}
