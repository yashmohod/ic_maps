import { mkdir, writeFile, readFile, access } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { constants as fsConstants } from "fs";

export const PRIVATE_MEDIA_ROOT = path.join(
  process.cwd(),
  "storage",
  "private",
);

const MIME_BY_MAGIC: Array<{
  mime: string;
  ext: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: "image/png",
    ext: ".png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    mime: "image/jpeg",
    ext: ".jpg",
    test: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/gif",
    ext: ".gif",
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x39 || b[4] === 0x37) &&
      b[5] === 0x61,
  },
  {
    mime: "image/webp",
    ext: ".webp",
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export function sniffImageMime(
  buffer: Buffer,
): { mime: string; ext: string } | null {
  for (const row of MIME_BY_MAGIC) {
    if (row.test(buffer)) return { mime: row.mime, ext: row.ext };
  }
  return null;
}

/** Resolve a relative storage key under PRIVATE_MEDIA_ROOT (no traversal). */
export function resolvePrivateMediaPath(key: string): string | null {
  const cleaned = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..") || path.isAbsolute(cleaned))
    return null;
  const abs = path.resolve(PRIVATE_MEDIA_ROOT, cleaned);
  if (
    !abs.startsWith(PRIVATE_MEDIA_ROOT + path.sep) &&
    abs !== PRIVATE_MEDIA_ROOT
  ) {
    return null;
  }
  return abs;
}

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

export async function savePrivateImage(opts: {
  kind: "reports" | "floorplans";
  buffer: Buffer;
  /** Optional subdir under kind, e.g. destination-12 */
  subdir?: string;
  baseName?: string;
}): Promise<{ key: string; mime: string }> {
  const sniffed = sniffImageMime(opts.buffer);
  if (!sniffed) {
    throw new Error("Unrecognized image type (magic bytes)");
  }
  const parts: string[] = [opts.kind];
  if (opts.subdir) {
    const safe = opts.subdir.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    if (safe) parts.push(safe);
  }
  const base =
    (opts.baseName ?? "img").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) ||
    "img";
  const fileName = `${Date.now()}-${base}-${randomUUID().slice(0, 8)}${sniffed.ext}`;
  const key = [...parts, fileName].join("/");
  const abs = resolvePrivateMediaPath(key);
  if (!abs) throw new Error("Invalid media key");
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, opts.buffer);
  return { key, mime: sniffed.mime };
}

export async function readPrivateOrLegacyMedia(
  key: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const abs = resolvePrivateMediaPath(key);
  if (!abs) return null;

  try {
    await access(abs, fsConstants.R_OK);
    const buffer = await readFile(abs);
    const sniffed = sniffImageMime(buffer);
    return {
      buffer,
      mime: sniffed?.mime ?? "application/octet-stream",
    };
  } catch {
    // Legacy fallback: reports/foo → public/report/foo; floorplans/… → public/uploads/floorplans/…
  }

  let legacy: string | null = null;
  if (key.startsWith("reports/")) {
    legacy = path.join(
      process.cwd(),
      "public",
      "report",
      key.slice("reports/".length),
    );
  } else if (key.startsWith("floorplans/")) {
    legacy = path.join(
      process.cwd(),
      "public",
      "uploads",
      "floorplans",
      key.slice("floorplans/".length),
    );
  }
  if (!legacy) return null;
  try {
    const buffer = await readFile(legacy);
    const sniffed = sniffImageMime(buffer);
    return {
      buffer,
      mime: sniffed?.mime ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}
