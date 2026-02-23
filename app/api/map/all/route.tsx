import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

/**
 * Proxy to Java backend GET /map/all.
 * Backend returns { nodes: NodeDTO[], edges: EdgeDTO[] } where:
 *   NodeDTO: { id: string, lat: number, lng: number, isBlueLight: boolean }
 *   EdgeDTO: { key: string, from: string, to: string, distance: number, biDirectional: boolean }
 */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/map/all`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[api/map/all] backend error:", res.status, text);
      return NextResponse.json(
        { error: "Backend map/all failed", status: res.status },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error("[api/map/all] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to reach backend", nodes: [], edges: [] },
      { status: 502 }
    );
  }
}
