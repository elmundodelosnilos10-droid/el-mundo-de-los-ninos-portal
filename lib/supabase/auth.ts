import { permitsIsolatedSupabaseHttp } from "./local-http-test-policy.ts";

/**
 * Server-side Supabase Auth REST adapter.
 *
 * Use the publishable key for user-scoped Auth endpoints. The service role key
 * is read only for admin methods and must remain in server environment
 * bindings. This module does not create or manage application sessions by
 * itself; callers must serialize cookies and enforce authorization per route.
 */

export type SupabaseAuthEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  APP_ORIGIN?: string;
};

export type SupabaseAuthConfig = {
  url?: string;
  publishableKey?: string;
  serviceRoleKey?: string;
  appOrigin?: string;
};

export type AuthUser = {
  id: string;
  email?: string;
  phone?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: AuthUser;
  [key: string]: unknown;
};

export type AdminCreateUserInput = {
  email: string;
  password: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
};

export type AdminInviteUserInput = {
  email: string;
  redirectTo: string;
  user_metadata?: Record<string, unknown>;
};

export type AdminGenerateInviteLinkInput = {
  email: string;
  user_metadata?: Record<string, unknown>;
};

/** Server-only receipt. tokenHash is an invitation credential, not public data. */
export type GeneratedInviteLink = { user: AuthUser; tokenHash: string };

export type AdminUpdateUserInput = {
  email?: string;
  password?: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  ban_duration?: string;
};

export type AdminListUsersOptions = {
  /** Number of users requested per page. Supabase accepts values up to 1000. */
  perPage?: number;
  /** Maximum number of pages to read before failing closed. */
  maxPages?: number;
};

export class SupabaseAuthError extends Error {
  readonly code: "not_configured" | "invalid_input" | "rejected" | "unavailable";
  readonly operation: AuthOperation;
  readonly status?: number;

  constructor(
    code: SupabaseAuthError["code"],
    operation: AuthOperation,
    status?: number,
  ) {
    super(`Supabase Auth ${operation} failed (${code})`);
    this.name = "SupabaseAuthError";
    this.code = code;
    this.operation = operation;
    this.status = status;
  }
}

type AuthOperation =
  | "sign_in"
  | "refresh"
  | "verify_user"
  | "sign_out"
  | "password_recovery"
  | "password_change"
  | "admin_create_user"
  | "admin_invite_user"
  | "admin_generate_invite_link"
  | "verify_invite_token"
  | "admin_update_user"
  | "admin_list_users"
  | "admin_disable_user"
  | "admin_delete_user";

const MAX_COOKIE_AGE_SECONDS = 400 * 24 * 60 * 60;
const REFRESH_COOKIE_AGE_SECONDS = MAX_COOKIE_AGE_SECONDS;
export const SUPABASE_ACCESS_COOKIE_NAME = "__Host-school-access";
export const SUPABASE_REFRESH_COOKIE_NAME = "__Host-school-refresh";
const MAX_COOKIE_HEADER_LENGTH = 32_768;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// GoTrue currently hashes email OTPs with SHA-224 (56 hexadecimal characters).
// Accept the bounded SHA-256 form too; neither arbitrary tokens nor PKCE codes
// are valid for the server-created invite flow.
const INVITE_TOKEN_HASH_PATTERN = /^(?:[0-9a-f]{56}|[0-9a-f]{64})$/i;

/** Create a client from server-only environment bindings. */
export function createSchoolAuthClient(
  environment: SupabaseAuthEnvironment,
  fetcher: typeof fetch = fetch,
  appOriginOverride?: string,
) {
  return createSupabaseAuthClient({
    url: environment.SUPABASE_URL,
    publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: environment.SUPABASE_SECRET_KEY,
    appOrigin: appOriginOverride ?? environment.APP_ORIGIN,
  }, fetcher);
}

