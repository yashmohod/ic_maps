export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix app-relative paths for raw URLs (img src, CSS url(), fetch, etc.). */
export function withBasePath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (BASE_PATH && path.startsWith(`${BASE_PATH}/`)) return path;
  if (BASE_PATH && path === BASE_PATH) return path;
  return `${BASE_PATH}${path}`;
}

/** Strip basePath before persisting paths in the database. */
export function stripBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith(`${BASE_PATH}/`)) return path;
  return path.slice(BASE_PATH.length) || "/";
}

/** Site-root path for OAuth callbacks and raw browser URLs (better-auth). */
export function toPublicPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return withBasePath(normalized);
}

/** App-relative path for Next.js router and Link (basePath added automatically). */
export function toRouterPath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (BASE_PATH && path.startsWith(`${BASE_PATH}/`)) {
    return path.slice(BASE_PATH.length) || "/";
  }
  if (BASE_PATH && path === BASE_PATH) return "/";
  return path;
}