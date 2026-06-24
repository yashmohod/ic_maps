"use client";

import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export async function signInWithMicrosoft(options?: {
  callbackURL?: string;
  loginHint?: string;
}): Promise<boolean> {
  const callbackURL = options?.callbackURL ?? "/";

  const { data, error } = await authClient.signIn.social({
    provider: "microsoft",
    callbackURL,
    loginHint: options?.loginHint,
  });

  if (error) {
    toast.error(error.message ?? "Microsoft sign-in failed");
    return false;
  }

  if (data?.url) {
    window.location.assign(data.url);
    return true;
  }

  toast.error("Microsoft sign-in is not configured.");
  return false;
}
