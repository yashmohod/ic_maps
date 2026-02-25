import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/local-users";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") || "").trim();

  if (id) {
    return NextResponse.json({ user: getLocalUser(id) });
  }

  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND}/user${qs}`);
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
