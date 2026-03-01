type LocalUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

const DEFAULT_DOMAIN = "local.icmaps";

declare global {
  // eslint-disable-next-line no-var
  var __icmapsLocalUsers: Map<string, LocalUser> | undefined;
}

const users = globalThis.__icmapsLocalUsers ?? new Map<string, LocalUser>();
if (!globalThis.__icmapsLocalUsers) {
  globalThis.__icmapsLocalUsers = users;
}

function defaultUser(id: string): LocalUser {
  const safeId = (id || "").trim() || "guest";
  const [head] = safeId.split("@");
  return {
    id: safeId,
    name: head || "Guest",
    email: safeId.includes("@") ? safeId : `${safeId}@${DEFAULT_DOMAIN}`,
    isAdmin: false,
  };
}

export function getLocalUser(id: string): LocalUser {
  return users.get(id) ?? defaultUser(id);
}

export function upsertLocalUser(
  id: string,
  updates: Partial<Pick<LocalUser, "name" | "email" | "isAdmin">>,
): LocalUser {
  const existing = getLocalUser(id);
  const next: LocalUser = {
    ...existing,
    ...updates,
    id,
  };
  users.set(id, next);
  return next;
}

export function deleteLocalUser(id: string): boolean {
  return users.delete(id);
}

export function listLocalUsers(search?: string): LocalUser[] {
  const all = Array.from(users.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const term = search?.trim().toLowerCase();
  if (!term) return all;
  return all.filter(
    (u) =>
      u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
  );
}
