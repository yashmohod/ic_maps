import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "../db";
import { schema } from "../db/schema";
import { sendDevEmail } from "../lib/email";

const APP_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  // ✅ makes verification/reset links consistent
  baseURL: APP_URL,
  // ✅ required for origin validation (localhost, LAN IP, etc.)
  trustedOrigins: [APP_URL],

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

  plugins: [nextCookies()],
});
