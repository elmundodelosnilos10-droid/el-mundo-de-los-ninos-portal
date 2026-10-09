import { eq } from "drizzle-orm";
import { env } from "@/lib/runtime/env";
import { getDb } from "@/db";
import { user, userRoles } from "@/db/schema";
import { createSchoolAdminDatabaseClient, type SchoolRole, SupabaseAdminDatabaseError } from "./admin-database";
import {
  clearSessionCookies,
  createSchoolAuthClient,
  readSupabaseAuthCookies,
  serializeSessionCookies,
  SupabaseAuthError,
} from "./auth";
import { createSchoolLoginPayload, isPasswordRecoveryRateLimit, isSameOriginAuthRequest } from "./auth-route-utils";
import { getActiveSupabaseSchoolAccount } from "./session";
import { SupabaseDatabaseError } from "./database";

const MAX_BODY_BYTES = 8_192;
const SCHOOL_PASSWORD_MIN_LENGTH = 12;

type JsonRecord = Record<string, unknown>;

function json(payload: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(payload, { status, headers });
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  let body: string;
  try {
    body = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof SupabaseDatabaseError) {
    return json({ message: "No fue posible comprobar el acceso escolar. Inténtalo más tarde o consulta a dirección." }, 503);
  }
  if (error instanceof SupabaseAuthError) {
    if (isPasswordRecoveryRateLimit(error.operation, error.status)) {
      return json({ message: "El correo alcanzó un límite temporal. Espera un poco antes de solicitar otro enlace." }, 429);
    }
    if (error.code === "invalid_input") return json({ message: "Revisa los datos e inténtalo de nuevo." }, 400);
    if (error.code === "not_configured") return json({ message: "El acceso escolar todavía no está configurado." }, 503);
    if (error.code === "unavailable") return json({ message: "No fue posible conectar con el servicio de acceso." }, 503);
  }
  return json({ message: "No se pudo completar la solicitud." }, 401);
}

function isSchoolPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= SCHOOL_PASSWORD_MIN_LENGTH && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCurrentPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function activeSchoolAccount(email: string) {
  const rows = await getDb().select({ id: user.id, active: user.active, name: user.name, email: user.email })
    .from(user).where(eq(user.email, email)).limit(1);
  const account = rows[0];
  if (!account?.active) return null;
  const roles = await getDb().select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, account.id));
  return roles.length ? { ...account, roles: roles.map(row => row.role as SchoolRole) } : null;
}

