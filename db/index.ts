import "server-only";

export const db = null;
export const pool = null;

export async function getUser(userId: string) {
  if (!userId) return null;
  return {
    id: userId,
    name: userId.split("@")[0] || "Guest",
    email: userId.includes("@") ? userId : `${userId}@local.icmaps`,
    isAdmin: false,
  };
}