/** Injectable factory for route handlers and mock-based tests. */
export function createSupabaseAuthClient(
  config: SupabaseAuthConfig,
  fetcher: typeof fetch = fetch,
) {
  function endpoint(path: string, operation: AuthOperation) {
    const base = safeBaseUrl(config.url, operation);
    return new URL(`/auth/v1/${path.replace(/^\//, "")}`, base);
  }

  function publicKey(operation: AuthOperation) {
    const key = config.publishableKey?.trim();
    if (!key || /[\r\n]/.test(key)) throw authError("not_configured", operation);
    return key;
  }

  function serviceKey(operation: AuthOperation) {
    const key = config.serviceRoleKey?.trim();
    if (!key || /[\r\n]/.test(key)) throw authError("not_configured", operation);
    return key;
  }

  function authHeaders(key: string, bearer?: string, extra: Record<string, string> = {}) {
    return {
      apikey: key,
      ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      Accept: "application/json",
      ...extra,
    };
  }

  async function request(
    operation: AuthOperation,
    path: string,
    options: {
      method: "GET" | "POST" | "PUT" | "DELETE";
      key: string;
      bearer?: string;
      body?: unknown;
      query?: Record<string, string>;
      expectJson?: boolean;
    },
  ): Promise<unknown> {
    const headers = authHeaders(options.key, options.bearer, options.body === undefined ? {} : { "Content-Type": "application/json" });
    let response: Response;
    try {
      const url = endpoint(path, operation);
      for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
      response = await fetcher(url, {
        method: options.method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: "error",
      });
    } catch {
      throw authError("unavailable", operation);
    }

    if (!response.ok) throw authError("rejected", operation, response.status);
    if (options.expectJson === false || response.status === 204) return undefined;
    const payload: unknown = await response.json().catch(() => null);
    if (payload === null) throw authError("rejected", operation, 502);
    return payload;
  }

  async function signIn(email: string, password: string): Promise<AuthSession> {
    const operation = "sign_in" as const;
    validateEmailPassword(email, password, operation);
    const payload = await request(operation, "token?grant_type=password", {
      method: "POST",
      key: publicKey(operation),
      body: { email: email.trim(), password },
    });
    return parseSession(payload, operation);
  }

  async function refresh(refreshToken: string): Promise<AuthSession> {
    const operation = "refresh" as const;
    validateOpaqueToken(refreshToken, operation);
    const payload = await request(operation, "token?grant_type=refresh_token", {
      method: "POST",
      key: publicKey(operation),
      body: { refresh_token: refreshToken },
    });
    return parseSession(payload, operation);
  }

  async function verifyCurrentUser(accessToken: string): Promise<AuthUser> {
    const operation = "verify_user" as const;
    validateOpaqueToken(accessToken, operation);
    const payload = await request(operation, "user", {
      method: "GET",
      key: publicKey(operation),
      bearer: accessToken,
    });
    return parseUser(payload, operation);
  }

  async function signOut(accessToken: string): Promise<void> {
    const operation = "sign_out" as const;
    validateOpaqueToken(accessToken, operation);
    await request(operation, "logout?scope=local", {
      method: "POST",
      key: publicKey(operation),
      bearer: accessToken,
      expectJson: false,
    });
  }

  async function requestPasswordRecovery(email: string, redirectTo?: string): Promise<void> {
    const operation = "password_recovery" as const;
    validateEmail(email, operation);
    const validatedRedirect = redirectTo === undefined ? undefined : validateRecoveryRedirect(redirectTo, config.appOrigin, operation);
    await request(operation, "recover", {
      method: "POST",
      key: publicKey(operation),
      ...(validatedRedirect === undefined ? {} : { query: { redirect_to: validatedRedirect } }),
      body: { email: email.trim() },
      expectJson: false,
    });
  }

  async function changePassword(accessToken: string, newPassword: string): Promise<AuthUser> {
    const operation = "password_change" as const;
    validateOpaqueToken(accessToken, operation);
    validatePassword(newPassword, operation);
    const payload = await request(operation, "user", {
      method: "PUT",
      key: publicKey(operation),
      bearer: accessToken,
      body: { password: newPassword },
    });
    return parseUser(payload, operation);
  }

  /** Exchange only an invite credential. Callers must keep this session private
   * until they verify the school invitation and complete password setup. */
  async function verifyInviteTokenHash(tokenHash: string): Promise<AuthSession> {
    const operation = "verify_invite_token" as const;
    if (typeof tokenHash !== "string" || !INVITE_TOKEN_HASH_PATTERN.test(tokenHash)) {
      throw authError("invalid_input", operation);
    }
    const payload = await request(operation, "verify", {
      method: "POST",
      key: publicKey(operation),
      body: { token_hash: tokenHash, type: "invite" },
    });
    return parseSession(payload, operation);
  }

  const admin = {
    /** Generate an invitation without invoking an email-sending endpoint. */
    async generateInviteLink(input: AdminGenerateInviteLinkInput): Promise<GeneratedInviteLink> {
      const operation = "admin_generate_invite_link" as const;
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some(key => !["email", "user_metadata"].includes(key))) {
        throw authError("invalid_input", operation);
      }
      validateEmail(input.email, operation);
      if (input.user_metadata !== undefined && (!input.user_metadata || typeof input.user_metadata !== "object" || Array.isArray(input.user_metadata))) {
        throw authError("invalid_input", operation);
      }
      const adminKey = serviceKey(operation);
      const payload = await request(operation, "admin/generate_link", {
        method: "POST",
        key: adminKey,
        ...(adminKey.startsWith("sb_secret_") ? {} : { bearer: adminKey }),
        body: { type: "invite", email: input.email.trim().toLowerCase(), ...(input.user_metadata === undefined ? {} : { data: input.user_metadata }) },
      });
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw authError("rejected", operation, 502);
      const receipt = payload as Record<string, unknown>;
      if (receipt.verification_type !== "invite" || typeof receipt.hashed_token !== "string" || !INVITE_TOKEN_HASH_PATTERN.test(receipt.hashed_token)) {
        throw authError("rejected", operation, 502);
      }
      // Auth REST returns identity fields and credentials in one flat object.
      // Strip all link properties so the user object cannot leak another copy
      // of the credential through metadata stamping or account responses.
      const identity = { ...receipt };
      for (const key of ["action_link", "email_otp", "hashed_token", "verification_type", "redirect_to"]) delete identity[key];
      const invited = parseUser(identity, operation);
      if (typeof invited.email !== "string" || invited.email.trim().toLowerCase() !== input.email.trim().toLowerCase()
        || typeof invited.invited_at !== "string" || !Number.isFinite(Date.parse(invited.invited_at))) {
        throw authError("rejected", operation, 502);
      }
      for (const metadata of [invited.app_metadata, invited.user_metadata]) {
        if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) throw authError("rejected", operation, 502);
      }
      return { user: invited, tokenHash: receipt.hashed_token };
    },

    async inviteUserByEmail(input: AdminInviteUserInput): Promise<AuthUser> {
      const operation = "admin_invite_user" as const;
      validateEmail(input.email, operation);
      const redirectTo = validateRecoveryRedirect(input.redirectTo, config.appOrigin, operation);
      if (input.user_metadata !== undefined && (!input.user_metadata || typeof input.user_metadata !== "object" || Array.isArray(input.user_metadata))) {
        throw authError("invalid_input", operation);
      }
      const adminKey = serviceKey(operation);
      const payload = await request(operation, `invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        key: adminKey,
        ...(adminKey.startsWith("sb_secret_") ? {} : { bearer: adminKey }),
        body: { email: input.email.trim().toLowerCase(), ...(input.user_metadata === undefined ? {} : { data: input.user_metadata }) },
      });
      return parseAdminUser(payload, operation);
    },

    async listUsers(options: AdminListUsersOptions = {}): Promise<AuthUser[]> {
      const operation = "admin_list_users" as const;
      validateAdminListUsersOptions(options, operation);
      const perPage = options.perPage ?? 100;
      const maxPages = options.maxPages ?? 100;
      const users: AuthUser[] = [];
      const seenIds = new Set<string>();

      for (let page = 1; page <= maxPages; page += 1) {
        const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
        const adminKey = serviceKey(operation);
        const payload = await request(operation, `admin/users?${query.toString()}`, {
          method: "GET",
          key: adminKey,
          // Current sb_secret_* API keys are not JWTs. Supabase's Auth Admin
          // GET endpoint accepts them via apikey; legacy service_role keys
          // still need their JWT in Authorization.
          ...(adminKey.startsWith("sb_secret_") ? {} : { bearer: adminKey }),
        });
        const pageUsers = parseAdminUsersPage(payload, operation, perPage);
        for (const user of pageUsers) {
          if (seenIds.has(user.id)) throw authError("rejected", operation, 502);
          seenIds.add(user.id);
          users.push(user);
        }

        if (pageUsers.length < perPage) return users;
      }

      // A full last page means more records may exist. Never return a partial
      // account list as if it were complete.
      throw authError("rejected", operation, 502);
    },

    async createUser(input: AdminCreateUserInput): Promise<AuthUser> {
      const operation = "admin_create_user" as const;
      validateEmailPassword(input.email, input.password, operation);
      const body = {
        email: input.email.trim(),
        password: input.password,
        ...(input.email_confirm === undefined ? {} : { email_confirm: input.email_confirm }),
        ...(input.user_metadata === undefined ? {} : { user_metadata: input.user_metadata }),
      };
      const payload = await request(operation, "admin/users", {
        method: "POST",
        key: serviceKey(operation),
        ...(serviceKey(operation).startsWith("sb_secret_") ? {} : { bearer: serviceKey(operation) }),
        body,
      });
      return parseAdminUser(payload, operation);
    },

    async updateUser(userId: string, input: AdminUpdateUserInput): Promise<AuthUser> {
      const operation = "admin_update_user" as const;
      validateUserId(userId, operation);
      validateAdminUpdate(input, operation);
      const payload = await request(operation, `admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        key: serviceKey(operation),
        ...(serviceKey(operation).startsWith("sb_secret_") ? {} : { bearer: serviceKey(operation) }),
        body: input,
      });
      return parseAdminUser(payload, operation);
    },

    async disableUser(userId: string): Promise<AuthUser> {
      const operation = "admin_disable_user" as const;
      validateUserId(userId, operation);
      const payload = await request(operation, `admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        key: serviceKey(operation),
        ...(serviceKey(operation).startsWith("sb_secret_") ? {} : { bearer: serviceKey(operation) }),
        body: { ban_duration: "876000h" },
      });
      return parseAdminUser(payload, operation);
    },

    async deleteUser(userId: string): Promise<void> {
      const operation = "admin_delete_user" as const;
      validateUserId(userId, operation);
      const adminKey = serviceKey(operation);
      await request(operation, `admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        key: adminKey,
        ...(adminKey.startsWith("sb_secret_") ? {} : { bearer: adminKey }),
        expectJson: false,
      });
    },
  };

  return { signIn, refresh, verifyCurrentUser, signOut, requestPasswordRecovery, changePassword, verifyInviteTokenHash, admin };
}

