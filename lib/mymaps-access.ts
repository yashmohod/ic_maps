import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { myMaps, myMapsCollaborator, type MyMaps } from "@/db/schema";

export type MyMapAccessRole = "owner" | "editor" | "viewer";

export type MyMapAccess = {
  map: MyMaps;
  isOwner: boolean;
  role: MyMapAccessRole | null;
  canEdit: boolean;
  canManageSharing: boolean;
  canRead: boolean;
};

/**
 * Resolve access for a personal map.
 * - Owner: full edit + sharing + delete
 * - Editor collaborator: edit graph/name (not visibility/collaborators/delete)
 * - Viewer collaborator: read-only
 * - Public guest (`is_public_view`): read-only when userId is null/unrelated
 */
export async function getMapAccess(
  mapId: number,
  userId: string | null | undefined,
): Promise<MyMapAccess | null> {
  const [map] = await db
    .select()
    .from(myMaps)
    .where(eq(myMaps.id, mapId))
    .limit(1);

  if (!map) return null;

  if (userId && map.owner_id === userId) {
    return {
      map,
      isOwner: true,
      role: "owner",
      canEdit: true,
      canManageSharing: true,
      canRead: true,
    };
  }

  if (userId) {
    const [collab] = await db
      .select({ role: myMapsCollaborator.role })
      .from(myMapsCollaborator)
      .where(
        and(
          eq(myMapsCollaborator.my_maps_id, mapId),
          eq(myMapsCollaborator.collaborator_id, userId),
        ),
      )
      .limit(1);

    if (collab) {
      const isEditor = collab.role === "editor";
      // Unknown roles fall back to viewer so a typo doesn't lock the user out.
      return {
        map,
        isOwner: false,
        role: isEditor ? "editor" : "viewer",
        canEdit: isEditor,
        canManageSharing: false,
        canRead: true,
      };
    }
  }

  if (map.is_public_view) {
    return {
      map,
      isOwner: false,
      role: null,
      canEdit: false,
      canManageSharing: false,
      canRead: true,
    };
  }

  return {
    map,
    isOwner: false,
    role: null,
    canEdit: false,
    canManageSharing: false,
    canRead: false,
  };
}
