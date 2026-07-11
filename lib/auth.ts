import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware, APIError } from "better-auth/api";

import { db } from "@/db";
import { schema } from "@/db/schema";
import { sendDevEmail } from "@/lib/email";
import { isIthacaEduEmail, IC_SSO_REQUIRED_MESSAGE } from "@/lib/auth-domains";
import { APP_BASE_PATH, getPublicAuthUrl } from "@/lib/auth-config";

const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

const microsoftProvider =
  microsoftClientId && microsoftClientSecret
    ? {
        microsoft: {
          clientId: microsoftClientId,
          clientSecret: microsoftClientSecret,
          tenantId: process.env.MICROSOFT_TENANT_ID ?? "organizations",
        },
      }
    : undefined;

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: getPublicAuthUrl(),
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
      : "https://anzen.ithaca.edu",
  ],
  advanced: {
    trustedProxyHeaders: process.env.NODE_ENV === "production",
  },

  ...(microsoftProvider ? { socialProviders: microsoftProvider } : {}),

  user: {
    additionalFields: {
      isAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
        returned: true,
      },
    },
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,

    // ✅ password reset email hook (correct place)
    sendResetPassword: async ({ user, url }) => {
      await sendDevEmail({
        to: user.email,
        subject: "Reset your IC Maps password",
        html: `
          <h2>Reset your password</h2>
          <p><a href="${url}">Reset password</a></p>
          <p style="color:#666;font-size:12px">If you didn’t request this, ignore this email.</p>
        `,
      });
    },
  },

  emailVerification: {
    // Disabled: Resend not in use. Set sendOnSignUp: true when RESEND_API_KEY is set.
    sendOnSignUp: false,

    sendVerificationEmail: async ({ user, url }) => {
      await sendDevEmail({
        to: user.email,
        subject: "Verify your IC Maps account",
        html: `
          <h2>Verify your email</h2>
          <p><a href="${url}">Verify email</a></p>
          <p style="color:#666;font-size:12px">If you didn’t request this, ignore this email.</p>
        `,
      });
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const blockedPaths = new Set([
        "/sign-up/email",
        "/sign-in/email",
        "/request-password-reset",
      ]);

      if (!blockedPaths.has(ctx.path)) return;

      const email =
        typeof ctx.body?.email === "string" ? ctx.body.email : undefined;
      if (email && isIthacaEduEmail(email)) {
        throw new APIError("BAD_REQUEST", {
          message: IC_SSO_REQUIRED_MESSAGE,
        });
      }
    }),
  },

  plugins: [nextCookies()],
  onAPIError: {
    errorURL: `${APP_BASE_PATH}/account/login`,
  },
});
