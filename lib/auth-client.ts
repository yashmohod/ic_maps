"use client";

import { createAuthClient } from "better-auth/react";

const basePath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? "/ic_maps"}/api/auth`;

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined" ? window.location.origin : undefined,
  basePath,
});

/** Session shape used by the app (compatible with better-auth session). */
export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
  session: { id: string };
};
