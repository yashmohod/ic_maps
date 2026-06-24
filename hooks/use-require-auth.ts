"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useDevMode } from "@/components/dev-mode-provider";
import { useEffectiveSession } from "@/hooks/use-effective-session";

export function useRequireAuth(callbackUrl: string) {
  const router = useRouter();
  const devMode = useDevMode();
  const { session, isPending } = useEffectiveSession();
  const redirected = useRef(false);

  useEffect(() => {
    if (devMode || isPending || redirected.current || session) return;
    redirected.current = true;
    router.replace(
      `/account/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }, [devMode, session, isPending, router, callbackUrl]);

  return {
    session,
    isPending,
    allowed: devMode || (!isPending && !!session),
  };
}
