import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND}/building/buildingpos${qs}`);

  // safest passthrough (doesn't explode on non-json errors)
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
