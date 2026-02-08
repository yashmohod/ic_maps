import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { node, edge } from "@/db/schema";
import type { Node, Edge } from "@/db/schema";

export async function GET(req: Request) {
  console.log(req.url);
  // Postgres-style result: { rows: [...] }
  const nodesResult = await db.execute(sql<Node>`SELECT * FROM ${node}`);
  const edgesResult = await db.execute(sql<Edge>`SELECT * FROM ${edge}`);

  const nodes = nodesResult.rows;
  const edges = edgesResult.rows;

  return NextResponse.json({ nodes, edges }, { status: 200 });
}