/** Serialize one secure host-only auth cookie. Secure flags are fixed. */
export function serializeAuthCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; expires?: Date } = {},
): string {
  if (!isCookieName(name) || /[\r\n;]/.test(value)) throw new TypeError("Invalid auth cookie input");
  const maxAge = options.maxAgeSeconds;
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > MAX_COOKIE_AGE_SECONDS)) {
    throw new TypeError("Invalid auth cookie expiry");
  }
  const expires = options.expires;
  if (expires !== undefined && (!(expires instanceof Date) || !Number.isFinite(expires.getTime()))) {
    throw new TypeError("Invalid auth cookie expiry");
  }

  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (expires !== undefined) parts.push(`Expires=${expires.toUTCString()}`);
  return parts.join("; ");
}

/** Serialize the access and refresh cookies returned by Supabase sign-in/refresh. */
export function serializeSessionCookies(session: AuthSession, now = Date.now()): [string, string] {
  const parsed = parseSession(session, "sign_in");
  if (!Number.isFinite(now)) throw new TypeError("Invalid auth cookie expiry");
  const accessExpires = new Date(now + parsed.expires_in * 1000);
  if (!Number.isFinite(accessExpires.getTime())) throw new TypeError("Invalid auth cookie expiry");
  return [
    serializeAuthCookie(SUPABASE_ACCESS_COOKIE_NAME, parsed.access_token, { maxAgeSeconds: parsed.expires_in, expires: accessExpires }),
    serializeAuthCookie(SUPABASE_REFRESH_COOKIE_NAME, parsed.refresh_token, { maxAgeSeconds: REFRESH_COOKIE_AGE_SECONDS }),
  ];
}

