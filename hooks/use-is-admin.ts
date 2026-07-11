"use client";

import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";

import { useDevMode } from "@/components/dev-mode-provider";
import { useEffectiveSession } from "@/hooks/use-effective-session";

type AdminUser = { isAdmin?: boolean };

/** Resolves admin status from dev mode, session, then /api/users/[id]. */
export function useIsAdmin() {
  const devMode = useDevMode();
  const { realSession, isPending, isSignedIn } = useEffectiveSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [resolved, setResolved] = useState(false);

  const userId = realSession?.user?.id;

  useEffect(() => {
    if (isPending) return;

    if (devMode) {
      setIsAdmin(true);
      setResolved(true);
      return;
    }

    if (!isSignedIn || !userId) {
      setIsAdmin(false);
      setResolved(true);
      return;
    }

    const fromSession = Boolean(
      (realSession.user as AdminUser | undefined)?.isAdmin,
    );
    if (fromSession) {
      setIsAdmin(true);
      setResolved(true);
      return;
    }

    let mounted = true;
    setResolved(false);

    void (async () => {
      try {
        const resp = await fetch(withBasePath(`/api/users/${userId}`));
        if (!resp.ok) {
          if (mounted) setIsAdmin(false);
          return;
        }
        const data = (await resp.json()) as { user?: AdminUser };
        if (mounted) setIsAdmin(!!data.user?.isAdmin);
      } catch {
        if (mounted) setIsAdmin(false);
      } finally {
        if (mounted) setResolved(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [devMode, isPending, isSignedIn, userId, realSession?.user]);

  return {
    isAdmin,
    isPending: isPending || !resolved,
    userId,
  };
}
