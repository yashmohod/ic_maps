import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function DELETE(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/setpolygon/`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(null, { status: res.status });
}

export async function PATCH(req: Request) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/building/setpolygon`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.text(), { status: res.status });
}
