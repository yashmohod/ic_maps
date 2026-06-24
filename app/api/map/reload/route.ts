import { NextResponse } from "next/server";
import { reloadGraph } from "@/lib/navigation";
import { requireAdmin } from "@/lib/auth-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

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