export function clearSessionCookies(now = Date.now()): [string, string] {
  if (!Number.isFinite(now)) throw new TypeError("Invalid auth cookie expiry");
  const expired = new Date(Math.min(now, 0));
  return [
    serializeAuthCookie(SUPABASE_ACCESS_COOKIE_NAME, "", { maxAgeSeconds: 0, expires: expired }),
    serializeAuthCookie(SUPABASE_REFRESH_COOKIE_NAME, "", { maxAgeSeconds: 0, expires: expired }),
  ];
}

/** Read the host-only Supabase session cookies without accepting duplicates or malformed values. */
export function readSupabaseAuthCookies(cookieHeader: string | null): { accessToken: string; refreshToken: string } | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0 || cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) return null;
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SUPABASE_ACCESS_COOKIE_NAME && name !== SUPABASE_REFRESH_COOKIE_NAME) continue;
    if (name === SUPABASE_ACCESS_COOKIE_NAME ? accessToken !== undefined : refreshToken !== undefined) return null;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
    if (!value || value.length > 16_384 || /[\s\r\n;]/.test(value)) return null;
    if (name === SUPABASE_ACCESS_COOKIE_NAME) accessToken = value;
    else refreshToken = value;
  }
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

function authError(code: SupabaseAuthError["code"], operation: AuthOperation, status?: number) {
  return new SupabaseAuthError(code, operation, status);
}

