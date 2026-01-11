
"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function normalizeAuthError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const anyErr = err as any;
  return (
    anyErr?.body?.message ||
    anyErr?.body?.error ||
    anyErr?.message ||
    anyErr?.error ||
    "Invalid email or password"
  );
}

export async function signUpAction(email: string, password: string, name: string) {
  try {
    await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
      headers: await headers(),
    });
    return { success: true, message:"Sign up successful!" };
  } catch (err) {
    return { success: false, message: normalizeAuthError(err) };
  }

}

export async function signInAction(email: string, password: string) {
  try {
    await auth.api.signInEmail({
      body: {
        email,
        password,
        rememberMe: true,
      },
      headers: await headers(),
    });
    
    return { success: true, message:"Sign in successful!" };
  } catch (err) {
    return { success: false, message: normalizeAuthError(err) };
  }

}

export async function signOutAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch(err) {
    // optional: swallow errors and still send them home
    return { success: false, message: normalizeAuthError(err) };
  }

}

