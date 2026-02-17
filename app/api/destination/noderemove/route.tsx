import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/noderemove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
