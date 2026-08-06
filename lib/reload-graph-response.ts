import { NextResponse } from "next/server";
import { reloadGraphReliable } from "@/lib/navigation";

/**
 * After a graph mutation: retry reload; on failure return 503 so admin knows
 * DB may be saved but in-memory routing cache is stale.
 */
export async function reloadGraphOr503(): Promise<NextResponse | null> {
  try {
    await reloadGraphReliable();
    return null;
  } catch (err) {
    console.error("[reloadGraphOr503]", err);
    return NextResponse.json(
      {
        error:
          "Saved, but routing cache failed to refresh. Please retry the edit.",
      },
      { status: 503 },
    );
  }
}
