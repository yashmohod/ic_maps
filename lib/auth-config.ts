import { BASE_PATH } from "@/lib/base-path";

/** Next.js basePath — must match next.config.ts */
export const APP_BASE_PATH = BASE_PATH || "/ic_maps";

/** Public Better Auth API URL (includes /api/auth) */
export function getPublicAuthUrl(): string {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000/ic_maps";

  try {
    return `${new URL(origin).origin}${APP_BASE_PATH}/api/auth`;
  } catch {
    return `http://localhost:3000${APP_BASE_PATH}/api/auth`;
  }
}

/** Next may present route handlers paths without the Next.js basePath prefix. */
export function withAppBasePath(request: Request): Request {
  const url = new URL(request.url);
  const prefix = APP_BASE_PATH;

  if (!prefix) return request;
  if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
    return request;
  }

  url.pathname = `${prefix}${url.pathname}`;
  return new Request(url, request);
}

export const DEV_BYPASS_USER = {
  id: "dev-bypass-user",
  name: "Dev User",
  email: "dev@local.icmaps",
  isAdmin: true,
} as const;

export type DevBypassSession = {
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
  };
};

export function createDevBypassSession(
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  } = DEV_BYPASS_USER,
): DevBypassSession {
  return {
    user,
    session: {
      id: "dev-bypass-session",
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      token: "dev-bypass-token",
    },
  };
}
