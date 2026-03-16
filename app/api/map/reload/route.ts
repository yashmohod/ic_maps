import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { reloadGraph } from "@/lib/navigation";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await reloadGraph();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Graph reload failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
