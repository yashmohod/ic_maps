import "server-only";

import { NextResponse } from "next/server";

import type { MyMapAccess } from "@/lib/mymaps-access";
import { getMapAccess } from "@/lib/mymaps-access";

import type { MyMaps } from "@/db/schema";

export function getErrorDetail(err: unknown): string {
  if (err instanceof Error && "cause" in err && err.cause instanceof Error) {
    return err.cause.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** True when Postgres unique_violation (e.g. duplicate edge pair). */
export function isUniqueViolation(err: unknown): boolean {
  const dig = (e: unknown): string => {
    if (!e || typeof e !== "object") return "";
    const o = e as { code?: string; cause?: unknown; message?: string };
    if (o.code === "23505") return "23505";
    if (o.cause) return dig(o.cause);
    return String(o.message ?? "");
  };
  const s = dig(err);
  return s === "23505" || s.includes("unique") || s.includes("23505");
}

/** Public-safe map fields (no owner_id). */
export function toPublicMap(map: MyMaps) {
  return {
    id: map.id,
    name: map.name,
    is_public_view: map.is_public_view,
    created_at: map.created_at,
  };
}

export function toAccessPayload(access: MyMapAccess) {
  return {
    role: access.role,
    isOwner: access.isOwner,
    canEdit: access.canEdit,
    canManageSharing: access.canManageSharing,
  };
}

/**
 * Load access; return 404 when the map is missing or the caller cannot read it
 * (avoids leaking map existence via 403).
 */
export async function requireMapReadable(
  mapId: number,
  userId: string | null | undefined,
): Promise<{ access: MyMapAccess } | { error: NextResponse }> {
  const access = await getMapAccess(mapId, userId);
  if (!access?.canRead) {
    return {
      error: NextResponse.json({ error: "Map not found" }, { status: 404 }),
    };
  }
  return { access };
}

/** Readable + canEdit; 404 if not readable, 403 if readable but cannot edit. */
export async function requireMapEditable(
  mapId: number,
  userId: string,
): Promise<{ access: MyMapAccess } | { error: NextResponse }> {
  const result = await requireMapReadable(mapId, userId);
  if ("error" in result) return result;
  if (!result.access.canEdit) {
    return {
      error: NextResponse.json(
        { error: "User role lacks permissions" },
        { status: 403 },
      ),
    };
  }
  return result;
}

/** Readable + owner; 404 if not readable, 403 if not owner. */
export async function requireMapOwner(
  mapId: number,
  userId: string,
): Promise<{ access: MyMapAccess } | { error: NextResponse }> {
  const result = await requireMapReadable(mapId, userId);
  if ("error" in result) return result;
  if (!result.access.isOwner) {
    return {
      error: NextResponse.json(
        { error: "Only the owner can perform this action" },
        { status: 403 },
      ),
    };
  }
  return result;
}
