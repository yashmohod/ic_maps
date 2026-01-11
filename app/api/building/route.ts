import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PUT(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(null, { status: res.status });
}

export async function GET(req: Request) {
  // forward to your backend with the same query params
  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND}/building/`);

  // safest passthrough (doesn't explode on non-json errors)
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
