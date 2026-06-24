"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useDevMode } from "@/components/dev-mode-provider";
import { useEffectiveSession } from "@/hooks/use-effective-session";

export function useRequireAdmin() {
  const router = useRouter();
  const devMode = useDevMode();
  const { session, isPending } = useEffectiveSession();
  const redirected = useRef(false);

  const isAdmin = devMode
    ? true
    : Boolean(
        (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin,
      );
  const allowed = devMode || (!isPending && !!session && isAdmin);

  useEffect(() => {
    if (devMode || isPending || redirected.current) return;
    if (!session || !isAdmin) {
      redirected.current = true;
      toast.error("Admin access required");
      router.replace("/");
    }
  }, [devMode, session, isAdmin, isPending, router]);

  return { session, isPending, isAdmin, allowed };
}
