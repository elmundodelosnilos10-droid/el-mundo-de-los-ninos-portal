export type InternalActivationIdentity = {
  id: string;
  email: string;
  role: "docente" | "tutor" | "direccion";
  nonce: string;
  tokenHash: string;
};

export type InternalActivationSession = {
  id: string;
  email: string;
  role: InternalActivationIdentity["role"];
  nonce: string;
  accessToken: string;
  expiresAt: number;
};

const CODE_PREFIX = "EMDN1.";
const SESSION_PREFIX = "EMDNS1.";
const CODE_TTL_MS = 30 * 60_000;
const SESSION_TTL_MS = 10 * 60_000;
const CODE_LIMIT = 2_048;
const SESSION_LIMIT = 3_800;
const FAILURE = "No se pudo validar la activación.";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^(?:[0-9a-f]{56}|[0-9a-f]{64})$/;
const salt = encoder.encode("el-mundo-de-los-ninos/internal-activation/v1");

type Purpose = "acode" | "cookie";
type JsonRecord = Record<string, unknown>;

function fail(): never {
  // Never include the submitted email, credentials, ciphertext or crypto errors.
  throw new Error(FAILURE);
}

function clock(nowMs: number) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail();
  return nowMs;
}

function normalizedEmail(value: unknown) {
  if (typeof value !== "string" || value.length > 512) fail();
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) fail();
  const local = email.split("@", 1)[0];
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) fail();
  return email;
}

function record(value: unknown, fields: readonly string[]): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const result = value as JsonRecord;
  const keys = Object.keys(result);
  if (keys.length !== fields.length || !fields.every(field => Object.hasOwn(result, field))) fail();
  return result;
}

function baseIdentity(value: JsonRecord, canonical = false): Pick<InternalActivationIdentity, "id" | "email" | "role" | "nonce"> {
  if (typeof value.id !== "string" || !uuid.test(value.id)
    || typeof value.nonce !== "string" || !uuid.test(value.nonce)
    || (value.role !== "docente" && value.role !== "tutor" && value.role !== "direccion")) fail();
  const email = normalizedEmail(value.email);
  if (canonical && value.email !== email) fail();
  return { id: value.id, email, role: value.role, nonce: value.nonce };
}

function expiry(value: unknown, nowMs: number, ttl: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)
    || value <= nowMs || value > nowMs + ttl) fail();
  return value;
}

function issued(value: unknown, expiresAt: number, nowMs: number, ttl: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)
    || value < 0 || value > nowMs || expiresAt <= value || expiresAt > value + ttl) fail();
}

/** Check deployment configuration before creating an Auth identity or changing school roles. */
export function isInternalActivationSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 256
    && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/^sb_(?:secret|publishable)_/i.test(value)
    && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    && encoder.encode(value).length >= 32;
}

async function key(secret: string, purpose: Purpose) {
  if (!isInternalActivationSecret(secret)) fail();
  const bytes = encoder.encode(secret);
  const material = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(purpose) }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function encode64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode64(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail();
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (encode64(bytes) !== value || bytes.length < 30) fail();
  return bytes;
}

function aad(purpose: Purpose, email?: string) {
  return encoder.encode(purpose === "acode" ? `school-activation-code.v1\u0000${email}` : "school-activation-cookie.v1");
}

async function seal(payload: JsonRecord, secret: string, purpose: Purpose, prefix: string, limit: number, email?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: aad(purpose, email), tagLength: 128 }, await key(secret, purpose), encoder.encode(JSON.stringify(payload))));
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv);
  bytes.set(ciphertext, iv.length);
  const value = prefix + encode64(bytes);
  if (value.length > limit) fail();
  return value;
}

async function open(value: string, secret: string, purpose: Purpose, prefix: string, limit: number, email?: string) {
  if (typeof value !== "string" || value.length > limit || !value.startsWith(prefix)) fail();
  const bytes = decode64(value.slice(prefix.length));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12),
    additionalData: aad(purpose, email), tagLength: 128 }, await key(secret, purpose), bytes.slice(12));
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}

/** The underlying Auth token remains one-use; this envelope adds email binding and a short lifetime. */
export async function createInternalActivationCode(identity: InternalActivationIdentity, secret: string, nowMs = Date.now()) {
  try {
    const now = clock(nowMs);
    const input = record(identity, ["id", "email", "role", "nonce", "tokenHash"]);
    const base = baseIdentity(input);
    if (typeof input.tokenHash !== "string" || !hash.test(input.tokenHash)) fail();
    const expiresAt = expiry(now + CODE_TTL_MS, now, CODE_TTL_MS);
    const code = await seal({ kind: "code", ...base, tokenHash: input.tokenHash, issuedAt: now, expiresAt },
      secret, "acode", CODE_PREFIX, CODE_LIMIT, base.email);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  } catch { return fail(); }
}

export async function readInternalActivationCode(code: string, email: string, secret: string, nowMs = Date.now()): Promise<InternalActivationIdentity & { expiresAt: number }> {
  try {
    const now = clock(nowMs);
    const requestedEmail = normalizedEmail(email);
    const value = record(await open(code, secret, "acode", CODE_PREFIX, CODE_LIMIT, requestedEmail),
      ["kind", "id", "email", "role", "nonce", "tokenHash", "issuedAt", "expiresAt"]);
    const base = baseIdentity(value, true);
    if (value.kind !== "code" || base.email !== requestedEmail || typeof value.tokenHash !== "string" || !hash.test(value.tokenHash)) fail();
    const expiresAt = expiry(value.expiresAt, now, CODE_TTL_MS);
    issued(value.issuedAt, expiresAt, now, CODE_TTL_MS);
    return { ...base, tokenHash: value.tokenHash, expiresAt };
  } catch { return fail(); }
}

export async function sealInternalActivationSession(session: InternalActivationSession, secret: string, nowMs = Date.now()) {
  try {
    const now = clock(nowMs);
    const value = record(session, ["id", "email", "role", "nonce", "accessToken", "expiresAt"]);
    const base = baseIdentity(value);
    const expiresAt = expiry(value.expiresAt, now, SESSION_TTL_MS);
    if (typeof value.accessToken !== "string" || value.accessToken.length < 8 || value.accessToken.length > 16_384
      || /[^\x21-\x7e]/.test(value.accessToken)) fail();
    return await seal({ kind: "session", ...base, accessToken: value.accessToken, issuedAt: now, expiresAt },
      secret, "cookie", SESSION_PREFIX, SESSION_LIMIT);
  } catch { return fail(); }
}

export async function readInternalActivationSession(value: string, secret: string, nowMs = Date.now()): Promise<InternalActivationSession> {
  try {
    const now = clock(nowMs);
    const result = record(await open(value, secret, "cookie", SESSION_PREFIX, SESSION_LIMIT),
      ["kind", "id", "email", "role", "nonce", "accessToken", "issuedAt", "expiresAt"]);
    const base = baseIdentity(result, true);
    if (result.kind !== "session" || typeof result.accessToken !== "string" || result.accessToken.length < 8
      || result.accessToken.length > 16_384 || /[^\x21-\x7e]/.test(result.accessToken)) fail();
    const expiresAt = expiry(result.expiresAt, now, SESSION_TTL_MS);
    issued(result.issuedAt, expiresAt, now, SESSION_TTL_MS);
    return { ...base, accessToken: result.accessToken, expiresAt };
  } catch { return fail(); }
}
