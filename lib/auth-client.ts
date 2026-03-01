"use client";

import { useCallback, useEffect, useState } from "react";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type Session = {
  user: SessionUser;
  session: { id: string };
};

const STORAGE_KEY = "icmaps.session";
const EVENT_NAME = "icmaps:session:changed";

function emitSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT_NAME));
}

function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (!session) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  emitSessionChanged();
}

function userIdFromEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function upsertLocalApiUser(user: SessionUser) {
  try {
    await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: user.name, email: user.email }),
    });
  } catch {
    // best-effort sync only
  }
}

function buildSession(user: SessionUser): Session {
  return {
    user,
    session: { id: `${user.id}-${Date.now()}` },
  };
}

export const authClient = {
  useSession() {
    const [data, setData] = useState<Session | null>(null);
    const [isPending, setIsPending] = useState(true);

    const refresh = useCallback(async () => {
      const session = readSession();
      setData(session);
      setIsPending(false);
      return { data: session, error: null };
    }, []);

    useEffect(() => {
      void refresh();
      const handler = () => void refresh();
      window.addEventListener("storage", handler);
      window.addEventListener(EVENT_NAME, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(EVENT_NAME, handler);
      };
    }, [refresh]);

    return { data, error: null, refetch: refresh, isPending };
  },

  signIn: {
    email: async (args: { email: string; password: string; rememberMe?: boolean }) => {
      const email = args.email.trim().toLowerCase();
      if (!email || !args.password) {
        return { data: null, error: { message: "Email and password are required." } };
      }
      const name = email.split("@")[0] || "User";
      const user: SessionUser = {
        id: userIdFromEmail(email),
        email,
        name,
        image: null,
      };
      await upsertLocalApiUser(user);
      writeSession(buildSession(user));
      return { data: { user }, error: null };
    },
  },

  signUp: {
    email: async (args: { email: string; password: string; name: string }) => {
      const email = args.email.trim().toLowerCase();
      const name = args.name.trim();
      if (!email || !args.password || !name) {
        return { data: null, error: { message: "Name, email, and password are required." } };
      }
      const user: SessionUser = {
        id: userIdFromEmail(email),
        email,
        name,
        image: null,
      };
      await upsertLocalApiUser(user);
      writeSession(buildSession(user));
      return { data: { user }, error: null };
    },
  },

  signOut: async () => {
    writeSession(null);
    return { data: { success: true }, error: null };
  },
};