export async function handleSupabaseAuthRequest(request: Request) {
  if (request.method === "GET" && new URL(request.url).pathname === "/api/auth/get-session") {
    const stored = readSupabaseAuthCookies(request.headers.get("cookie"));
    if (!stored) return json(null);
    try {
      const authUser = await createSchoolAuthClient(env).verifyCurrentUser(stored.accessToken);
      const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "";
      const account = env.SCHOOL_DATA_PROVIDER === "supabase"
        ? await getActiveSupabaseSchoolAccount(authUser, stored.accessToken)
        : email ? await activeSchoolAccount(email) : null;
      return account ? json({ user: { id: account.id, name: account.name, email: account.email } }) : json(null);
    } catch {
      return json(null);
    }
  }

  if (request.method !== "POST" || !isSameOriginAuthRequest(request)) return json({ message: "Solicitud no válida." }, 403);
  const path = new URL(request.url).pathname;
  const auth = createSchoolAuthClient(env);

  if (path === "/api/auth/sign-out") {
    const stored = readSupabaseAuthCookies(request.headers.get("cookie"));
    if (stored) {
      try { await auth.signOut(stored.accessToken); } catch { /* Local cookies are cleared even if remote sign-out is unavailable. */ }
    }
    return json({ success: true }, 200, clearSessionCookies());
  }

  const input = await readJson(request);
  if (!input) return json({ message: "Solicitud vacía o demasiado grande." }, 400);

  try {
    if (path === "/api/auth/sign-in/email") {
      if (typeof input.email !== "string" || typeof input.password !== "string") return json({ message: "Revisa el correo y la contraseña." }, 400);
      const email = input.email.trim().toLowerCase();
      if (env.SCHOOL_DATA_PROVIDER === "supabase") {
        const session = await auth.signIn(email, input.password);
        if (session.user.email?.trim().toLowerCase() !== email) return json({ message: "No pudimos iniciar sesión." }, 401);
        const account = await getActiveSupabaseSchoolAccount(session.user, session.access_token);
        if (!account) {
          try { await auth.signOut(session.access_token); } catch { /* No session credentials are returned for a denied school account. */ }
          return json({ message: "No pudimos iniciar sesión. Revisa tus datos o consulta a dirección." }, 401);
        }
        return json(createSchoolLoginPayload({ id: account.id, name: account.name, email: account.email }), 200, serializeSessionCookies(session));
      }
      const account = await activeSchoolAccount(email);
      if (!account) return json({ message: "No pudimos iniciar sesión. Revisa tus datos o consulta a dirección." }, 401);
      const session = await auth.signIn(email, input.password);
      if (session.user.email?.trim().toLowerCase() !== email) return json({ message: "No pudimos iniciar sesión." }, 401);
      try {
        await createSchoolAdminDatabaseClient(env).syncAccountAccess(session.user.id, account.roles, account.name);
      } catch (error) {
        if (error instanceof SupabaseAdminDatabaseError) {
          return json({ message: "Tu cuenta escolar se autenticó, pero aún no se pudo sincronizar el acceso. Inténtalo más tarde o contacta a dirección." }, 503);
        }
        throw error;
      }
      return json(createSchoolLoginPayload({ id: account.id, name: account.name, email: account.email }), 200, serializeSessionCookies(session));
    }

    if (path === "/api/auth/request-password-reset") {
      if (typeof input.email !== "string" || typeof input.redirectTo !== "string") return json({ message: "Revisa el correo e inténtalo de nuevo." }, 400);
      const origin = new URL(request.url).origin;
      let redirectTo: URL;
      try { redirectTo = new URL(input.redirectTo); }
      catch { return json({ message: "La dirección de recuperación no es válida." }, 400); }
      if (redirectTo.origin !== origin || redirectTo.pathname !== "/restablecer" || redirectTo.username || redirectTo.password || redirectTo.search || redirectTo.hash) {
        return json({ message: "La dirección de recuperación no es válida." }, 400);
      }
      await createSchoolAuthClient(env, fetch, origin).requestPasswordRecovery(input.email.trim().toLowerCase(), redirectTo.toString());
      return json({ status: true });
    }

    if (path === "/api/auth/reset-password") {
      if (typeof input.token !== "string" || !isSchoolPassword(input.newPassword)) return json({ message: "Usa una contraseña de al menos 12 caracteres y revisa el enlace." }, 400);
      await auth.changePassword(input.token, input.newPassword);
      return json({ success: true });
    }

    if (path === "/api/auth/change-password") {
      if (!isCurrentPassword(input.currentPassword) || !isSchoolPassword(input.newPassword)) return json({ message: "Revisa tu contraseña actual y usa una nueva de al menos 12 caracteres." }, 400);
      const stored = readSupabaseAuthCookies(request.headers.get("cookie"));
      if (!stored) return json({ message: "Inicia sesión de nuevo para cambiar tu contraseña." }, 401);
      const currentUser = await auth.verifyCurrentUser(stored.accessToken);
      const email = currentUser.email?.trim().toLowerCase();
      const account = env.SCHOOL_DATA_PROVIDER === "supabase"
        ? await getActiveSupabaseSchoolAccount(currentUser, stored.accessToken)
        : email ? await activeSchoolAccount(email) : null;
      if (!email || !account) return json({ message: "La cuenta escolar no está disponible." }, 401);
      const passwordCheck = await auth.signIn(email, input.currentPassword);
      if (passwordCheck.user.id !== currentUser.id) return json({ message: "Verifica tu contraseña actual." }, 401);
      await auth.changePassword(stored.accessToken, input.newPassword);
      try { await auth.signOut(passwordCheck.access_token); } catch { /* Password update remains successful if cleanup fails. */ }
      return json({ success: true });
    }
  } catch (error) {
    return errorResponse(error);
  }

  return json({ message: "Ruta de acceso no disponible." }, 404);
}
