import { reloadGraph } from "@/lib/navigation";

/** Rebuild the in-memory navigation graph after a graph-affecting DB mutation. */
export async function refreshNavGraphAfterMutation(): Promise<void> {
  try {
    await reloadGraph();
  } catch (err) {
    console.error("[nav-graph] refresh after mutation failed", err);
  }
}
