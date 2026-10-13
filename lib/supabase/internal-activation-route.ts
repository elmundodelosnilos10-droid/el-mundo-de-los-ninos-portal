/** First access only. Provisional credentials never authorize school pages. */
import { env } from "@/lib/runtime/env";
import { createSchoolAuthClient, serializeAuthCookie, SupabaseAuthError, type AuthUser } from "./auth";
import { isSameOriginAuthRequest } from "./auth-route-utils";
import { getActiveSupabaseSchoolAccount } from "./session";
import { claimInternalActivation } from "./internal-activation-database";
import { isInternalActivationSecret, readInternalActivationCode, readInternalActivationSession, sealInternalActivationSession, type InternalActivationSession } from "./internal-activation";

export const INTERNAL_ACTIVATION_COOKIE = "__Host-school-activation";
type Environment = Parameters<typeof createSchoolAuthClient>[0] & {
  SCHOOL_AUTH_PROVIDER?: string; SCHOOL_DATA_PROVIDER?: string;
  SCHOOL_ACCOUNT_ACTIVATION_MODE?: string; SCHOOL_ACCOUNT_ACTIVATION_SECRET?: string;
};
type Dependencies = {
  environment: Environment;
  auth: () => ReturnType<typeof createSchoolAuthClient>;
  account: typeof getActiveSupabaseSchoolAccount;
  claim: (session: InternalActivationSession) => Promise<boolean>;
  now: () => number;
};
const MAX_BODY = 8_192;
const expired = "La activación no está disponible o ya venció. Solicita ayuda a la escuela.";
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function json(payload: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(payload, { status, headers });
}
function clearCookie() { return serializeAuthCookie(INTERNAL_ACTIVATION_COOKIE, "", { maxAgeSeconds: 0, expires: new Date(0) }); }
function cookieValue(request: Request) {
  const header = request.headers.get("cookie");
  if (!header || header.length > 32_768) return null;
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(INTERNAL_ACTIVATION_COOKIE + "="));
  if (matches.length !== 1) return null;
  try { const value = decodeURIComponent(matches[0].slice(INTERNAL_ACTIVATION_COOKIE.length + 1)); return value && value.length <= 3_800 && !/[\s\u0000-\u001f\u007f]/.test(value) ? value : null; }
  catch { return null; }
}
async function readJson(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) { await request.body?.cancel().catch(() => {}); return null; }
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; if (total > MAX_BODY) { await reader.cancel(); return null; } chunks.push(item.value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
function exactKeys(input: Record<string, unknown>, keys: string[]) { return Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)); }
function password(value: unknown): value is string { return typeof value === "string" && value.length >= 12 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value); }
function receiptMatches(user: AuthUser, candidate: Pick<InternalActivationSession, "id" | "email" | "nonce" | "role">) {
  const receipt = record(user.app_metadata?.school_invitation_receipt);
  return user.id === candidate.id && user.email?.trim().toLowerCase() === candidate.email &&
    receipt.email === candidate.email && receipt.nonce === candidate.nonce && receipt.delivery === "internal" && receipt.role === candidate.role &&
    typeof user.invited_at === "string" && Number.isFinite(Date.parse(user.invited_at)) &&
    user.app_metadata?.school_activation_completed_nonce !== candidate.nonce;
}

