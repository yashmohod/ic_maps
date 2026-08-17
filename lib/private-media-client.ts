/** Browser-safe private media URL helpers (no fs). */

export function privateMediaApiPath(key: string): string {
  return `/api/admin/media?key=${encodeURIComponent(key)}`;
}

/** Normalize DB / client values to a storage key (or null for legacy public URLs). */
export function toPrivateMediaKey(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  const s = stored.trim();
  if (!s) return null;
  if (s.startsWith("/api/admin/media")) {
    try {
      const u = new URL(s, "http://local");
      const key = u.searchParams.get("key");
      return key ? key.replace(/^\/+/, "") : null;
    } catch {
      return null;
    }
  }
  if (s.startsWith("/uploads/floorplans/")) {
    return `floorplans/${s.slice("/uploads/floorplans/".length)}`;
  }
  if (s.startsWith("/report/")) {
    return `reports/${s.slice("/report/".length)}`;
  }
  if (s.startsWith("floorplans/") || s.startsWith("reports/")) return s;
  return null;
}

/** Admin-facing URL for a stored path (private key or legacy public path). */
export function adminMediaHref(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  const key = toPrivateMediaKey(stored);
  if (key) return privateMediaApiPath(key);
  // Legacy absolute public paths
  if (stored.startsWith("/")) return stored;
  return null;
}
