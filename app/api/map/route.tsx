import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";


export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND}/map/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}



export async function PUT(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/map/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/map/`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(null, { status: res.status });
}