function safeBaseUrl(value: string | undefined, operation: AuthOperation) {
  if (!value) throw authError("not_configured", operation);
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && !permitsIsolatedSupabaseHttp(value)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("bad URL");
    return url;
  } catch {
    throw authError("not_configured", operation);
  }
}

function validateEmail(email: string, operation: AuthOperation) {
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw authError("invalid_input", operation);
  }
}

function validatePassword(password: string, operation: AuthOperation) {
  if (typeof password !== "string" || password.length < 8 || password.length > 1024 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw authError("invalid_input", operation);
  }
}

function validateEmailPassword(email: string, password: string, operation: AuthOperation) {
  validateEmail(email, operation);
  validatePassword(password, operation);
}

function validateOpaqueToken(token: string, operation: AuthOperation) {
  if (typeof token !== "string" || token.length < 1 || token.length > 16_384 || /[\s\r\n]/.test(token)) {
    throw authError("invalid_input", operation);
  }
}

function validateRecoveryRedirect(value: string, appOrigin: string | undefined, operation: AuthOperation) {
  if (!appOrigin) throw authError("not_configured", operation);
  try {
    const expected = new URL(appOrigin);
    const redirect = new URL(value);
    if (expected.protocol !== "https:" || expected.username || expected.password || redirect.origin !== expected.origin || redirect.username || redirect.password) throw new Error("bad redirect");
    return redirect.toString();
  } catch {
    throw authError("invalid_input", operation);
  }
}

function validateUserId(value: string, operation: AuthOperation) {
  if (!UUID_PATTERN.test(value)) throw authError("invalid_input", operation);
}

