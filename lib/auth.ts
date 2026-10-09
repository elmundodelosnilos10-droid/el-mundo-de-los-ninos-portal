import { env } from "@/lib/runtime/env";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { user } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/recovery-email";

export function getAuth() {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be configured before enabling school accounts");
  }
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
    // Cloudflare overwrites this header at its edge; use it to keep the
    // login rate limit isolated per visitor rather than per school site.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        if (!email) return;
        const account = await getDb().select({ active: user.active }).from(user).where(eq(user.email, email)).limit(1);
        if (account[0] && !account[0].active) throw new APIError("UNAUTHORIZED", { message: "Esta cuenta está desactivada. Contacta a la escuela." });
      }),
    },
    emailAndPassword: {
      enabled: true,
      // Public sign-up is blocked by the route allowlist. Initial school setup
      // calls the server API directly after checking a one-use setup secret.
      disableSignUp: false,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(env, { to: user.email, url });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  });
}
