"use client";

import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL,
});

/** Session shape used by the app (compatible with better-auth session). */
export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  session: { id: string };
};
