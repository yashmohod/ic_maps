"use client";

import { useMemo } from "react";

import { useDevMode } from "@/components/dev-mode-provider";
import { useEffectiveSession } from "@/hooks/use-effective-session";
import { isIthacaEduEmail } from "@/lib/auth-domains";

/** True when signed in with an @ithaca.edu account (or dev mode). */
export function useIsIcUser() {
  const devMode = useDevMode();
  const { realSession, isPending, isSignedIn } = useEffectiveSession();

  const isIcUser = useMemo(() => {
    if (devMode) return true;
    if (!isSignedIn) return false;
    const email = realSession?.user?.email;
    return email ? isIthacaEduEmail(email) : false;
  }, [devMode, isSignedIn, realSession?.user?.email]);

  return { isIcUser, isPending, isSignedIn, devMode };
}
