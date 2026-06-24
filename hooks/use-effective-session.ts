"use client";

import { useMemo } from "react";

import { authClient, type Session } from "@/lib/auth-client";
import { createDevBypassSession } from "@/lib/auth-config";
import { useDevMode } from "@/components/dev-mode-provider";

export function useEffectiveSession() {
  const devMode = useDevMode();
  const { data: session, isPending, error, refetch } = authClient.useSession();

  const realSession = (session as Session | null) ?? null;
  const isSignedIn = !!realSession;

  const effectiveSession: Session | null = useMemo(() => {
    if (devMode) return createDevBypassSession() as Session;
    return realSession;
  }, [devMode, realSession]);

  return {
    /** Session for UI/dev bypass (mock when DEV_Mode is on). */
    session: effectiveSession,
    /** Actual better-auth session; use for user-specific API calls. */
    realSession,
    isPending: devMode ? false : isPending,
    error: devMode ? null : error,
    refetch,
    devMode,
    /** True only when the user is actually signed in. */
    isSignedIn,
  };
}