function validateAdminUpdate(input: AdminUpdateUserInput, operation: AuthOperation) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) throw authError("invalid_input", operation);
  const allowed = new Set(["email", "password", "email_confirm", "user_metadata", "app_metadata", "ban_duration"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw authError("invalid_input", operation);
  if (input.email !== undefined) validateEmail(input.email, operation);
  if (input.password !== undefined) validatePassword(input.password, operation);
  if (input.email_confirm !== undefined && typeof input.email_confirm !== "boolean") throw authError("invalid_input", operation);
  if (input.user_metadata !== undefined && (!input.user_metadata || typeof input.user_metadata !== "object" || Array.isArray(input.user_metadata))) throw authError("invalid_input", operation);
  if (input.app_metadata !== undefined && (!input.app_metadata || typeof input.app_metadata !== "object" || Array.isArray(input.app_metadata))) throw authError("invalid_input", operation);
  if (input.ban_duration !== undefined && !/^(?:none|\d+(?:s|m|h|d|w))$/.test(input.ban_duration)) throw authError("invalid_input", operation);
}

function validateAdminListUsersOptions(options: AdminListUsersOptions, operation: AuthOperation) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw authError("invalid_input", operation);
  const allowed = new Set(["perPage", "maxPages"]);
  if (Object.keys(options).some(key => !allowed.has(key))) throw authError("invalid_input", operation);
  if (options.perPage !== undefined && (!Number.isSafeInteger(options.perPage) || options.perPage < 1 || options.perPage > 1000)) {
    throw authError("invalid_input", operation);
  }
  if (options.maxPages !== undefined && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 1000)) {
    throw authError("invalid_input", operation);
  }
}

function parseUser(value: unknown, operation: AuthOperation): AuthUser {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !UUID_PATTERN.test(value.id)) {
    throw authError("rejected", operation, 502);
  }
  return value as AuthUser;
}

function parseAdminUser(value: unknown, operation: AuthOperation): AuthUser {
  const user = value && typeof value === "object" && "user" in value ? value.user : value;
  return parseUser(user, operation);
}

function parseAdminUsersPage(value: unknown, operation: AuthOperation, perPage: number): AuthUser[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("users" in value) || !Array.isArray(value.users)) {
    throw authError("rejected", operation, 502);
  }
  if (value.users.length > perPage) throw authError("rejected", operation, 502);
  return value.users.map((entry: unknown) => {
    const user = parseUser(entry, operation);
    const record = entry as Record<string, unknown>;
    if (record.email !== undefined && (typeof record.email !== "string" || record.email.length > 254)) {
      throw authError("rejected", operation, 502);
    }
    if (record.phone !== undefined && typeof record.phone !== "string") throw authError("rejected", operation, 502);
    if (record.role !== undefined && typeof record.role !== "string") throw authError("rejected", operation, 502);
    if (record.app_metadata !== undefined && (!record.app_metadata || typeof record.app_metadata !== "object" || Array.isArray(record.app_metadata))) {
      throw authError("rejected", operation, 502);
    }
    if (record.user_metadata !== undefined && (!record.user_metadata || typeof record.user_metadata !== "object" || Array.isArray(record.user_metadata))) {
      throw authError("rejected", operation, 502);
    }
    return user;
  });
}

function parseSession(value: unknown, operation: AuthOperation): AuthSession {
  if (!value || typeof value !== "object") throw authError("rejected", operation, 502);
  const session = value as Record<string, unknown>;
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string" ||
      !Number.isSafeInteger(session.expires_in) || (session.expires_in as number) < 1 || (session.expires_in as number) > MAX_COOKIE_AGE_SECONDS ||
      typeof session.token_type !== "string") {
    throw authError("rejected", operation, 502);
  }
  validateOpaqueToken(session.access_token, operation);
  validateOpaqueToken(session.refresh_token, operation);
  const user = parseUser(session.user, operation);
  return { ...session, user } as AuthSession;
}

function isCookieName(value: string) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}