export function createInternalActivationHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = { environment: env as Environment, auth: () => createSchoolAuthClient(env), account: getActiveSupabaseSchoolAccount, now: Date.now, ...overrides, claim: overrides.claim ?? (session => claimInternalActivation(overrides.environment ?? env, session)) };
  const configured = () => dependencies.environment.SCHOOL_AUTH_PROVIDER === "supabase" && dependencies.environment.SCHOOL_DATA_PROVIDER === "supabase" && dependencies.environment.SCHOOL_ACCOUNT_ACTIVATION_MODE === "internal" && isInternalActivationSecret(dependencies.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET);
  async function allowed(auth: ReturnType<typeof createSchoolAuthClient>, candidate: InternalActivationSession) {
    const user = await auth.verifyCurrentUser(candidate.accessToken);
    if (!receiptMatches(user, candidate)) return null;
    const account = await dependencies.account(user, candidate.accessToken);
    return account && account.id === candidate.id && account.email === candidate.email && account.roles.length === 1 && account.roles[0] === candidate.role ? user : null;
  }
  async function provisional(request: Request) {
    const value = cookieValue(request); if (!value) return null;
    try {
      const session = await readInternalActivationSession(value, dependencies.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET!, dependencies.now());
      const auth = dependencies.auth(); const user = await allowed(auth, session);
      return user ? { auth, user, session } : null;
    } catch { return null; }
  }
  async function dispose(auth: ReturnType<typeof createSchoolAuthClient>, accessToken: string) { try { await auth.signOut(accessToken); } catch { /* No provider diagnostics or credential echo. */ } }
  function providerError(error: unknown) {
    if (error instanceof SupabaseAuthError && error.status === 429) return json({ message: "Alcanzaste un límite temporal. Espera unos minutos antes de intentarlo otra vez." }, 429);
    if (error instanceof SupabaseAuthError && (error.code === "unavailable" || error.code === "not_configured")) return json({ message: "El servicio de acceso no está disponible. Conserva tu código e inténtalo más tarde." }, 503);
    return json({ message: expired, code: "activation_expired" }, 401, clearCookie());
  }
  async function handle(request: Request) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && !isSameOriginAuthRequest(request)) return json({ message: "Solicitud no válida." }, 403);
    if (request.method === "GET" && (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.has("origin") && !isSameOriginAuthRequest(request)))) return json({ message: "Solicitud no válida." }, 403);
    if (request.method === "POST" && path === "/api/account-activation/cancel") {
      const current = configured() ? await provisional(request) : null;
      if (current) await dispose(current.auth, current.session.accessToken);
      return json({ cancelled: true }, 200, clearCookie());
    }
    if (!configured()) return json({ message: "El primer acceso está pendiente de configuración por la escuela." }, 503);
    if (request.method === "GET" && path === "/api/account-activation") {
      const current = await provisional(request);
      return current ? json({ pending: true, email: current.session.email }) : json({ pending: false }, 200, clearCookie());
    }
    if (request.method !== "POST" || !["/api/account-activation/verify", "/api/account-activation/complete"].includes(path)) return json({ message: "Ruta no disponible." }, 404);
    const input = await readJson(request);
    if (!input) return json({ message: "Revisa los datos de activación." }, 400);
    if (path.endsWith("/verify")) {
      if (!exactKeys(input, ["email", "code"]) || typeof input.email !== "string" || typeof input.code !== "string") return json({ message: "Revisa el correo y el código de activación." }, 400);
      let identity;
      try { identity = await readInternalActivationCode(input.code, input.email, dependencies.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET!, dependencies.now()); }
      catch { return json({ message: "El correo y el código no coinciden, el código no es válido o ya venció." }, 401); }
      const auth = dependencies.auth(); let accessToken: string | undefined;
      try {
        const verified = await auth.verifyInviteTokenHash(identity.tokenHash); accessToken = verified.access_token;
        const session: InternalActivationSession = { id: identity.id, email: identity.email, role: identity.role, nonce: identity.nonce, accessToken, expiresAt: Math.min(identity.expiresAt, dependencies.now() + 10 * 60_000) };
        if (verified.user.id !== identity.id || verified.user.email?.trim().toLowerCase() !== identity.email || !await allowed(auth, session)) {
          await dispose(auth, accessToken); return json({ message: expired }, 401, clearCookie());
        }
        const value = await sealInternalActivationSession(session, dependencies.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET!, dependencies.now());
        const cookie = serializeAuthCookie(INTERNAL_ACTIVATION_COOKIE, value, { maxAgeSeconds: Math.max(1, Math.floor((session.expiresAt - dependencies.now()) / 1000)), expires: new Date(session.expiresAt) });
        return json({ verified: true, email: identity.email }, 200, cookie);
      } catch (error) { if (accessToken) await dispose(auth, accessToken); return providerError(error); }
    }
    if (!exactKeys(input, ["password", "confirmPassword"]) || !password(input.password) || input.password !== input.confirmPassword) return json({ message: "Usa entre 12 y 128 caracteres y confirma la misma contraseña." }, 400);
    const current = await provisional(request);
    if (!current) return json({ message: expired, code: "activation_expired" }, 401, clearCookie());
    let claimed: boolean;
    try { claimed = await dependencies.claim(current.session); }
    catch {
      // A lost RPC reply may follow a committed claim. Never reopen it here.
      await dispose(current.auth, current.session.accessToken);
      return json({ message: "No se pudo confirmar esta activación. Consulta a la escuela antes de intentarlo de nuevo.", code: "activation_consumed" }, 503, clearCookie());
    }
    if (!claimed) {
      await dispose(current.auth, current.session.accessToken);
      return json({ message: "Esta activación ya fue utilizada o ya no está disponible. Prueba iniciar sesión o consulta a la escuela.", code: "activation_consumed" }, 409, clearCookie());
    }
    if (current.session.expiresAt <= dependencies.now()) {
      await dispose(current.auth, current.session.accessToken);
      return json({ message: "La activación venció antes de terminar. Consulta a la escuela para recuperar tu acceso.", code: "activation_consumed" }, 409, clearCookie());
    }
    try {
      // One Auth mutation persists password and completion marker together.
      // Only this server-issued first-access receipt can reach this operation.
      const updated = await current.auth.admin.updateUser(current.session.id, { password: input.password, app_metadata: { ...(current.user.app_metadata ?? {}), school_activation_completed_nonce: current.session.nonce } });
      if (updated.id !== current.session.id || updated.email?.trim().toLowerCase() !== current.session.email || updated.app_metadata?.school_activation_completed_nonce !== current.session.nonce) throw new Error();
      await dispose(current.auth, current.session.accessToken);
      return json({ activated: true }, 200, clearCookie());
    } catch {
      await dispose(current.auth, current.session.accessToken);
      return json({ message: "No se pudo confirmar la contraseña. Prueba iniciar sesión con ella; si no funciona, consulta a la escuela para recuperar el acceso.", code: "activation_consumed" }, 503, clearCookie());
    }
  }
  return { handle };
}
export const internalActivationHandlers = createInternalActivationHandlers();
