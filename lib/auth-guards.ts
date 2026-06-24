import "server-only";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { schema } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createDevBypassSession, DEV_BYPASS_USER } from "@/lib/auth-config";
import { isIthacaEduEmail } from "@/lib/auth-domains";
import { isDevModeEnabled } from "@/lib/dev-mode";

let cachedDevBypassUser: {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
} | null = null;

async function resolveDevBypassSession() {
  if (!cachedDevBypassUser) {
    try {
      const [row] = await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          isAdmin: schema.user.isAdmin,
        })
        .from(schema.user)
        .limit(1);
      cachedDevBypassUser = row
        ? {
            id: row.id,
            name: row.name,
            email: row.email,
            isAdmin: Boolean(row.isAdmin),
          }
        : { ...DEV_BYPASS_USER };
    } catch {
      cachedDevBypassUser = { ...DEV_BYPASS_USER };
    }
  }
  return createDevBypassSession(cachedDevBypassUser);
}

export async function getSession() {
  if (isDevModeEnabled()) {
    return resolveDevBypassSession();
  }
  return auth.api.getSession({ headers: await headers() });
}

export function sessionIsAdmin(user: { isAdmin?: boolean }): boolean {
  if (isDevModeEnabled()) return true;
  return Boolean(user.isAdmin);
}

export async function resolveIsAdmin(userId: string): Promise<boolean> {
  if (isDevModeEnabled()) return true;
  const [row] = await db
    .select({ isAdmin: schema.user.isAdmin })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return Boolean(row?.isAdmin);
}

export async function requireSession() {
  if (isDevModeEnabled()) {
    return { session: await resolveDevBypassSession(), error: null };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

/** Session required with an @ithaca.edu email (shareable routes, etc.). */
export async function requireIthacaEduSession() {
  if (isDevModeEnabled()) {
    return { session: await resolveDevBypassSession(), error: null };
  }

  const { session, error } = await requireSession();
  if (error) return { session: null, error };

  const email = session!.user.email;
  if (!email || !isIthacaEduEmail(email)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session: session!, error: null };
}

export async function requireAdmin() {
  if (isDevModeEnabled()) {
    return { session: await resolveDevBypassSession(), error: null };
  }

  const { session, error } = await requireSession();
  if (error) return { session: null, error };

  const userId = session!.user.id;
  let isAdmin = sessionIsAdmin(session!.user as { isAdmin?: boolean });
  if (!isAdmin) {
    isAdmin = await resolveIsAdmin(userId);
  }
  if (!isAdmin) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session: session!, error: null };
}

/** Session required; target user must match session or caller must be admin. */
export async function requireSelfOrAdmin(targetUserId: string) {
  if (isDevModeEnabled()) {
    return { session: await resolveDevBypassSession(), error: null };
  }

  const { session, error } = await requireSession();
  if (error) return { session: null, error };

  if (session!.user.id === targetUserId) {
    return { session: session!, error: null };
  }

  const { error: adminError } = await requireAdmin();
  if (adminError) return { session: null, error: adminError };

  return { session: session!, error: null };
}
